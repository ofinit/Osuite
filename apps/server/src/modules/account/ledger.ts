// Ledger (one account, or one party's statement of account) and day book, from the journal.
import { money } from '@osuite/kernel';
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../../db/client.ts';
import { RecordError } from '../../services/errors.ts';

export interface LedgerRow {
  lineId: number;
  date: string;
  entryId: number;
  entryNumber: string;
  reference: string;
  narration: string | null;
  refModel: string;
  refId: number;
  /** Account in account mode; the other side of the entry in party mode. */
  against: string;
  debit: string;
  credit: string;
  /** Running balance, debit-positive. */
  balance: string;
}

const rowsOf = <T>(r: unknown) => (r as { rows: T[] }).rows;
const dateStr = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v));

/**
 * Journal items for an account, or (partnerId without accountId) a party's
 * items on debtors and creditors, between two dates with the opening balance
 * carried in. Balances are debit-positive; the UI shows Dr/Cr.
 */
export async function ledger(tx: Tx, opts: { accountId?: number; partnerId?: number; from: string; to: string }) {
  const { accountId, partnerId, from, to } = opts;
  if (!accountId && !partnerId) throw new RecordError(400, 'Choose an account or a party');
  if (from > to) throw new RecordError(400, '"From" is after "To"');

  const scope: SQL[] = [];
  if (accountId) scope.push(sql`l.account_id = ${accountId}`);
  else scope.push(sql`l.account_id in (select id from account_account where key in ('receivable', 'payable'))`);
  if (partnerId) scope.push(sql`l.partner_id = ${partnerId}`);
  const where = sql.join(scope, sql` and `);

  const [account] = accountId
    ? rowsOf<{ id: number; code: string; name: string; type: string }>(
        await tx.execute(sql`select id, code, name, type from account_account where id = ${accountId}`),
      )
    : [];
  if (accountId && !account) throw new RecordError(404, 'Account not found');
  const [partner] = partnerId
    ? rowsOf<{ id: number; name: string; gstin: string | null }>(await tx.execute(sql`select id, name, gstin from contact where id = ${partnerId}`))
    : [];
  if (partnerId && !partner) throw new RecordError(404, 'Party not found');

  const [open] = rowsOf<{ net: string }>(
    await tx.execute(sql`select coalesce(sum(l.debit - l.credit), 0)::text as net from account_entry_line l where ${where} and l.date < ${from}`),
  );
  const opening = money.add(open!.net);

  // In account mode "against" is the other accounts in the entry; in party mode,
  // the account the party's item sits on is implied, so show the other side too.
  const raw = rowsOf<{
    line_id: string;
    date: unknown;
    entry_id: string;
    number: string;
    reference: string;
    narration: string | null;
    ref_model: string;
    ref_id: number;
    against: string | null;
    debit: string;
    credit: string;
  }>(
    await tx.execute(sql`
      select l.id as line_id, l.date, e.id as entry_id, e.number, e.reference, e.narration, e.ref_model, e.ref_id,
             (select string_agg(distinct a2.name, ', ')
                from account_entry_line o join account_account a2 on a2.id = o.account_id
               where o.entry_id = l.entry_id and o.id <> l.id
                 and sign(o.debit - o.credit) = -sign(l.debit - l.credit)) as against,
             l.debit::text, l.credit::text
        from account_entry_line l join account_entry e on e.id = l.entry_id
       where ${where} and l.date between ${from} and ${to}
       order by l.date, l.entry_id, l.id`),
  );

  let balance = opening;
  const rows: LedgerRow[] = raw.map((r) => {
    balance = money.add(balance, r.debit, money.sub(0, r.credit));
    return {
      lineId: Number(r.line_id),
      date: dateStr(r.date),
      entryId: Number(r.entry_id),
      entryNumber: r.number,
      reference: r.reference,
      narration: r.narration,
      refModel: r.ref_model,
      refId: r.ref_id,
      against: r.against ?? '',
      debit: money.add(r.debit),
      credit: money.add(r.credit),
      balance,
    };
  });
  const totalDebit = money.add(...rows.map((r) => r.debit));
  const totalCredit = money.add(...rows.map((r) => r.credit));
  return {
    from,
    to,
    account: account ? { id: Number(account.id), code: account.code, name: account.name, type: account.type } : null,
    partner: partner ? { id: Number(partner.id), name: partner.name, gstin: partner.gstin } : null,
    opening,
    rows,
    totalDebit,
    totalCredit,
    closing: balance,
  };
}

/** Every journal entry between two dates with its lines, oldest first. */
export async function dayBook(tx: Tx, from: string, to: string) {
  if (from > to) throw new RecordError(400, '"From" is after "To"');
  const raw = rowsOf<{
    entry_id: string;
    date: unknown;
    number: string;
    reference: string;
    narration: string | null;
    ref_model: string;
    ref_id: number;
    account: string;
    partner: string | null;
    debit: string;
    credit: string;
  }>(
    await tx.execute(sql`
      select e.id as entry_id, e.date, e.number, e.reference, e.narration, e.ref_model, e.ref_id,
             a.name as account, c.name as partner, l.debit::text, l.credit::text
        from account_entry e
        join account_entry_line l on l.entry_id = e.id
        join account_account a on a.id = l.account_id
        left join contact c on c.id = l.partner_id
       where e.date between ${from} and ${to}
       order by e.date, e.id, l.debit = 0, l.id`),
  );
  const entries: {
    id: number;
    date: string;
    number: string;
    reference: string;
    narration: string | null;
    refModel: string;
    refId: number;
    amount: string;
    lines: { account: string; partner: string | null; debit: string; credit: string }[];
  }[] = [];
  for (const r of raw) {
    let e = entries.at(-1);
    if (!e || e.id !== Number(r.entry_id)) {
      e = { id: Number(r.entry_id), date: dateStr(r.date), number: r.number, reference: r.reference, narration: r.narration, refModel: r.ref_model, refId: r.ref_id, amount: '0.00', lines: [] };
      entries.push(e);
    }
    const line = { account: r.account, partner: r.partner, debit: money.add(r.debit), credit: money.add(r.credit) };
    e.lines.push(line);
    e.amount = money.add(e.amount, line.debit);
  }
  const total = money.add(...entries.map((e) => e.amount));
  return { from, to, entries, total };
}
