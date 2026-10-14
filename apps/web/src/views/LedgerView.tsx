import { companyAddressLines, IN_STATES, localToday, money, type FieldDef, type Many2oneValue } from '@osuite/kernel';
import { BrandMark } from '@osuite/ui';
import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowLeft, Printer } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { FieldControl } from '../components/fields.tsx';
import { api, type LedgerReport } from '../lib/api.ts';
import { formatDate, formatDecimal } from '../lib/format.ts';
import { useSession } from '../lib/session.ts';
import { DateInput, fyStart, num, Page, td, th } from './AccountingReports.tsx';

/** Debit-positive amount as "1,234.00 Dr" / "1,234.00 Cr". */
export function drCr(v: string) {
  const c = money.cmp(v, 0);
  if (c === 0) return '0.00';
  return `${formatDecimal(c > 0 ? v : money.sub(0, v))} ${c > 0 ? 'Dr' : 'Cr'}`;
}

const DOCUMENTS = new Set(['sales.invoice', 'sales.credit_note', 'purchase.bill', 'purchase.debit_note', 'account.payment', 'account.manual', 'stock.adjustment']);

/** Where a journal entry came from: the document, the closing page, or the entry itself. */
export function sourceLink(refModel: string, refId: number, entryId: number) {
  if (DOCUMENTS.has(refModel)) return `/m/${refModel}?id=${refId}`;
  if (refModel === 'account.year_close') return '/closing';
  return `/m/account.entry?id=${entryId}`;
}

const KINDS: Record<string, string> = {
  'sales.invoice': 'Sales invoice',
  'sales.credit_note': 'Credit note',
  'purchase.bill': 'Purchase bill',
  'purchase.debit_note': 'Debit note',
};

/** What a party sees for an item on their statement: the kind of document, not our ledger names. */
export function partyParticulars(r: LedgerReport['rows'][number]) {
  if (r.refModel === 'account.payment') return money.isPositive(r.debit) ? 'Payment made' : 'Payment received';
  if (r.reference.startsWith('Cancel ')) return 'Cancellation';
  return KINDS[r.refModel] ?? r.narration ?? r.against;
}

/** Narration, unless it only repeats the voucher number. */
const note = (narration: string | null, reference: string) => (narration && !narration.includes(reference) ? narration : null);

const accountField: FieldDef = { type: 'many2one', label: 'Account', relation: 'account.account' };
const partyField: FieldDef = { type: 'many2one', label: 'Party', relation: 'base.contact' };

/** Ledger of one account, optionally for one party; or a party's statement of account. */
export function LedgerView() {
  const [params, setParams] = useSearchParams();
  const today = localToday();
  const to = params.get('to') ?? today;
  const from = params.get('from') ?? fyStart(to);
  const accountId = params.get('account');
  const partnerId = params.get('partner');
  const set = (k: string, v: string | null) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        if (v) n.set(k, v);
        else n.delete(k);
        return n;
      },
      { replace: true },
    );

  const query: Record<string, string> = { from, to };
  if (accountId) query.accountId = accountId;
  if (partnerId) query.partnerId = partnerId;
  const { data, error } = useQuery({
    queryKey: ['ledger', query],
    queryFn: () => api.report('ledger', query as { from: string; to: string }),
    enabled: !!(accountId || partnerId),
  });

  // Pickers show what the URL points at, named by the report once it loads.
  const [account, setAccount] = useState<Many2oneValue | null>(null);
  const [partner, setPartner] = useState<Many2oneValue | null>(null);
  useEffect(() => {
    if (data?.account) setAccount({ id: data.account.id, display: data.account.name });
    if (data?.partner) setPartner({ id: data.partner.id, display: data.partner.name });
  }, [data]);
  useEffect(() => {
    if (!accountId) setAccount(null);
    if (!partnerId) setPartner(null);
  }, [accountId, partnerId]);

  const title = data?.account ? (data.partner ? `${data.account.name}: ${data.partner.name}` : data.account.name) : data?.partner ? `Statement: ${data.partner.name}` : 'Ledger';

  return (
    <Page
      title={title}
      controls={
        <>
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            Account
            <span className="w-48">
              <FieldControl
                id="ledger-account"
                name="account"
                aria-label="Account"
                field={accountField}
                value={account}
                compact
                onChange={(v) => {
                  setAccount(v as Many2oneValue | null);
                  set('account', v ? String((v as Many2oneValue).id) : null);
                }}
              />
            </span>
          </label>
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            Party
            <span className="w-48">
              <FieldControl
                id="ledger-party"
                name="partner"
                aria-label="Party"
                field={partyField}
                value={partner}
                compact
                onChange={(v) => {
                  setPartner(v as Many2oneValue | null);
                  set('partner', v ? String((v as Many2oneValue).id) : null);
                }}
              />
            </span>
          </label>
          <DateInput label="From" value={from} onChange={(v) => set('from', v)} />
          <DateInput label="To" value={to} onChange={(v) => set('to', v)} />
          {data?.partner && !data.account && (
            <Link className="btn-outline h-8" to={`/print/statement/${data.partner.id}?from=${from}&to=${to}`}>
              <Printer size={14} /> Print statement
            </Link>
          )}
        </>
      }
    >
      {!accountId && !partnerId && (
        <p className="py-8 text-ink-3">Choose an account to see its ledger, or a party to see their statement of account.</p>
      )}
      {error && <p className="text-crimson">{error.message}</p>}
      {data && <LedgerTable data={data} partyView={!data.account} />}
    </Page>
  );
}

