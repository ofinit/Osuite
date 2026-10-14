// Double-entry journal: every posted document writes a balanced entry;
// cancelling writes the mirror entry. Entries are never edited.
import { localToday, money } from '@osuite/kernel';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Tx } from '../../db/client.ts';
import { tableFor } from '../../db/tables.ts';
import { RecordError } from '../../services/errors.ts';
import type { Values } from '../../services/hooks.ts';
import { nextDocumentNumber } from '../../services/numbering.ts';
import { lockDate } from './lock.ts';

/** System roles of seeded accounts (see the chart_of_accounts migration). */
export type AccountKey =
  | 'cash'
  | 'bank'
  | 'receivable'
  | 'inventory'
  | 'input_cgst'
  | 'input_sgst'
  | 'input_igst'
  | 'payable'
  | 'output_cgst'
  | 'output_sgst'
  | 'output_igst'
  | 'opening_equity'
  | 'sales'
  | 'cogs'
  | 'purchases'
  | 'stock_adjustment'
  | 'round_off'
  | 'retained_earnings';

export interface JournalLine {
  /** A system account by role, or any account by id (manual journals). */
  account: AccountKey | number;
  partnerId?: number | null;
  /** Signed: positive debits, negative credits. */
  amount: string;
}

export interface JournalSource {
  date: string;
  reference: string;
  narration: string;
  refModel: string;
  refId: number;
}

const dr = (account: AccountKey | number, amount: string, partnerId?: number | null): JournalLine => ({ account, amount, partnerId });
const cr = (account: AccountKey | number, amount: string, partnerId?: number | null): JournalLine => ({ account, amount: money.sub(0, amount), partnerId });

async function accountIds(tx: Tx, refs: (AccountKey | number)[]): Promise<Map<AccountKey | number, number>> {
  const keys = [...new Set(refs.filter((r): r is AccountKey => typeof r === 'string'))];
  const map = new Map<AccountKey | number, number>(refs.filter((r): r is number => typeof r === 'number').map((id) => [id, id]));
  if (!keys.length) return map;
  const a = tableFor('account.account');
  const rows = await tx.select({ id: a.id, key: a.key }).from(a).where(inArray(a.key, keys));
  for (const r of rows) map.set(r.key as AccountKey, r.id as number);
  const missing = keys.filter((k) => !map.has(k));
  if (missing.length) throw new RecordError(500, `Chart of accounts is missing system account(s): ${missing.join(', ')}`);
  return map;
}

/** Writes a balanced entry; zero lines are dropped. Returns the entry id (or null if empty). */
export async function postJournal(tx: Tx, src: JournalSource, lines: JournalLine[]): Promise<number | null> {
  const real = lines.filter((l) => money.cmp(l.amount, 0) !== 0);
  if (!real.length) return null;
  // Closed financial years are locked: nothing new may be dated in them.
  const lock = await lockDate(tx);
  if (lock && src.date <= lock.to)
    throw new RecordError(409, `The financial year 20${lock.fy.slice(0, 2)}-${lock.fy.slice(3)} is closed. Use a date after ${lock.to}.`);
  const debit = money.add(...real.filter((l) => money.isPositive(l.amount)).map((l) => l.amount));
  const credit = money.add(...real.filter((l) => !money.isPositive(l.amount)).map((l) => money.sub(0, l.amount)));
  if (money.cmp(debit, credit) !== 0)
    throw new RecordError(500, `Journal for ${src.reference} does not balance (debit ${debit}, credit ${credit}).`);

  const ids = await accountIds(tx, real.map((l) => l.account));
  const entries = tableFor('account.entry');
  const items = tableFor('account.entry_line');
  const [entry] = await tx
    .insert(entries)
    .values({ ...src, number: await nextDocumentNumber(tx, 'JV', src.date), amount: debit })
    .returning({ id: entries.id });
  await tx.insert(items).values(
    real.map((l, i) => ({
      entryId: entry!.id,
      sequence: i + 1,
      date: src.date,
      accountId: ids.get(l.account),
      partnerId: l.partnerId ?? null,
      debit: money.isPositive(l.amount) ? money.add(l.amount) : '0.00',
      credit: money.isPositive(l.amount) ? '0.00' : money.sub(0, l.amount),
    })),
  );
  return entry!.id as number;
}

/**
 * Mirrors every not-yet-reversed entry of a document (debits become credits),
 * dated today: a cancellation must not rewrite a period already reported.
 */
