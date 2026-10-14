import { localToday, money } from '@osuite/kernel';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { CircleCheck, Download, TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api.ts';
import { formatDate, formatDecimal } from '../lib/format.ts';

type Row = { accountId: number; code: string; name: string; balance: string };
const fmt = (v: string) => formatDecimal(v);
const blank = (v: string) => (Number(v) === 0 ? '' : formatDecimal(v));

export function Page({ title, controls, children }: { title: string; controls?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="h-full overflow-y-auto px-5 py-6 sm:px-10">
      <header className="mb-5 flex flex-wrap items-end gap-4">
        <h1 className="mr-auto text-[22px] font-semibold tracking-tight">{title}</h1>
        {controls}
      </header>
      {children}
    </div>
  );
}

export function DateInput({ label, value, onChange, type = 'date' }: { label: string; value: string; onChange: (v: string) => void; type?: 'date' | 'month' }) {
  return (
    <label className="flex items-center gap-2 text-[13px] text-ink-2">
      {label}
      <input type={type} className="field-input h-8 w-auto" value={value} onChange={(e) => e.target.value && onChange(e.target.value)} />
    </label>
  );
}

function Balanced({ ok, okText, badText }: { ok: boolean; okText: string; badText: string }) {
  return (
    <p className={clsx('mt-4 flex items-center gap-2 text-[13px]', ok ? 'text-ok' : 'text-crimson')}>
      {ok ? <CircleCheck size={15} /> : <TriangleAlert size={15} />}
      {ok ? okText : badText}
    </p>
  );
}

export const th = 'border-b border-rule-strong py-2 pr-4 text-[12.5px] font-medium whitespace-nowrap text-ink-2';
export const td = 'border-b border-rule py-2 pr-4';
export const num = 'text-right tabular-nums';

/** Account lines for statements; each links to its journal items. */
function AccountRows({ rows, range }: { rows: Row[]; range: string }) {
  return (
    <>
      {rows.map((r) => (
        <tr key={r.accountId} className="hover:bg-sheet">
          <td className={td}>
            {r.accountId > 0 ? (
              <Link to={`/reports/ledger?account=${r.accountId}&${range}`} className="underline-offset-2 hover:underline">
                <span className="mr-2 text-ink-3 tabular-nums">{r.code}</span>
                {r.name}
              </Link>
            ) : (
              r.name
            )}
          </td>
          <td className={clsx(td, num)}>{fmt(r.balance)}</td>
        </tr>
      ))}
    </>
  );
}

function Section({ title, rows, total, totalLabel, range }: { title: string; rows: Row[]; total: string; totalLabel: string; range: string }) {
  return (
    <table className="mb-8 w-full max-w-2xl border-separate border-spacing-0 text-left">
      <thead>
        <tr>
          <th className={th}>{title}</th>
          <th className={clsx(th, num)}>Amount</th>
        </tr>
      </thead>
      <tbody>
        {rows.length ? (
          <AccountRows rows={rows} range={range} />
        ) : (
          <tr>
            <td colSpan={2} className={clsx(td, 'text-ink-3')}>
              Nothing yet
            </td>
          </tr>
        )}
        <tr className="font-semibold">
          <td className="py-2 pr-4">{totalLabel}</td>
          <td className={clsx('py-2 pr-4', num)}>{fmt(total)}</td>
        </tr>
      </tbody>
    </table>
  );
}

export function TrialBalanceView() {
  const [asOf, setAsOf] = useState(localToday());
  const { data } = useQuery({ queryKey: ['tb', asOf], queryFn: () => api.report('trial-balance', { asOf }) });
  return (
    <Page title="Trial balance" controls={<DateInput label="As of" value={asOf} onChange={setAsOf} />}>
      {data && (
        <>
          <table className="w-full max-w-3xl border-separate border-spacing-0 text-left">
            <thead>
              <tr>
                <th className={th}>Account</th>
                <th className={clsx(th, num)}>Debit</th>
                <th className={clsx(th, num)}>Credit</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.accountId} className="hover:bg-sheet">
                  <td className={td}>
                    <Link to={`/reports/ledger?account=${r.accountId}&from=${fyStart(asOf)}&to=${asOf}`} className="underline-offset-2 hover:underline">
                      <span className="mr-2 text-ink-3 tabular-nums">{r.code}</span>
                      {r.name}
                    </Link>
                  </td>
                  <td className={clsx(td, num)}>{blank(r.closingDebit)}</td>
                  <td className={clsx(td, num)}>{blank(r.closingCredit)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="border-t-2 border-ink py-2 pr-4">Total</td>
                <td className={clsx('border-t-2 border-ink py-2 pr-4', num)}>{fmt(data.totalDebit)}</td>
                <td className={clsx('border-t-2 border-ink py-2 pr-4', num)}>{fmt(data.totalCredit)}</td>
              </tr>
            </tfoot>
          </table>
          {data.rows.length === 0 && <p className="py-8 text-ink-3">No entries yet. Post an invoice, bill or payment to start the books.</p>}
          <Balanced ok={data.balanced} okText="Debits equal credits." badText="Debits and credits differ. Contact support." />
        </>
      )}
    </Page>
  );
}

export function fyStart(d: string) {
  const y = Number(d.slice(0, 4));
  return `${Number(d.slice(5, 7)) >= 4 ? y : y - 1}-04-01`;
}

export function ProfitLossView() {
  const [to, setTo] = useState(localToday());
  const [from, setFrom] = useState(fyStart(localToday()));
  const { data } = useQuery({ queryKey: ['pl', from, to], queryFn: () => api.report('profit-loss', { from, to }) });
  return (
    <Page
      title="Profit & loss"
      controls={
        <>
          <DateInput label="From" value={from} onChange={setFrom} />
          <DateInput label="To" value={to} onChange={setTo} />
        </>
      }
    >
      {data && (
        <>
          <Section title="Income" rows={data.income} total={data.totalIncome} totalLabel="Total income" range={`from=${from}&to=${to}`} />
          <Section title="Expenses" rows={data.expense} total={data.totalExpense} totalLabel="Total expenses" range={`from=${from}&to=${to}`} />
          <p className="flex max-w-2xl justify-between border-t-2 border-ink py-2 text-[17px] font-semibold">
            <span>{Number(data.netProfit) >= 0 ? 'Net profit' : 'Net loss'}</span>
            <span className="tabular-nums">₹{fmt(data.netProfit.replace('-', ''))}</span>
          </p>
        </>
      )}
    </Page>
  );
}

export function BalanceSheetView() {
  const [asOf, setAsOf] = useState(localToday());
  const { data } = useQuery({ queryKey: ['bs', asOf], queryFn: () => api.report('balance-sheet', { asOf }) });
  return (
    <Page title="Balance sheet" controls={<DateInput label="As of" value={asOf} onChange={setAsOf} />}>
      {data && (
        <div className="grid gap-x-12 lg:grid-cols-2">
          <div>
            <Section title="Assets" rows={data.assets} total={data.totalAssets} totalLabel="Total assets" range={`from=${fyStart(asOf)}&to=${asOf}`} />
          </div>
          <div>
            <Section title="Liabilities" rows={data.liabilities} total={data.totalLiabilities} totalLabel="Total liabilities" range={`from=${fyStart(asOf)}&to=${asOf}`} />
            <Section
              title="Equity"
              rows={[...data.equity, { accountId: -1, code: '', name: 'Profit not yet closed to capital', balance: data.profit }]}
              total={data.totalEquity}
              totalLabel="Total equity"
              range={`from=${fyStart(asOf)}&to=${asOf}`}
            />
            <p className="flex max-w-2xl justify-between border-t-2 border-ink py-2 font-semibold">
              <span>Liabilities and equity</span>
              <span className="tabular-nums">{fmt(money.add(data.totalLiabilities, data.totalEquity))}</span>
            </p>
          </div>
          <div className="lg:col-span-2">
            <Balanced ok={data.balanced} okText="Assets equal liabilities plus equity." badText="The balance sheet does not balance. Contact support." />
          </div>
        </div>
      )}
    </Page>
  );
}

// ---------------------------------------------------------------- GST

const thisMonth = () => localToday().slice(0, 7);
type Heads = { taxable: string; igst: string; cgst: string; sgst: string };

function HeadsCells({ h }: { h: Heads }) {
  return (
    <>
      <td className={clsx(td, num)}>{fmt(h.taxable)}</td>
      <td className={clsx(td, num)}>{fmt(h.igst)}</td>
      <td className={clsx(td, num)}>{fmt(h.cgst)}</td>
      <td className={clsx(td, num)}>{fmt(h.sgst)}</td>
    </>
  );
}

export function Gstr3bView() {
  const [month, setMonth] = useState(thisMonth());
  const { data } = useQuery({ queryKey: ['gstr3b', month], queryFn: () => api.report('gstr-3b', { month }) });
  const rows: [string, Heads | null, string?][] = data
    ? [
        ['3.1 (a) Outward taxable supplies', data.outward.taxable],
        ['3.1 (c) Nil-rated supplies', { taxable: data.outward.nilRated, igst: '0', cgst: '0', sgst: '0' }],
        ['4 (A)(5) Input tax credit, all other ITC', data.itc],
      ]
    : [];
  return (
    <Page title="GSTR-3B summary" controls={<DateInput label="Month" type="month" value={month} onChange={setMonth} />}>
      <p className="mb-5 max-w-3xl text-[13px] text-ink-2">
        From invoices and bills posted with dates in this month. Use it to fill GSTR-3B on the GST portal and check with your accountant;
        credit set-off between tax heads is not applied here.
      </p>
      {data && (
        <table className="w-full max-w-4xl border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              <th className={th}>Section</th>
              <th className={clsx(th, num)}>Taxable value</th>
              <th className={clsx(th, num)}>IGST</th>
              <th className={clsx(th, num)}>CGST</th>
              <th className={clsx(th, num)}>SGST</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, h]) => (
              <tr key={label}>
                <td className={td}>{label}</td>
                <HeadsCells h={h!} />
              </tr>
            ))}
            <tr className="font-semibold">
              <td className="border-t-2 border-ink py-2 pr-4">Net tax (output − ITC)</td>
              <td className="border-t-2 border-ink" />
              {(['igst', 'cgst', 'sgst'] as const).map((k) => (
                <td key={k} className={clsx('border-t-2 border-ink py-2 pr-4', num, Number(data.netPayable[k]) < 0 && 'text-ok')}>
                  {fmt(data.netPayable[k])}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      )}
    </Page>
  );
}

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]!);
  const esc = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  };
  return [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n');
}

