// Year-end closing for Indian financial years (April to March): income and
// expense balances move to Reserves & surplus, and the year is locked.
import { financialYear, localToday, money } from '@osuite/kernel';
import { and, eq, gte, lte, ne, sql } from 'drizzle-orm';
import type { Tx } from '../../db/client.ts';
import { tableFor } from '../../db/tables.ts';
import { appendAudit } from '../../services/audit.ts';
import { RecordError } from '../../services/errors.ts';
import { postJournal, reverseJournal, type JournalLine } from './journal.ts';
import { CLOSING_MODEL, lockDate } from './lock.ts';

export { CLOSING_MODEL };

/** Documents whose drafts must be posted or deleted before a year closes. */
const DRAFTABLE = [
  ['sales.invoice', 'invoices'],
  ['sales.credit_note', 'credit notes'],
  ['purchase.bill', 'bills'],
  ['purchase.debit_note', 'debit notes'],
  ['account.payment', 'payments'],
  ['stock.adjustment', 'stock adjustments'],
  ['account.manual', 'manual journals'],
] as const;

/** "25-26" -> 2025-04-01 .. 2026-03-31 */
export function fyRange(fy: string): { from: string; to: string } {
  if (!/^\d{2}-\d{2}$/.test(fy)) throw new RecordError(400, `Invalid financial year "${fy}"`);
  const start = 2000 + Number(fy.slice(0, 2));
  return { from: `${start}-04-01`, to: `${start + 1}-03-31` };
}

const fyLabel = (fy: string) => `20${fy.slice(0, 2)}-${fy.slice(3)}`;

/** Income/expense balances in a period, without closing entries. */
async function resultBalances(tx: Tx, from: string, to: string) {
  const a = tableFor('account.account');
  const l = tableFor('account.entry_line');
  const e = tableFor('account.entry');
  return tx
    .select({
      accountId: a.id,
      type: a.type,
      net: sql<string>`coalesce(sum(${l.debit} - ${l.credit}), 0)`,
    })
    .from(l)
    .innerJoin(a, eq(a.id, l.accountId))
    .innerJoin(e, eq(e.id, l.entryId))
    .where(and(gte(l.date, from), lte(l.date, to), ne(e.refModel, CLOSING_MODEL), sql`${a.type} in ('income', 'expense')`))
    .groupBy(a.id, a.type);
}

async function draftsIn(tx: Tx, from: string, to: string) {
  const out: string[] = [];
  for (const [model, label] of DRAFTABLE) {
    const t = tableFor(model);
    const [r] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(t)
      .where(and(eq(t.state, 'draft'), gte(t.date, from), lte(t.date, to)));
    if (r!.n) out.push(`${r!.n} draft ${label}`);
  }
  return out;
}

/** Financial years from the first journal entry to today, with their status. */
export async function listYears(tx: Tx) {
  const e = tableFor('account.entry');
  const [first] = await tx.select({ d: sql<string | null>`min(${e.date})` }).from(e);
  const today = localToday();
  const firstFy = financialYear(first?.d ?? today);
  const lastFy = financialYear(today);
  const closes = tableFor(CLOSING_MODEL);
  const rows = await tx.select().from(closes).where(eq(closes.state, 'closed'));
  const closed = new Map(rows.map((r) => [String(r.fy), r]));

  const years = [];
  for (let start = 2000 + Number(firstFy.slice(0, 2)); start <= 2000 + Number(lastFy.slice(0, 2)); start++) {
    const fy = `${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
    const { from, to } = fyRange(fy);
    const bal = await resultBalances(tx, from, to);
    const profit = money.sub(0, money.add(...bal.map((b) => b.net)));
    years.push({
      fy,
      label: fyLabel(fy),
      from,
      to,
      profit,
      closed: closed.has(fy),
      ended: today > to,
      blockers: closed.has(fy) ? [] : await draftsIn(tx, from, to),
    });
  }
  return years.reverse();
}

export async function closeYear(tx: Tx, fy: string, userId: number) {
  const { from, to } = fyRange(fy);
  if (localToday() <= to) throw new RecordError(422, `${fyLabel(fy)} has not ended yet; it can be closed after ${to}.`);
  const closes = tableFor(CLOSING_MODEL);
  await tx.execute(sql`select pg_advisory_xact_lock(7406002)`);
  const [existing] = await tx.select().from(closes).where(and(eq(closes.fy, fy), eq(closes.state, 'closed')));
  if (existing) throw new RecordError(409, `${fyLabel(fy)} is already closed.`);
  const lock = await lockDate(tx);
  const e = tableFor('account.entry');
  const [earlier] = await tx.select({ n: sql<number>`count(*)::int` }).from(e).where(and(sql`${e.date} < ${from}`, lock ? sql`${e.date} > ${lock.to}` : undefined));
  if (earlier!.n) throw new RecordError(422, 'Close the earlier financial year first.');
  const drafts = await draftsIn(tx, from, to);
  if (drafts.length) throw new RecordError(422, `Post or delete what is still in draft for ${fyLabel(fy)}: ${drafts.join(', ')}.`);

  const balances = (await resultBalances(tx, from, to)).filter((b) => money.cmp(b.net, 0) !== 0);
  const profit = money.sub(0, money.add(...balances.map((b) => b.net)));
  const [row] = await tx
    .insert(closes)
    .values({ fy, dateFrom: from, dateTo: to, profit, state: 'closing', createdBy: userId, updatedBy: userId })
    .returning({ id: closes.id });
  // Zero every income and expense account; the net goes to reserves.
  const lines: JournalLine[] = balances.map((b) => ({ account: b.accountId as number, amount: money.sub(0, b.net) }));
  lines.push({ account: 'retained_earnings', amount: money.add(...balances.map((b) => b.net)) });
  const entryId = await postJournal(
    tx,
    { date: to, reference: `Close ${fyLabel(fy)}`, narration: `Year-end closing ${fyLabel(fy)}`, refModel: CLOSING_MODEL, refId: row!.id as number },
    lines,
  );
  await tx.update(closes).set({ state: 'closed', entryId }).where(eq(closes.id, row!.id as number));
  await appendAudit(tx, { userId, model: CLOSING_MODEL, recordId: row!.id as number, action: 'close', changes: { profit: { from: null, to: profit } } });
  return { fy, profit, entryId };
}

/** Reopens the most recently closed year (its closing is reversed on the same date). */
export async function reopenYear(tx: Tx, fy: string, userId: number) {
  const { to } = fyRange(fy);
  const closes = tableFor(CLOSING_MODEL);
  await tx.execute(sql`select pg_advisory_xact_lock(7406002)`);
  const lock = await lockDate(tx);
  if (!lock || lock.fy !== fy) throw new RecordError(422, lock ? `Only the latest closed year (${fyLabel(lock.fy)}) can be reopened.` : 'No year is closed.');
  const [row] = await tx.select().from(closes).where(and(eq(closes.fy, fy), eq(closes.state, 'closed')));
  await tx.update(closes).set({ state: 'reopened' }).where(eq(closes.id, row!.id as number));
  await reverseJournal(tx, { date: to, reference: `Close ${fyLabel(fy)}`, refModel: CLOSING_MODEL, refId: row!.id as number }, { date: to });
  await appendAudit(tx, { userId, model: CLOSING_MODEL, recordId: row!.id as number, action: 'reopen', changes: { state: { from: 'closed', to: 'reopened' } } });
  return { fy };
}

