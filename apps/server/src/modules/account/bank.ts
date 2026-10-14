// Bank reconciliation: import statements, match their lines to journal items
// on the bank's ledger account, and book the lines the books don't have yet.
import { createHash } from 'node:crypto';
import { money, parseBankDate, type StatementRow } from '@osuite/kernel';
import { and, asc, eq, gte, inArray, isNull, lte, notInArray, sql } from 'drizzle-orm';
import type { Tx } from '../../db/client.ts';
import { tableFor } from '../../db/tables.ts';
import { appendAudit } from '../../services/audit.ts';
import { RecordError } from '../../services/errors.ts';
import { postJournal } from './journal.ts';

/** How far apart (days) a bank date and a book date may be and still match. */
const DATE_WINDOW = 10;
const MAX_ROWS = 5000;

async function bank(tx: Tx, bankAccountId: number) {
  const t = tableFor('account.bank_account');
  const [b] = await tx.select().from(t).where(eq(t.id, bankAccountId));
  if (!b) throw new RecordError(404, 'Bank account not found');
  return b as { id: number; name: string; ledgerAccountId: number };
}

function checkRows(rows: unknown): StatementRow[] {
  if (!Array.isArray(rows) || !rows.length) throw new RecordError(422, 'The statement has no lines.');
  if (rows.length > MAX_ROWS) throw new RecordError(422, `Import at most ${MAX_ROWS} lines at a time.`);
  return rows.map((r, i) => {
    const row = r as Partial<StatementRow>;
    const date = typeof row.date === 'string' ? parseBankDate(row.date) : null;
    const amount = String(row.amount ?? '');
    if (!date) throw new RecordError(422, `Line ${i + 1}: invalid date.`);
    if (!/^-?\d{1,14}(\.\d{1,2})?$/.test(amount) || Number(amount) === 0) throw new RecordError(422, `Line ${i + 1}: invalid amount.`);
    return {
      date,
      description: String(row.description ?? '').slice(0, 300) || '(no description)',
      reference: row.reference ? String(row.reference).slice(0, 80) : null,
      amount: money.add(amount),
      balance: row.balance && /^-?\d+(\.\d{1,2})?$/.test(String(row.balance)) ? money.add(String(row.balance)) : null,
    };
  });
}

/**
 * Imports statement rows. Lines already imported for this bank (same date,
 * amount, text and position among identical lines) are skipped, so
 * overlapping downloads can be imported safely.
 */