function download(name: string, rows: Record<string, unknown>[]) {
  const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: 'text/csv' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  URL.revokeObjectURL(url);
}

function GstTable({
  title,
  note,
  rows,
  cols,
  file,
}: {
  title: string;
  note: string;
  rows: Record<string, string | null>[];
  cols: [key: string, label: string, numeric?: boolean][];
  file: string;
}) {
  return (
    <section className="mb-10">
      <div className="mb-2 flex items-end gap-3">
        <div className="mr-auto">
          <h2 className="text-[15px] font-semibold">{title}</h2>
          <p className="text-[13px] text-ink-3">{note}</p>
        </div>
        {rows.length > 0 && (
          <button className="btn-quiet h-8 text-[13px]" onClick={() => download(file, rows)}>
            <Download size={14} /> CSV
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="border-y border-rule py-3 text-ink-3">None this month.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-separate border-spacing-0 text-left">
            <thead>
              <tr>
                {cols.map(([k, l, n]) => (
                  <th key={k} className={clsx(th, n && num)}>
                    {l}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  {cols.map(([k, , n]) => (
                    <td key={k} className={clsx(td, n && num, 'whitespace-nowrap')}>
                      {k === 'date' && r[k] ? formatDate(r[k]!) : n ? fmt(r[k] ?? '0') : r[k]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

const TAX_COLS: [string, string, boolean][] = [
  ['taxable', 'Taxable value', true],
  ['igst', 'IGST', true],
  ['cgst', 'CGST', true],
  ['sgst', 'SGST', true],
];

export function Gstr1View() {
  const [month, setMonth] = useState(thisMonth());
  const { data } = useQuery({ queryKey: ['gstr1', month], queryFn: () => api.report('gstr-1', { month }) });
  return (
    <Page title="GSTR-1" controls={<DateInput label="Month" type="month" value={month} onChange={setMonth} />}>
      <p className="mb-6 max-w-3xl text-[13px] text-ink-2">
        Outward supplies from invoices posted with dates in this month, grouped the way GSTR-1 asks for them. Download each table as CSV
        for the GST offline tool or your accountant.
      </p>
      {data && (
        <>
          <GstTable
            title="B2B invoices (4A)"
            note="Registered customers, by invoice and rate."
            file={`gstr1-b2b-${month}.csv`}
            rows={data.b2b}
            cols={[['gstin', 'GSTIN'], ['customer', 'Customer'], ['number', 'Invoice'], ['date', 'Date'], ['invoiceValue', 'Invoice value', true], ['placeOfSupply', 'Place of supply'], ['rate', 'Rate %'], ...TAX_COLS]}
          />
          <GstTable
            title="B2C large (5)"
            note="Unregistered customers in another state, invoices above ₹1 lakh."
            file={`gstr1-b2cl-${month}.csv`}
            rows={data.b2cl}
            cols={[['number', 'Invoice'], ['date', 'Date'], ['invoiceValue', 'Invoice value', true], ['placeOfSupply', 'Place of supply'], ['rate', 'Rate %'], ...TAX_COLS]}
          />
          <GstTable
            title="B2C small (7)"
            note="Other unregistered sales, by place of supply and rate."
            file={`gstr1-b2cs-${month}.csv`}
            rows={data.b2cs}
            cols={[['placeOfSupply', 'Place of supply'], ['type', 'Supply'], ['rate', 'Rate %'], ...TAX_COLS]}
          />
          <GstTable
            title="Credit notes, registered (9B CDNR)"
            note="Credit notes to registered customers, with the original invoice."
            file={`gstr1-cdnr-${month}.csv`}
            rows={data.cdnr}
            cols={[['gstin', 'GSTIN'], ['customer', 'Customer'], ['noteNumber', 'Note'], ['date', 'Date'], ['originalInvoice', 'Original invoice'], ['noteValue', 'Note value', true], ['placeOfSupply', 'Place of supply'], ['rate', 'Rate %'], ...TAX_COLS]}
          />
          <GstTable
            title="Credit notes, unregistered (9B CDNUR)"
            note="Credit notes to unregistered customers."
            file={`gstr1-cdnur-${month}.csv`}
            rows={data.cdnur}
            cols={[['noteNumber', 'Note'], ['date', 'Date'], ['originalInvoice', 'Original invoice'], ['noteValue', 'Note value', true], ['placeOfSupply', 'Place of supply'], ['rate', 'Rate %'], ...TAX_COLS]}
          />
          <GstTable
            title="HSN summary (12)"
            note="By HSN/SAC, unit and rate, net of credit notes."
            file={`gstr1-hsn-${month}.csv`}
            rows={data.hsn}
            cols={[['hsn', 'HSN/SAC'], ['uom', 'Unit'], ['rate', 'Rate %'], ['qty', 'Quantity'], ['totalValue', 'Total value', true], ...TAX_COLS]}
          />
          <section>
            <h2 className="text-[15px] font-semibold">Documents issued (13)</h2>
            <p className="mt-1 text-ink-2">
              {data.documents.issued
                ? `Invoices ${data.documents.from} to ${data.documents.to}: ${data.documents.issued} issued, ${data.documents.cancelled} cancelled.`
                : 'No invoices this month.'}
            </p>
          </section>
        </>
      )}
    </Page>
  );
}