function LedgerTable({ data, partyView }: { data: LedgerReport; partyView: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] border-separate border-spacing-0 text-left">
        <thead>
          <tr>
            <th className={th}>Date</th>
            <th className={th}>Particulars</th>
            <th className={th}>Voucher</th>
            <th className={clsx(th, num)}>Debit</th>
            <th className={clsx(th, num)}>Credit</th>
            <th className={clsx(th, num)}>Balance</th>
          </tr>
        </thead>
        <tbody>
          <tr className="text-ink-2">
            <td className={td}>{formatDate(data.from)}</td>
            <td className={clsx(td, 'font-medium')} colSpan={4}>
              Opening balance
            </td>
            <td className={clsx(td, num)}>{drCr(data.opening)}</td>
          </tr>
          {data.rows.map((r) => (
            <tr key={r.lineId} className="hover:bg-sheet">
              <td className={clsx(td, 'whitespace-nowrap')}>{formatDate(r.date)}</td>
              <td className={td}>
                {partyView ? partyParticulars(r) : r.against || '—'}
                {note(r.narration, r.reference) && <span className="block text-[12.5px] text-ink-3">{r.narration}</span>}
              </td>
              <td className={clsx(td, 'whitespace-nowrap')}>
                <Link to={sourceLink(r.refModel, r.refId, r.entryId)} className="underline-offset-2 hover:underline">
                  {r.reference}
                </Link>
              </td>
              <td className={clsx(td, num)}>{Number(r.debit) ? formatDecimal(r.debit) : ''}</td>
              <td className={clsx(td, num)}>{Number(r.credit) ? formatDecimal(r.credit) : ''}</td>
              <td className={clsx(td, num, 'whitespace-nowrap')}>{drCr(r.balance)}</td>
            </tr>
          ))}
          {data.rows.length === 0 && (
            <tr>
              <td colSpan={6} className={clsx(td, 'py-6 text-center text-ink-3')}>
                Nothing posted in this period.
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td className="border-t-2 border-ink py-2 pr-4" colSpan={3}>
              Closing balance on {formatDate(data.to)}
            </td>
            <td className={clsx('border-t-2 border-ink py-2 pr-4', num)}>{formatDecimal(data.totalDebit)}</td>
            <td className={clsx('border-t-2 border-ink py-2 pr-4', num)}>{formatDecimal(data.totalCredit)}</td>
            <td className={clsx('border-t-2 border-ink py-2 pr-4 whitespace-nowrap', num)}>{drCr(data.closing)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Every journal entry in a period, as Tally's day book. */
export function DayBookView() {
  const today = localToday();
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const { data, error } = useQuery({ queryKey: ['day-book', from, to], queryFn: () => api.report('day-book', { from, to }) });
  return (
    <Page
      title="Day book"
      controls={
        <>
          <DateInput label="From" value={from} onChange={setFrom} />
          <DateInput label="To" value={to} onChange={setTo} />
        </>
      }
    >
      {error && <p className="text-crimson">{error.message}</p>}
      {data && data.entries.length === 0 && <p className="py-8 text-ink-3">Nothing was posted in this period.</p>}
      {data && data.entries.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-separate border-spacing-0 text-left">
            <thead>
              <tr>
                <th className={th}>Date</th>
                <th className={th}>Voucher</th>
                <th className={th}>Account</th>
                <th className={clsx(th, num)}>Debit</th>
                <th className={clsx(th, num)}>Credit</th>
              </tr>
            </thead>
            {data.entries.map((e) => (
              <tbody key={e.id}>
                {e.lines.map((l, i) => (
                  <tr key={i} className={clsx(i === 0 && 'align-top')}>
                    <td className={clsx('py-1 pr-4 whitespace-nowrap', i === 0 && 'pt-3')}>{i === 0 && formatDate(e.date)}</td>
                    <td className={clsx('py-1 pr-4', i === 0 && 'pt-3')}>
                      {i === 0 && (
                        <>
                          <Link to={sourceLink(e.refModel, e.refId, e.id)} className="font-medium underline-offset-2 hover:underline">
                            {e.reference}
                          </Link>
                          {note(e.narration, e.reference) && <span className="block text-[12.5px] text-ink-3">{e.narration}</span>}
                        </>
                      )}
                    </td>
                    <td className={clsx('py-1 pr-4', i === 0 && 'pt-3', Number(l.debit) === 0 && 'pl-6')}>
                      {l.account}
                      {l.partner && <span className="text-ink-3"> · {l.partner}</span>}
                    </td>
                    <td className={clsx('py-1 pr-4', num, i === 0 && 'pt-3')}>{Number(l.debit) ? formatDecimal(l.debit) : ''}</td>
                    <td className={clsx('py-1 pr-4', num, i === 0 && 'pt-3')}>{Number(l.credit) ? formatDecimal(l.credit) : ''}</td>
                  </tr>
                ))}
                <tr>
                  <td colSpan={5} className="border-b border-rule pb-2" />
                </tr>
              </tbody>
            ))}
            <tfoot>
              <tr className="font-semibold">
                <td className="border-t-2 border-ink py-2 pr-4" colSpan={3}>
                  {data.entries.length} entries
                </td>
                <td className={clsx('border-t-2 border-ink py-2 pr-4', num)}>{formatDecimal(data.total)}</td>
                <td className={clsx('border-t-2 border-ink py-2 pr-4', num)}>{formatDecimal(data.total)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Page>
  );
}

const stateName = (code: string) => IN_STATES.find(([c]) => c === code)?.[1];

/** A party's statement of account on A4, to print or save as PDF and send them. */
export function StatementPrintView() {
  const { partnerId = '' } = useParams();
  const [params] = useSearchParams();
  const { company } = useSession();
  const to = params.get('to') ?? localToday();
  const from = params.get('from') ?? fyStart(to);
  const { data, error } = useQuery({
    queryKey: ['ledger', { from, to, partnerId }],
    queryFn: () => api.report('ledger', { partnerId, from, to }),
  });
  useEffect(() => {
    if (data?.partner) document.title = `Statement ${data.partner.name} ${from} to ${to}`;
  }, [data, from, to]);
  if (error) return <p className="p-8 text-crimson">{error.message}</p>;
  if (!data?.partner) return null;

  const cell = 'border-b border-black/30 px-1.5 py-1 align-top';
  const head = 'border-b-2 border-black px-1.5 py-1 text-left font-semibold';
  const n = 'text-right tabular-nums whitespace-nowrap';
  const owes = money.cmp(data.closing, 0);

  return (
    <div className="min-h-full bg-paper print:bg-white">
      <div className="flex items-center gap-2 border-b border-rule bg-sheet px-4 py-2 print:hidden">
        <Link to={`/reports/ledger?partner=${data.partner.id}&from=${from}&to=${to}`} className="btn-quiet">
          <ArrowLeft size={16} /> Back
        </Link>
        <span className="flex-1" />
        <button className="btn-primary" onClick={() => window.print()}>
          <Printer size={15} /> Print or save as PDF
        </button>
      </div>
      <div className="mx-auto my-6 w-[210mm] max-w-full bg-white p-[12mm] text-[12px] leading-snug text-black shadow-sm print:m-0 print:w-auto print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-6 border-b-2 border-black pb-3">
          <div>
            <p className="text-[16px] font-bold">{company?.name}</p>
            {company && companyAddressLines(company, stateName).map((l) => <p key={l}>{l}</p>)}
            {company?.gstin && <p>GSTIN: {company.gstin}</p>}
          </div>
          <div className="text-right">
            <p className="text-[16px] font-bold">Statement of account</p>
            <p>
              {formatDate(from)} to {formatDate(to)}
            </p>
          </div>
        </header>
        <section className="mt-3 mb-4">
          <p className="text-[11px] text-black/60 uppercase">To</p>
          <p className="text-[14px] font-semibold">{data.partner.name}</p>
          {data.partner.gstin && <p>GSTIN: {data.partner.gstin}</p>}
        </section>
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={head}>Date</th>
              <th className={head}>Particulars</th>
              <th className={head}>Voucher</th>
              <th className={clsx(head, 'text-right')}>Debit</th>
              <th className={clsx(head, 'text-right')}>Credit</th>
              <th className={clsx(head, 'text-right')}>Balance</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className={cell}>{formatDate(from)}</td>
              <td className={clsx(cell, 'font-semibold')} colSpan={4}>
                Opening balance
              </td>
              <td className={clsx(cell, n)}>{drCr(data.opening)}</td>
            </tr>
            {data.rows.map((r) => (
              <tr key={r.lineId}>
                <td className={clsx(cell, 'whitespace-nowrap')}>{formatDate(r.date)}</td>
                <td className={cell}>{partyParticulars(r)}</td>
                <td className={clsx(cell, 'whitespace-nowrap')}>{r.reference}</td>
                <td className={clsx(cell, n)}>{Number(r.debit) ? formatDecimal(r.debit) : ''}</td>
                <td className={clsx(cell, n)}>{Number(r.credit) ? formatDecimal(r.credit) : ''}</td>
                <td className={clsx(cell, n)}>{drCr(r.balance)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td className="border-t-2 border-black px-1.5 py-1.5" colSpan={3}>
                Closing balance
              </td>
              <td className={clsx('border-t-2 border-black px-1.5 py-1.5', n)}>{formatDecimal(data.totalDebit)}</td>
              <td className={clsx('border-t-2 border-black px-1.5 py-1.5', n)}>{formatDecimal(data.totalCredit)}</td>
              <td className={clsx('border-t-2 border-black px-1.5 py-1.5', n)}>{drCr(data.closing)}</td>
            </tr>
          </tfoot>
        </table>
        <p className="mt-4 text-[13px] font-semibold">
          {owes > 0
            ? `Balance due to ${company?.name ?? 'us'}: ₹${formatDecimal(data.closing)}`
            : owes < 0
              ? `Balance due to ${data.partner.name}: ₹${formatDecimal(money.sub(0, data.closing))}`
              : 'No balance outstanding.'}
        </p>
        <p className="mt-8 text-[11px] text-black/60">
          Please let us know within 15 days if anything in this statement does not match your books.
        </p>
        <p className="mt-2 flex items-center gap-1 text-[10px] text-black/50">
          <BrandMark className="scale-75" /> Computer-generated statement
        </p>
      </div>
      <style>{'@page { size: A4; margin: 12mm; } @media print { html, body { background: #fff !important; } }'}</style>
    </div>
  );
}
