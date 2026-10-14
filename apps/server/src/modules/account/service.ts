// Settling invoices and bills with payments, and the ageing of what is due.
import { ageBucket, localToday, money, paymentStateOf, type AgeBucket } from '@osuite/kernel';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { Tx } from '../../db/client.ts';
import { tableFor } from '../../db/tables.ts';
import { RecordError } from '../../services/errors.ts';

export type Direction = 'inbound' | 'outbound';

/** Which document a payment settles in each direction. */
export const SIDE = {
  inbound: { model: 'sales.invoice', lineField: 'invoiceId', partnerField: 'customerId', label: 'invoice', prefix: 'RCPT', noteModel: 'sales.credit_note' },
  outbound: { model: 'purchase.bill', lineField: 'billId', partnerField: 'vendorId', label: 'bill', prefix: 'PAY', noteModel: 'purchase.debit_note' },
} as const;

export interface OpenItem {
  id: number;
  number: string;
  date: string;
  dueDate: string | null;
  totalAmount: string;
  amountDue: string;
}

/** Posted documents with a balance due for a partner, oldest due first. */
export async function openItems(tx: Tx, direction: Direction, partnerId: number): Promise<OpenItem[]> {
  const side = SIDE[direction];
  const t = tableFor(side.model);
  const rows = await tx
    .select({ id: t.id, number: t.number, date: t.date, dueDate: t.dueDate, totalAmount: t.totalAmount, amountDue: t.amountDue })
    .from(t)
    .where(and(eq(t[side.partnerField], partnerId), eq(t.state, 'posted'), gt(t.amountDue, '0')))
    .orderBy(sql`coalesce(${t.dueDate}, ${t.date})`, asc(t.id));
  return rows as unknown as OpenItem[];
}

/**
 * Adds `amount` (negative to reverse) to a document's paid amount, after
 * locking it. Refuses to pay more than is due or to pay another party's document.
 */
export async function settle(tx: Tx, direction: Direction, docId: number, partnerId: number, amount: string): Promise<void> {
  const side = SIDE[direction];
  const t = tableFor(side.model);
  const [doc] = await tx.select().from(t).where(eq(t.id, docId)).for('update');
  if (!doc) throw new RecordError(422, `That ${side.label} no longer exists.`);
  const ref = String(doc.number ?? `#${docId}`);
  if (money.isPositive(amount)) {
    if (doc.state !== 'posted') throw new RecordError(422, `${ref} is not posted.`);
    if (doc[side.partnerField] !== partnerId) throw new RecordError(422, `${ref} belongs to a different party.`);
    if (money.cmp(amount, doc.amountDue as string) > 0)
      throw new RecordError(422, `${ref} has only ₹${String(doc.amountDue)} due; ₹${amount} was allocated.`);
  }
  const paid = money.add(doc.amountPaid as string, amount);
  await tx
    .update(t)
    .set({
      amountPaid: paid,
      amountDue: money.sub(doc.totalAmount as string, paid),
      paymentState: paymentStateOf(doc.totalAmount as string, paid),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(t.id, docId));
}

export interface AgeingRow {
  partnerId: number;
  partner: string;
  notDue: string;
  d1_30: string;
  d31_60: string;
  d61_90: string;
  d90plus: string;
  total: string;
  advance: string;
  net: string;
  items: (OpenItem & { daysOverdue: number; bucket: AgeBucket })[];
}

const BUCKETS: AgeBucket[] = ['notDue', 'd1_30', 'd31_60', 'd61_90', 'd90plus'];

/** Receivables (inbound) or payables (outbound) by party and age. */
export async function ageing(tx: Tx, direction: Direction, asOf = localToday()) {
  const side = SIDE[direction];
  const t = tableFor(side.model);
  const contacts = tableFor('base.contact');
  const payments = tableFor('account.payment');

  const docs = await tx
    .select({
      id: t.id,
      number: t.number,
      date: t.date,
      dueDate: t.dueDate,
      totalAmount: t.totalAmount,
      amountDue: t.amountDue,
      partnerId: t[side.partnerField],
      partner: contacts.name,
    })
    .from(t)
    .innerJoin(contacts, eq(contacts.id, t[side.partnerField]))
    .where(and(eq(t.state, 'posted'), gt(t.amountDue, '0')))
    .orderBy(sql`coalesce(${t.dueDate}, ${t.date})`);

  const advances = await tx
    .select({ partnerId: payments.partnerId, partner: contacts.name, advance: sql<string>`sum(${payments.unallocatedAmount})` })
    .from(payments)
    .innerJoin(contacts, eq(contacts.id, payments.partnerId))
    .where(and(eq(payments.state, 'posted'), eq(payments.direction, direction), gt(payments.unallocatedAmount, '0')))
    .groupBy(payments.partnerId, contacts.name);

  const rows = new Map<number, AgeingRow>();
  const row = (partnerId: number, partner: string) => {
    let r = rows.get(partnerId);
    if (!r) {
      r = { partnerId, partner, notDue: '0.00', d1_30: '0.00', d31_60: '0.00', d61_90: '0.00', d90plus: '0.00', total: '0.00', advance: '0.00', net: '0.00', items: [] };
      rows.set(partnerId, r);
    }
    return r;
  };
  for (const d of docs) {
    const r = row(d.partnerId as number, String(d.partner));
    const { bucket, daysOverdue } = ageBucket(String(d.dueDate ?? d.date), asOf);
    r[bucket] = money.add(r[bucket], d.amountDue as string);
    r.total = money.add(r.total, d.amountDue as string);
    r.items.push({ ...(d as unknown as OpenItem), bucket, daysOverdue });
  }
  for (const a of advances) row(a.partnerId as number, String(a.partner)).advance = money.add(a.advance);

  // Credit left over on posted notes also offsets what is owed.
  const notes = tableFor(side.noteModel);
  const noteCredit = await tx
    .select({ partnerId: notes[side.partnerField], partner: contacts.name, credit: sql<string>`sum(${notes.unappliedAmount})` })
    .from(notes)
    .innerJoin(contacts, eq(contacts.id, notes[side.partnerField]))
    .where(and(eq(notes.state, 'posted'), gt(notes.unappliedAmount, '0')))
    .groupBy(notes[side.partnerField], contacts.name);
  for (const n of noteCredit) {
    const r = row(n.partnerId as number, String(n.partner));
    r.advance = money.add(r.advance, n.credit);
  }
  for (const r of rows.values()) r.net = money.sub(r.total, r.advance);

  const list = [...rows.values()].sort((a, b) => money.cmp(b.net, a.net) || a.partner.localeCompare(b.partner));
  const totals = Object.fromEntries(
    [...BUCKETS, 'total', 'advance', 'net'].map((k) => [k, money.add(...list.map((r) => r[k as keyof AgeingRow] as string))]),
  );
  return { asOf, direction, rows: list, totals };
}