export async function importStatement(tx: Tx, input: { bankAccountId: number; rows: unknown; closingBalance?: string | null }, userId: number) {
  const b = await bank(tx, Number(input.bankAccountId));
  const rows = checkRows(input.rows).sort((x, y) => x.date.localeCompare(y.date));
  const seen = new Map<string, number>();
  const withPrints = rows.map((r) => {
    const base = `${r.date}|${r.amount}|${r.description}|${r.reference ?? ''}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return { ...r, fingerprint: createHash('sha256').update(`${base}|${n}`).digest('hex') };
  });

  const lines = tableFor('account.statement_line');
  const existing = await tx
    .select({ fp: lines.fingerprint })
    .from(lines)
    .where(and(eq(lines.bankAccountId, b.id), inArray(lines.fingerprint, withPrints.map((r) => r.fingerprint))));
  const known = new Set(existing.map((e) => String(e.fp)));
  const fresh = withPrints.filter((r) => !known.has(r.fingerprint));
  if (!fresh.length) throw new RecordError(409, `All ${rows.length} lines were imported before.`);

  const closing = input.closingBalance ? money.add(input.closingBalance) : (rows[rows.length - 1]!.balance ?? null);
  const statements = tableFor('account.statement');
  const dateFrom = fresh[0]!.date;
  const dateTo = fresh[fresh.length - 1]!.date;
  const [st] = await tx
    .insert(statements)
    .values({
      name: `${b.name}, ${dateFrom} to ${dateTo}`,
      bankAccountId: b.id,
      dateFrom,
      dateTo,
      closingBalance: closing,
      lineCount: fresh.length,
      createdBy: userId,
      updatedBy: userId,
    })
    .returning({ id: statements.id });
  await tx.insert(lines).values(
    fresh.map((r, i) => ({ ...r, statementId: st!.id, sequence: i + 1, bankAccountId: b.id, createdBy: userId, updatedBy: userId })),
  );
  await appendAudit(tx, { userId, model: 'account.statement', recordId: st!.id as number, action: 'import', changes: { lines: { from: 0, to: fresh.length } } });
  return { statementId: st!.id as number, imported: fresh.length, duplicates: rows.length - fresh.length };
}

export interface Candidate {
  entryLineId: number;
  date: string;
  entryNumber: string;
  reference: string;
  narration: string | null;
  partner: string | null;
  paymentReference: string | null;
  amount: string;
  /** The bank text mentions the payment's UTR/cheque number or the document number. */
  referenceMatch: boolean;
  daysApart: number;
}

const days = (a: string, b: string) => Math.round(Math.abs(Date.parse(a) - Date.parse(b)) / 86_400_000);

/** Unmatched journal items on the bank's ledger with the same amount near the date, best first. */
async function candidates(tx: Tx, ledgerAccountId: number, line: { date: string; amount: string; description: string; reference: string | null }, exclude: number[] = []) {
  const items = tableFor('account.entry_line');
  const entries = tableFor('account.entry');
  const payments = tableFor('account.payment');
  const contacts = tableFor('base.contact');
  const stLines = tableFor('account.statement_line');
  const from = new Date(Date.parse(line.date) - DATE_WINDOW * 86_400_000).toISOString().slice(0, 10);
  const to = new Date(Date.parse(line.date) + DATE_WINDOW * 86_400_000).toISOString().slice(0, 10);
  const rows = await tx
    .select({
      entryLineId: items.id,
      date: items.date,
      debit: items.debit,
      credit: items.credit,
      entryNumber: entries.number,
      reference: entries.reference,
      narration: entries.narration,
      partner: contacts.name,
      paymentReference: payments.reference,
    })
    .from(items)
    .innerJoin(entries, eq(entries.id, items.entryId))
    .leftJoin(payments, and(eq(entries.refModel, 'account.payment'), eq(payments.id, entries.refId)))
    .leftJoin(contacts, eq(contacts.id, sql`coalesce(${items.partnerId}, ${payments.partnerId})`))
    .leftJoin(stLines, eq(stLines.entryLineId, items.id))
    .where(
      and(
        eq(items.accountId, ledgerAccountId),
        isNull(stLines.id),
        // A cancelled document and its reversal never reach the bank.
        isNull(entries.reversedById),
        sql`${entries.reference} not like 'Cancel %'`,
        gte(items.date, from),
        lte(items.date, to),
        sql`${items.debit} - ${items.credit} = ${line.amount}`,
        exclude.length ? notInArray(items.id, exclude) : undefined,
      ),
    );
  const text = `${line.description} ${line.reference ?? ''}`.toLowerCase();
  const mentions = (s: unknown) => typeof s === 'string' && s.length >= 4 && text.includes(s.toLowerCase());
  return rows
    .map(
      (r): Candidate => ({
        entryLineId: r.entryLineId as number,
        date: String(r.date),
        entryNumber: String(r.entryNumber),
        reference: String(r.reference),
        narration: (r.narration as string | null) ?? null,
        partner: (r.partner as string | null) ?? null,
        paymentReference: (r.paymentReference as string | null) ?? null,
        amount: money.sub(r.debit as string, r.credit as string),
        referenceMatch: mentions(r.paymentReference) || mentions(r.reference),
        daysApart: days(String(r.date), line.date),
      }),
    )
    .sort((a, b) => Number(b.referenceMatch) - Number(a.referenceMatch) || a.daysApart - b.daysApart || a.entryLineId - b.entryLineId);
}

async function lineWithBank(tx: Tx, lineId: number) {
  const lines = tableFor('account.statement_line');
  const [l] = await tx.select().from(lines).where(eq(lines.id, lineId)).for('update');
  if (!l) throw new RecordError(404, 'Statement line not found');
  const b = await bank(tx, l.bankAccountId as number);
  return { line: l, bank: b };
}

/** Statement lines with their match or suggestions, and the reconciliation summary. */
export async function reconcileView(tx: Tx, statementId: number) {
  const statements = tableFor('account.statement');
  const [st] = await tx.select().from(statements).where(eq(statements.id, statementId));
  if (!st) throw new RecordError(404, 'Statement not found');
  const b = await bank(tx, st.bankAccountId as number);
  const lines = tableFor('account.statement_line');
  const items = tableFor('account.entry_line');
  const entries = tableFor('account.entry');
  const rows = await tx
    .select({
      id: lines.id,
      date: lines.date,
      description: lines.description,
      reference: lines.reference,
      amount: lines.amount,
      balance: lines.balance,
      entryLineId: lines.entryLineId,
      matchedNumber: entries.number,
      matchedReference: entries.reference,
      matchedNarration: entries.narration,
    })
    .from(lines)
    .leftJoin(items, eq(items.id, lines.entryLineId))
    .leftJoin(entries, eq(entries.id, items.entryId))
    .where(eq(lines.statementId, statementId))
    .orderBy(asc(lines.sequence));

  const out = [];
  for (const r of rows) {
    const base = {
      id: r.id as number,
      date: String(r.date),
      description: String(r.description),
      reference: (r.reference as string | null) ?? null,
      amount: String(r.amount),
      balance: (r.balance as string | null) ?? null,
    };
    if (r.entryLineId) {
      out.push({ ...base, matched: { entryLineId: r.entryLineId as number, entryNumber: String(r.matchedNumber), reference: String(r.matchedReference), narration: r.matchedNarration as string | null } });
    } else {
      out.push({ ...base, matched: null, suggestions: (await candidates(tx, b.ledgerAccountId, base)).slice(0, 3) });
    }
  }

  // Book balance on the ledger up to the statement end, and what the bank hasn't shown yet.
  const [book] = await tx
    .select({ balance: sql<string>`coalesce(sum(${items.debit} - ${items.credit}), 0)` })
    .from(items)
    .where(and(eq(items.accountId, b.ledgerAccountId), lte(items.date, String(st.dateTo))));
  const [open] = await tx
    .select({ count: sql<number>`count(*)::int`, total: sql<string>`coalesce(sum(${items.debit} - ${items.credit}), 0)` })
    .from(items)
    .innerJoin(entries, eq(entries.id, items.entryId))
    .leftJoin(lines, eq(lines.entryLineId, items.id))
    .where(
      and(
        eq(items.accountId, b.ledgerAccountId),
        lte(items.date, String(st.dateTo)),
        isNull(lines.id),
        isNull(entries.reversedById),
        sql`${entries.reference} not like 'Cancel %'`,
      ),
    );

  return {
    statement: {
      id: st.id as number,
      name: String(st.name),
      bankAccount: b.name,
      dateFrom: String(st.dateFrom),
      dateTo: String(st.dateTo),
      closingBalance: (st.closingBalance as string | null) ?? null,
    },
    lines: out,
    summary: {
      matched: out.filter((l) => l.matched).length,
      total: out.length,
      bookBalance: money.add(book!.balance),
      unreconciledBookItems: open!.count,
      unreconciledBookTotal: money.add(open!.total),
      difference: st.closingBalance === null ? null : money.sub(st.closingBalance as string, book!.balance),
    },
  };
}

export async function matchLine(tx: Tx, lineId: number, entryLineId: number, userId: number) {
  const { line, bank: b } = await lineWithBank(tx, lineId);
  if (line.entryLineId) throw new RecordError(409, 'This line is already matched. Unmatch it first.');
  const found = (await candidates(tx, b.ledgerAccountId, { date: String(line.date), amount: String(line.amount), description: String(line.description), reference: line.reference as string | null })).find(
    (c) => c.entryLineId === entryLineId,
  );
  if (!found) throw new RecordError(422, 'That book entry is not on this bank account with the same amount and a nearby date, or is already matched.');
  const lines = tableFor('account.statement_line');
  await tx.update(lines).set({ entryLineId, updatedBy: userId, updatedAt: new Date().toISOString() }).where(eq(lines.id, lineId));
  await appendAudit(tx, { userId, model: 'account.statement_line', recordId: lineId, action: 'match', changes: { entryLineId: { from: null, to: entryLineId } } });
}

export async function unmatchLine(tx: Tx, lineId: number, userId: number) {
  const { line } = await lineWithBank(tx, lineId);
  if (!line.entryLineId) throw new RecordError(409, 'This line is not matched.');
  const lines = tableFor('account.statement_line');
  await tx.update(lines).set({ entryLineId: null, updatedBy: userId, updatedAt: new Date().toISOString() }).where(eq(lines.id, lineId));
  await appendAudit(tx, { userId, model: 'account.statement_line', recordId: lineId, action: 'unmatch', changes: { entryLineId: { from: line.entryLineId, to: null } } });
}

/** Matches every line with one clear candidate (a reference hit, or the only same-amount entry). */
export async function autoMatch(tx: Tx, statementId: number, userId: number) {
  const lines = tableFor('account.statement_line');
  const open = await tx
    .select()
    .from(lines)
    .where(and(eq(lines.statementId, statementId), isNull(lines.entryLineId)))
    .orderBy(asc(lines.sequence));
  if (!open.length) return { matched: 0 };
  const b = await bank(tx, open[0]!.bankAccountId as number);
  const used: number[] = [];
  let matched = 0;
  for (const l of open) {
    const c = await candidates(tx, b.ledgerAccountId, { date: String(l.date), amount: String(l.amount), description: String(l.description), reference: l.reference as string | null }, used);
    const refHits = c.filter((x) => x.referenceMatch);
    const pick = refHits.length === 1 ? refHits[0] : c.length === 1 ? c[0] : undefined;
    if (!pick) continue;
    await tx.update(lines).set({ entryLineId: pick.entryLineId, updatedBy: userId, updatedAt: new Date().toISOString() }).where(eq(lines.id, l.id as number));
    await appendAudit(tx, { userId, model: 'account.statement_line', recordId: l.id as number, action: 'match', changes: { entryLineId: { from: null, to: pick.entryLineId } } });
    used.push(pick.entryLineId);
    matched++;
  }
  return { matched };
}

/**
 * Books a statement line the books don't have yet (bank charges, interest,
 * direct debits) against `accountId`, then matches it.
 */
export async function bookLine(tx: Tx, lineId: number, input: { accountId?: unknown; partnerId?: unknown; narration?: unknown }, userId: number) {
  const { line, bank: b } = await lineWithBank(tx, lineId);
  if (line.entryLineId) throw new RecordError(409, 'This line is already matched.');
  const accountId = Number(input.accountId);
  const accounts = tableFor('account.account');
  const [acc] = await tx.select({ id: accounts.id }).from(accounts).where(eq(accounts.id, accountId));
  if (!acc) throw new RecordError(422, 'Choose the account to book this against.', { accountId: 'Required' });
  if (accountId === b.ledgerAccountId) throw new RecordError(422, 'Choose an account other than the bank itself.', { accountId: 'Not the bank account' });
  const amount = String(line.amount);
  const partnerId = input.partnerId ? Number(input.partnerId) : null;
  const entryId = await postJournal(
    tx,
    {
      date: String(line.date),
      reference: (line.reference as string | null) || `Bank ${String(line.date)}`,
      narration: String(input.narration ?? '').trim().slice(0, 200) || String(line.description).slice(0, 200),
      refModel: 'account.statement_line',
      refId: lineId,
    },
    // Money in: debit the bank, credit the account. Money out: the reverse.
    [
      { account: b.ledgerAccountId, amount },
      { account: accountId, amount: money.sub(0, amount), partnerId },
    ],
  );
  const items = tableFor('account.entry_line');
  const [bankItem] = await tx
    .select({ id: items.id })
    .from(items)
    .where(and(eq(items.entryId, entryId!), eq(items.accountId, b.ledgerAccountId)));
  const lines = tableFor('account.statement_line');
  await tx.update(lines).set({ entryLineId: bankItem!.id, updatedBy: userId, updatedAt: new Date().toISOString() }).where(eq(lines.id, lineId));
  await appendAudit(tx, { userId, model: 'account.statement_line', recordId: lineId, action: 'book', changes: { entryLineId: { from: null, to: bankItem!.id }, accountId: { from: null, to: accountId } } });
  return { entryId };
}

