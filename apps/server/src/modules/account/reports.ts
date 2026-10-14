// Financial statements from the journal, and GST returns from posted documents.
import { IN_STATES, localToday, money } from '@osuite/kernel';
import { and, asc, eq, gte, lte, sql } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import type { Tx } from '../../db/client.ts';
import { tableFor, type AnyTable } from '../../db/tables.ts';
import { RecordError } from '../../services/errors.ts';
import { CLOSING_MODEL } from './lock.ts';

type AccountType = 'asset' | 'liability' | 'equity' | 'income' | 'expense';

export interface AccountBalance {
  accountId: number;
  code: string;
  name: string;
  type: AccountType;
  debit: string;
  credit: string;
  /** Natural-side balance: debit-positive for assets/expenses, credit-positive otherwise. */
  balance: string;
}

const DEBIT_NATURE = new Set<AccountType>(['asset', 'expense']);
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function checkDate(v: string | undefined, fallback: string): string {
  if (!v) return fallback;
  if (!ISO.test(v)) throw new RecordError(400, `Invalid date "${v}"`);
  return v;
}

async function balances(tx: Tx, from: string | null, to: string, opts: { excludeClosing?: boolean } = {}): Promise<AccountBalance[]> {
  const a = tableFor('account.account');
  const l = tableFor('account.entry_line');
  const e = tableFor('account.entry');
  const rows = await tx
    .select({
      accountId: a.id,
      code: a.code,
      name: a.name,
      type: a.type,
      debit: sql<string>`coalesce(sum(${l.debit}), 0)`,
      credit: sql<string>`coalesce(sum(${l.credit}), 0)`,
    })
    .from(a)
    .innerJoin(l, eq(l.accountId, a.id))
    .innerJoin(e, eq(e.id, l.entryId))
    .where(and(lte(l.date, to), from ? gte(l.date, from) : undefined, opts.excludeClosing ? sql`${e.refModel} <> ${CLOSING_MODEL}` : undefined))
    .groupBy(a.id, a.code, a.name, a.type)
    .orderBy(asc(a.code));
  return rows
    .map((r) => {
      const debit = money.add(r.debit);
      const credit = money.add(r.credit);
      const type = r.type as AccountType;
      return {
        accountId: r.accountId as number,
        code: String(r.code),
        name: String(r.name),
        type,
        debit,
        credit,
        balance: DEBIT_NATURE.has(type) ? money.sub(debit, credit) : money.sub(credit, debit),
      };
    })
    .filter((r) => money.cmp(r.debit, 0) !== 0 || money.cmp(r.credit, 0) !== 0);
}

export async function trialBalance(tx: Tx, asOf = localToday()) {
  const rows = await balances(tx, null, asOf);
  // Each account on the side its net balance falls.
  const lines = rows.map((r) => {
    const net = money.sub(r.debit, r.credit);
    return { ...r, closingDebit: money.isPositive(net) ? net : '0.00', closingCredit: money.isPositive(net) ? '0.00' : money.sub(0, net) };
  });
  const totalDebit = money.add(...lines.map((r) => r.closingDebit));
  const totalCredit = money.add(...lines.map((r) => r.closingCredit));
  return { asOf, rows: lines, totalDebit, totalCredit, balanced: money.cmp(totalDebit, totalCredit) === 0 };
}

export async function profitAndLoss(tx: Tx, from: string, to: string) {
  const rows = await balances(tx, from, to, { excludeClosing: true });
  const income = rows.filter((r) => r.type === 'income');
  const expense = rows.filter((r) => r.type === 'expense');
  const totalIncome = money.add(...income.map((r) => r.balance));
  const totalExpense = money.add(...expense.map((r) => r.balance));
  return { from, to, income, expense, totalIncome, totalExpense, netProfit: money.sub(totalIncome, totalExpense) };
}

