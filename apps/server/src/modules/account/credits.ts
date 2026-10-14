// Applying a party's available credit (payment advances, unapplied credit or
// debit notes) to their open invoices or bills. Pure sub-ledger matching: the
// journal already holds both sides on the party's account.
import { localToday, money } from '@osuite/kernel';
import { and, asc, eq, gt, sql } from 'drizzle-orm';
import type { Tx } from '../../db/client.ts';
import { tableFor } from '../../db/tables.ts';
import { appendAudit } from '../../services/audit.ts';
import { RecordError } from '../../services/errors.ts';
import { openItems, settle, SIDE, type Direction } from './service.ts';

/** Where credit can come from, and the field holding its remaining amount. */
const SOURCES = {
  inbound: [
    { model: 'account.payment', remaining: 'unallocatedAmount', partnerField: 'partnerId', direction: 'inbound' },
    { model: 'sales.credit_note', remaining: 'unappliedAmount', partnerField: 'customerId' },
  ],
  outbound: [
    { model: 'account.payment', remaining: 'unallocatedAmount', partnerField: 'partnerId', direction: 'outbound' },
    { model: 'purchase.debit_note', remaining: 'unappliedAmount', partnerField: 'vendorId' },
  ],
} as const;

export interface CreditSource {
  model: string;
  id: number;
  number: string;
  date: string;
  remaining: string;
}

/** Posted credit for a party, oldest first. */
export async function availableCredit(tx: Tx, direction: Direction, partnerId: number): Promise<CreditSource[]> {
  const out: CreditSource[] = [];
  for (const s of SOURCES[direction]) {
    const t = tableFor(s.model);
    const rows = await tx
      .select({ id: t.id, number: t.number, date: t.date, remaining: t[s.remaining] })
      .from(t)
      .where(
        and(
          eq(t[s.partnerField], partnerId),
          eq(t.state, 'posted'),
          gt(t[s.remaining], '0'),
          'direction' in s ? eq(t.direction, s.direction) : undefined,
        ),
      );
    for (const r of rows) out.push({ model: s.model, id: r.id as number, number: String(r.number), date: String(r.date), remaining: String(r.remaining) });
  }
  return out.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
}

function remainingField(model: string): string {
  return model === 'account.payment' ? 'unallocatedAmount' : 'unappliedAmount';
}

/**
 * Applies the party's credit to one document (when `docId` is given) or to all
 * their open documents, oldest due first. Returns the settlements made.
 */
export async function applyCredit(tx: Tx, input: { direction: Direction; partnerId: number; docId?: number }, userId: number) {
  const side = SIDE[input.direction];
  const credits = await availableCredit(tx, input.direction, input.partnerId);
  if (!credits.length) throw new RecordError(422, 'This party has no credit to apply.');
  let docs = await openItems(tx, input.direction, input.partnerId);
  if (input.docId) docs = docs.filter((d) => d.id === input.docId);
  if (!docs.length) throw new RecordError(422, input.docId ? `Nothing is due on that ${side.label}.` : `This party has no unpaid ${side.label}s.`);

  const settlements = tableFor('account.settlement');
  const made: { source: string; document: string; amount: string }[] = [];
  let ci = 0;
  for (const doc of docs) {
    let due = doc.amountDue;
    while (money.isPositive(due) && ci < credits.length) {
      const c = credits[ci]!;
      const amount = money.min(due, c.remaining);
      // Lock and reduce the credit source, then settle the document.
      const t = tableFor(c.model);
      const field = remainingField(c.model);
      const [locked] = await tx.select({ remaining: t[field] }).from(t).where(eq(t.id, c.id)).for('update');
      if (money.cmp(amount, locked!.remaining as string) > 0) throw new RecordError(409, 'Credit changed while applying; try again.');
      await tx.update(t).set({ [field]: money.sub(locked!.remaining as string, amount) }).where(eq(t.id, c.id));
      await settle(tx, input.direction, doc.id, input.partnerId, amount);
      const [row] = await tx
        .insert(settlements)
        .values({
          date: localToday(),
          direction: input.direction,
          partnerId: input.partnerId,
          sourceModel: c.model,
          sourceId: c.id,
          sourceNumber: c.number,
          docModel: side.model,
          docId: doc.id,
          docNumber: doc.number,
          amount,
          state: 'active',
          createdBy: userId,
          updatedBy: userId,
        })
        .returning({ id: settlements.id });
      await appendAudit(tx, { userId, model: 'account.settlement', recordId: row!.id as number, action: 'apply', changes: { amount: { from: null, to: amount } } });
      made.push({ source: c.number, document: doc.number, amount });
      c.remaining = money.sub(c.remaining, amount);
      due = money.sub(due, amount);
      if (!money.isPositive(c.remaining)) ci++;
    }
    if (ci >= credits.length) break;
  }
  return { applied: money.add(...made.map((m) => m.amount)), settlements: made };
}

/** Undoes one active credit application. */
export async function reverseSettlementRow(tx: Tx, id: number, userId: number) {
  const s = tableFor('account.settlement');
  const [row] = await tx.select().from(s).where(eq(s.id, id)).for('update');
  if (!row || row.state !== 'active') throw new RecordError(404, 'Active credit application not found');
  return reverseSettlements(tx, 'source', String(row.sourceModel), row.sourceId as number, userId, id);
}

/** Undoes active settlements whose source (`sourceModel`) or document (`docModel`) is being cancelled. */
export async function reverseSettlements(tx: Tx, by: 'source' | 'doc', model: string, id: number, userId: number | null, onlyId?: number) {
  const s = tableFor('account.settlement');
  const rows = await tx
    .select()
    .from(s)
    .where(
      and(
        eq(by === 'source' ? s.sourceModel : s.docModel, model),
        eq(by === 'source' ? s.sourceId : s.docId, id),
        eq(s.state, 'active'),
        onlyId ? eq(s.id, onlyId) : undefined,
      ),
    )
    .orderBy(asc(s.id))
    .for('update');
  for (const r of rows) {
    const direction = r.direction as Direction;
    await settle(tx, direction, r.docId as number, r.partnerId as number, money.sub(0, r.amount as string));
    const t = tableFor(r.sourceModel as string);
    const field = remainingField(r.sourceModel as string);
    await tx
      .update(t)
      .set({ [field]: sql`${t[field]} + ${r.amount}` })
      .where(eq(t.id, r.sourceId as number));
    await tx.update(s).set({ state: 'reversed', updatedAt: new Date().toISOString() }).where(eq(s.id, r.id as number));
    await appendAudit(tx, { userId, model: 'account.settlement', recordId: r.id as number, action: 'reverse', changes: { state: { from: 'active', to: 'reversed' } } });
  }
  return rows.length;
}