export async function reverseJournal(tx: Tx, src: Omit<JournalSource, 'narration'>, opts: { date?: string } = {}): Promise<void> {
  const entries = tableFor('account.entry');
  const items = tableFor('account.entry_line');
  const accounts = tableFor('account.account');
  const originals = await tx
    .select()
    .from(entries)
    .where(and(eq(entries.refModel, src.refModel), eq(entries.refId, src.refId), isNull(entries.reversedById)))
    .orderBy(asc(entries.id));
  for (const e of originals) {
    if (String(e.reference).startsWith('Cancel ')) continue;
    const lines = await tx
      .select({ accountId: accounts.id, partnerId: items.partnerId, debit: items.debit, credit: items.credit })
      .from(items)
      .innerJoin(accounts, eq(accounts.id, items.accountId))
      .where(eq(items.entryId, e.id as number))
      .orderBy(asc(items.sequence));
    const reversalId = await postJournal(
      tx,
      { ...src, date: opts.date ?? localToday(), reference: `Cancel ${String(e.reference)}`, narration: `Reversal of ${String(e.number)}` },
      lines.map((l) => ({
        account: l.accountId as number,
        partnerId: l.partnerId as number | null,
        amount: money.sub(l.credit as string, l.debit as string),
      })),
    );
    await tx.update(entries).set({ reversedById: reversalId }).where(eq(entries.id, e.id as number));
  }
}

// ---------------------------------------------------------------- entries per document

export type JournalKind = 'sale' | 'purchase' | 'sale_return' | 'purchase_return';

/** Mirror image of a set of lines (debits become credits). */
const negate = (lines: JournalLine[]): JournalLine[] => lines.map((l) => ({ ...l, amount: money.sub(0, l.amount) }));

export function journalLines(kind: JournalKind, record: Values, stockValue: string): JournalLine[] {
  switch (kind) {
    case 'sale':
      return saleLines(record, stockValue);
    case 'purchase':
      return purchaseLines(record, stockValue);
    // A credit note undoes the sale: same lines with signs flipped. Returned
    // goods come back in (positive value) and reduce COGS.
    case 'sale_return':
      return negate(saleLines(record, money.sub(0, stockValue)));
    // A debit note undoes the purchase; returned goods leave stock (negative value).
    case 'purchase_return':
      return negate(purchaseLines(record, money.sub(0, stockValue)));
  }
}

/**
 * Sale: customer owes the total; sales, output GST and round-off are credited.
 * Goods also move cost: COGS debited, stock credited at the stock ledger's value.
 */
export function saleLines(inv: Values, stockValueOut: string): JournalLine[] {
  const partner = inv.customerId as number;
  const cost = money.sub(0, stockValueOut); // stock value moved out is negative
  return [
    dr('receivable', String(inv.totalAmount), partner),
    cr('sales', String(inv.taxableAmount)),
    cr('output_cgst', String(inv.cgstAmount)),
    cr('output_sgst', String(inv.sgstAmount)),
    cr('output_igst', String(inv.igstAmount)),
    cr('round_off', String(inv.roundOff)),
    dr('cogs', cost),
    cr('inventory', cost),
  ];
}

/**
 * Purchase: goods enter stock at the stock ledger's value; the rest of the
 * taxable value (services, consumables) is a purchase expense; input GST is
 * claimable; the vendor is owed the total.
 */
export function purchaseLines(bill: Values, stockValueIn: string): JournalLine[] {
  return [
    dr('inventory', stockValueIn),
    dr('purchases', money.sub(bill.taxableAmount as string, stockValueIn)),
    dr('input_cgst', String(bill.cgstAmount)),
    dr('input_sgst', String(bill.sgstAmount)),
    dr('input_igst', String(bill.igstAmount)),
    dr('round_off', String(bill.roundOff)),
    cr('payable', String(bill.totalAmount), bill.vendorId as number),
  ];
}

/** `bankLedgerId`: the ledger account of the payment's bank account (non-cash modes). */
export function paymentLines(p: Values, bankLedgerId?: number | null): JournalLine[] {
  const money_: AccountKey | number = p.mode === 'cash' ? 'cash' : (bankLedgerId ?? 'bank');
  const amount = String(p.amount);
  const partner = p.partnerId as number;
  return p.direction === 'outbound'
    ? [dr('payable', amount, partner), cr(money_, amount)]
    : [dr(money_, amount), cr('receivable', amount, partner)];
}

/** Stock adjustments: gains/losses, or opening stock against opening balance equity. */
export function adjustmentLines(adj: Values, stockValue: string): JournalLine[] {
  const counter: AccountKey = adj.reason === 'opening' ? 'opening_equity' : 'stock_adjustment';
  return [dr('inventory', stockValue), cr(counter, stockValue)];
}