export async function balanceSheet(tx: Tx, asOf = localToday()) {
  const rows = await balances(tx, null, asOf);
  const of = (t: AccountType) => rows.filter((r) => r.type === t);
  const sum = (rs: AccountBalance[]) => money.add(...rs.map((r) => r.balance));
  // No year-end closing yet: accumulated profit is shown within equity.
  const profit = money.sub(sum(of('income')), sum(of('expense')));
  const assets = of('asset');
  const liabilities = of('liability');
  const equity = of('equity');
  const totalAssets = sum(assets);
  const totalLiabilities = sum(liabilities);
  const totalEquity = money.add(sum(equity), profit);
  return {
    asOf,
    assets,
    liabilities,
    equity,
    profit,
    totalAssets,
    totalLiabilities,
    totalEquity,
    balanced: money.cmp(totalAssets, money.add(totalLiabilities, totalEquity)) === 0,
  };
}

// ---------------------------------------------------------------- GST returns

function monthRange(month: string | undefined): { month: string; from: string; to: string } {
  const m = month ?? localToday().slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(m)) throw new RecordError(400, `Invalid month "${month}"`);
  const [y, mm] = m.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, mm, 0)).getUTCDate();
  return { month: m, from: `${m}-01`, to: `${m}-${String(last).padStart(2, '0')}` };
}

const stateLabel = (code: string) => `${code}-${IN_STATES.find(([c]) => c === code)?.[1] ?? ''}`;

interface TaxLine {
  /** Document id: invoice, or credit note. */
  invoiceId: number;
  /** Credit notes: the original invoice's number and date. */
  originalNumber?: string;
  originalDate?: string;
  number: string;
  date: string;
  customer: string;
  gstin: string | null;
  pos: string;
  invoiceTotal: string;
  interState: boolean;
  hsn: string;
  uom: string;
  qty: string;
  rate: string;
  taxable: string;
  igst: string;
  cgst: string;
  sgst: string;
}

/** Posted invoice (or credit note) lines in a period with their tax split by head. */
async function invoiceTaxLines(tx: Tx, from: string, to: string, kind: 'invoice' | 'credit_note' = 'invoice'): Promise<TaxLine[]> {
  const isNote = kind === 'credit_note';
  const inv = tableFor(isNote ? 'sales.credit_note' : 'sales.invoice');
  const line = tableFor(isNote ? 'sales.credit_note_line' : 'sales.invoice_line');
  // Aliased: for invoices this is the same table as the main one.
  const original = alias(tableFor('sales.invoice'), 'original_invoice') as unknown as AnyTable;
  const c = tableFor('base.contact');
  const rows = await tx
    .select({
      originalNumber: isNote ? original.number : sql<null>`null`,
      originalDate: isNote ? original.date : sql<null>`null`,
      invoiceId: inv.id,
      number: inv.number,
      date: inv.date,
      customer: c.name,
      gstin: inv.customerGstin,
      pos: inv.placeOfSupply,
      invoiceTotal: inv.totalAmount,
      igstTotal: inv.igstAmount,
      hsn: line.hsnCode,
      uom: line.uom,
      qty: line.qty,
      rate: line.gstRate,
      taxable: line.taxableAmount,
      tax: line.taxAmount,
    })
    .from(inv)
    .innerJoin(line, eq(isNote ? line.creditNoteId : line.invoiceId, inv.id))
    .innerJoin(c, eq(c.id, inv.customerId))
    .leftJoin(original, isNote ? eq(original.id, inv.invoiceId) : sql`false`)
    .where(and(eq(inv.state, 'posted'), gte(inv.date, from), lte(inv.date, to)))
    .orderBy(asc(inv.date), asc(inv.id), asc(line.sequence));
  return rows.map((r) => {
    const interState = money.isPositive(r.igstTotal as string);
    const tax = String(r.tax);
    // Intra-state lines carry CGST and SGST in two equal halves.
    const half = money.half(tax);
    return {
      invoiceId: r.invoiceId as number,
      originalNumber: r.originalNumber ? String(r.originalNumber) : undefined,
      originalDate: r.originalDate ? String(r.originalDate) : undefined,
      number: String(r.number),
      date: String(r.date),
      customer: String(r.customer),
      gstin: (r.gstin as string | null) || null,
      pos: String(r.pos),
      invoiceTotal: String(r.invoiceTotal),
      interState,
      hsn: String(r.hsn ?? ''),
      uom: String(r.uom),
      qty: String(r.qty),
      rate: String(r.rate),
      taxable: String(r.taxable),
      igst: interState ? tax : '0.00',
      cgst: interState ? '0.00' : half,
      sgst: interState ? '0.00' : half,
    };
  });
}

type Heads = { taxable: string; igst: string; cgst: string; sgst: string };
const zero = (): Heads => ({ taxable: '0.00', igst: '0.00', cgst: '0.00', sgst: '0.00' });
const addHeads = (a: Heads, b: Heads): Heads => ({
  taxable: money.add(a.taxable, b.taxable),
  igst: money.add(a.igst, b.igst),
  cgst: money.add(a.cgst, b.cgst),
  sgst: money.add(a.sgst, b.sgst),
});

/** B2C inter-state invoices above this value are reported invoice-wise (B2CL). */
export const B2CL_LIMIT = '100000';

export async function gstr1(tx: Tx, monthArg?: string) {
  const { month, from, to } = monthRange(monthArg);
  const lines = await invoiceTaxLines(tx, from, to);

  const group = <K extends string>(rows: TaxLine[], key: (l: TaxLine) => K) => {
    const m = new Map<K, { first: TaxLine; heads: Heads; qty: string }>();
    for (const l of rows) {
      const k = key(l);
      const g = m.get(k) ?? { first: l, heads: zero(), qty: '0' };
      g.heads = addHeads(g.heads, l);
      g.qty = String(Number(g.qty) + Number(l.qty));
      m.set(k, g);
    }
    return [...m.values()];
  };

  const b2bLines = lines.filter((l) => l.gstin);
  const b2c = lines.filter((l) => !l.gstin);
  const isB2cl = (l: TaxLine) => l.interState && money.cmp(l.invoiceTotal, B2CL_LIMIT) > 0;

  const invoiceRows = (rows: TaxLine[]) =>
    group(rows, (l) => `${l.invoiceId}|${l.rate}`).map(({ first: l, heads }) => ({
      gstin: l.gstin,
      customer: l.customer,
      number: l.number,
      date: l.date,
      invoiceValue: l.invoiceTotal,
      placeOfSupply: stateLabel(l.pos),
      rate: l.rate,
      ...heads,
    }));

  const b2cs = group(b2c.filter((l) => !isB2cl(l)), (l) => `${l.pos}|${l.rate}`).map(({ first: l, heads }) => ({
    placeOfSupply: stateLabel(l.pos),
    type: l.interState ? 'Inter-state' : 'Intra-state',
    rate: l.rate,
    ...heads,
  }));

  const noteLines = await invoiceTaxLines(tx, from, to, 'credit_note');
  // HSN totals are net of credit notes issued in the month.
  const negated = noteLines.map((l) => ({
    ...l,
    qty: String(-Number(l.qty)),
    taxable: money.sub(0, l.taxable),
    igst: money.sub(0, l.igst),
    cgst: money.sub(0, l.cgst),
    sgst: money.sub(0, l.sgst),
  }));
  const hsn = group([...lines, ...negated], (l) => `${l.hsn}|${l.uom}|${l.rate}`).map(({ first: l, heads, qty }) => ({
    hsn: l.hsn || '—',
    uom: l.uom,
    rate: l.rate,
    qty: String(Number(Number(qty).toFixed(3))),
    totalValue: money.add(heads.taxable, heads.igst, heads.cgst, heads.sgst),
    ...heads,
  }));

  // Credit notes: registered customers (CDNR) and unregistered (CDNUR).
  const noteRows = (rows: TaxLine[]) =>
    group(rows, (l) => `${l.invoiceId}|${l.rate}`).map(({ first: l, heads }) => ({
      gstin: l.gstin,
      customer: l.customer,
      noteNumber: l.number,
      date: l.date,
      noteType: 'C',
      originalInvoice: l.originalNumber ?? null,
      originalDate: l.originalDate ?? null,
      noteValue: l.invoiceTotal,
      placeOfSupply: stateLabel(l.pos),
      rate: l.rate,
      ...heads,
    }));

  const inv = tableFor('sales.invoice');
  const docs = await tx
    .select({ state: inv.state, number: inv.number })
    .from(inv)
    .where(and(gte(inv.date, from), lte(inv.date, to), sql`${inv.number} is not null`))
    .orderBy(asc(inv.number));
  const numbers = docs.map((d) => String(d.number));

  return {
    month,
    b2b: invoiceRows(b2bLines),
    b2cl: invoiceRows(b2c.filter(isB2cl)),
    b2cs,
    cdnr: noteRows(noteLines.filter((l) => l.gstin)),
    cdnur: noteRows(noteLines.filter((l) => !l.gstin)),
    hsn,
    documents: {
      from: numbers[0] ?? null,
      to: numbers[numbers.length - 1] ?? null,
      issued: docs.length,
      cancelled: docs.filter((d) => d.state === 'cancelled').length,
    },
    totals: lines.reduce((acc, l) => addHeads(acc, l), zero()),
  };
}

export async function gstr3b(tx: Tx, monthArg?: string) {
  const { month, from, to } = monthRange(monthArg);
  const lines = await invoiceTaxLines(tx, from, to);
  // Credit notes issued this month reduce outward supplies.
  const credited = await invoiceTaxLines(tx, from, to, 'credit_note');
  const minus = (h: Heads): Heads => ({ taxable: money.sub(0, h.taxable), igst: money.sub(0, h.igst), cgst: money.sub(0, h.cgst), sgst: money.sub(0, h.sgst) });
  const taxableOut = [...lines, ...credited.map((l) => ({ ...l, ...minus(l) }))]
    .filter((l) => Number(l.rate) > 0)
    .reduce((a, l) => addHeads(a, l), zero());
  const nilRated = money.add(
    ...lines.filter((l) => Number(l.rate) === 0).map((l) => l.taxable),
    ...credited.filter((l) => Number(l.rate) === 0).map((l) => money.sub(0, l.taxable)),
  );

  const bill = tableFor('purchase.bill');
  const [itc] = await tx
    .select({
      taxable: sql<string>`coalesce(sum(${bill.taxableAmount}), 0)`,
      igst: sql<string>`coalesce(sum(${bill.igstAmount}), 0)`,
      cgst: sql<string>`coalesce(sum(${bill.cgstAmount}), 0)`,
      sgst: sql<string>`coalesce(sum(${bill.sgstAmount}), 0)`,
    })
    .from(bill)
    .where(and(eq(bill.state, 'posted'), gte(bill.date, from), lte(bill.date, to)));
  // Debit notes issued this month reverse input tax credit.
  const dn = tableFor('purchase.debit_note');
  const [rev] = await tx
    .select({
      taxable: sql<string>`coalesce(sum(${dn.taxableAmount}), 0)`,
      igst: sql<string>`coalesce(sum(${dn.igstAmount}), 0)`,
      cgst: sql<string>`coalesce(sum(${dn.cgstAmount}), 0)`,
      sgst: sql<string>`coalesce(sum(${dn.sgstAmount}), 0)`,
    })
    .from(dn)
    .where(and(eq(dn.state, 'posted'), gte(dn.date, from), lte(dn.date, to)));
  const input: Heads = {
    taxable: money.sub(itc!.taxable, rev!.taxable),
    igst: money.sub(itc!.igst, rev!.igst),
    cgst: money.sub(itc!.cgst, rev!.cgst),
    sgst: money.sub(itc!.sgst, rev!.sgst),
  };

  // Simple per-head netting; statutory cross-utilisation of IGST credit is not applied.
  const net = (h: 'igst' | 'cgst' | 'sgst') => money.sub(taxableOut[h], input[h]);
  return {
    month,
    outward: { taxable: taxableOut, nilRated },
    itc: input,
    netPayable: { igst: net('igst'), cgst: net('cgst'), sgst: net('sgst') },
  };
}
