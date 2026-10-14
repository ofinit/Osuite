import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, type AgeingReport } from '../lib/api.ts';
import { formatDate, formatDecimal } from '../lib/format.ts';
import { useSession } from '../lib/session.ts';

const BUCKETS = [
  ['notDue', 'Not due'],
  ['d1_30', '1–30 days'],
  ['d31_60', '31–60'],
  ['d61_90', '61–90'],
  ['d90plus', '90+'],
] as const;

const KINDS = {
  receivables: { direction: 'inbound', title: 'Receivables', party: 'Customer', doc: 'sales.invoice', empty: 'No customer owes you anything right now.' },
  payables: { direction: 'outbound', title: 'Payables', party: 'Vendor', doc: 'purchase.bill', empty: 'You don’t owe any vendor anything right now.' },
} as const;

const amt = (v: string) => (Number(v) === 0 ? '' : formatDecimal(v));

/** Who owes what, by how overdue it is. */
export function AgeingView() {
  const kind = KINDS[(useParams().kind as keyof typeof KINDS) ?? 'receivables'] ?? KINDS.receivables;
  const { data, error } = useQuery({ queryKey: ['ageing', kind.direction], queryFn: () => api.ageing(kind.direction) });
  const [open, setOpen] = useState<Set<number>>(new Set());
  const { license } = useSession();
  const qc = useQueryClient();
  const [notice, setNotice] = useState<string | null>(null);
  const apply = useMutation({
    mutationFn: (partnerId: number) => api.applyCredit({ direction: kind.direction, partnerId }),
    onSuccess: (r) => {
      setNotice(`₹${formatDecimal(r.applied)} of credit applied to the oldest dues.`);
      void qc.invalidateQueries({ queryKey: ['ageing'] });
    },
    onError: (e) => setNotice(e.message),
  });
  const toggle = (id: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const th = 'border-b border-rule-strong py-2 pr-4 text-[12.5px] font-medium whitespace-nowrap text-ink-2';
  const num = 'text-right tabular-nums';

  return (
    <div className="h-full overflow-y-auto px-5 py-6 sm:px-10">
      <header className="mb-5">
        <h1 className="text-[22px] font-semibold tracking-tight">{kind.title}</h1>
        {data && (
          <p className="mt-1 text-ink-2">
            Balances due as of {formatDate(data.asOf)}, by days past the due date. Documents without a due date are due on their date.
          </p>
        )}
      </header>
      {error && <p className="text-crimson">{error.message}</p>}
      {notice && (
        <p role="status" className="mb-4 text-[13px] text-ok">
          {notice}
        </p>
      )}
      {data && data.rows.length === 0 && <p className="py-12 text-center text-ink-3">{kind.empty}</p>}
      {data && data.rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-separate border-spacing-0 text-left">
            <thead>
              <tr>
                <th className={th}>{kind.party}</th>
                {BUCKETS.map(([k, l]) => (
                  <th key={k} className={clsx(th, num)}>
                    {l}
                  </th>
                ))}
                <th className={clsx(th, num)}>Total due</th>
                <th className={clsx(th, num)}>Advance</th>
                <th className={clsx(th, num)}>Net</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <Fragment key={r.partnerId}>
                  <tr className="cursor-pointer hover:bg-sheet" onClick={() => toggle(r.partnerId)}>
                    <td className="border-b border-rule py-2.5 pr-4 font-medium">
                      <button className="inline-flex items-center gap-1.5 text-left" aria-expanded={open.has(r.partnerId)}>
                        {open.has(r.partnerId) ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        {r.partner}
                      </button>
                    </td>
                    {BUCKETS.map(([k]) => (
                      <td key={k} className={clsx('border-b border-rule py-2.5 pr-4', num, k === 'd90plus' && Number(r[k]) > 0 && 'text-crimson')}>
                        {amt(r[k])}
                      </td>
                    ))}
                    <td className={clsx('border-b border-rule py-2.5 pr-4 font-medium', num)}>{amt(r.total)}</td>
                    <td className={clsx('border-b border-rule py-2.5 pr-4', num)}>
                      {amt(r.advance)}
                      {Number(r.advance) > 0 && Number(r.total) > 0 && license.writable && (
                        <button
                          className="ml-2 text-[12.5px] text-accent underline-offset-2 hover:underline"
                          onClick={(e) => {
                            e.stopPropagation();
                            apply.mutate(r.partnerId);
                          }}
                        >
                          Apply
                        </button>
                      )}
                    </td>
                    <td className={clsx('border-b border-rule py-2.5 pr-4 font-semibold', num)}>{formatDecimal(r.net)}</td>
                  </tr>
                  {open.has(r.partnerId) &&
                    r.items.map((it) => (
                      <tr key={it.id} className="text-[13px] text-ink-2">
                        <td className="border-b border-rule py-1.5 pr-4 pl-6">
                          <Link to={`/m/${kind.doc}?id=${it.id}`} className="text-ink underline-offset-2 hover:underline">
                            {it.number}
                          </Link>
                          <span className="ml-2">
                            {formatDate(it.date)}
                            {it.dueDate && `, due ${formatDate(it.dueDate)}`}
                          </span>
                        </td>
                        {BUCKETS.map(([k]) => (
                          <td key={k} className={clsx('border-b border-rule py-1.5 pr-4', num)}>
                            {it.bucket === k ? formatDecimal(it.amountDue) : ''}
                          </td>
                        ))}
                        <td colSpan={3} className="border-b border-rule py-1.5 pr-4 text-right">
                          {it.daysOverdue > 0 ? `${it.daysOverdue} days overdue` : 'Not yet due'}
                        </td>
                      </tr>
                    ))}
                </Fragment>
              ))}
            </tbody>
            <tfoot>
              <tr className="font-semibold">
                <td className="border-t-2 border-ink py-2.5 pr-4">Total</td>
                {BUCKETS.map(([k]) => (
                  <td key={k} className={clsx('border-t-2 border-ink py-2.5 pr-4', num)}>
                    {amt(data.totals[k])}
                  </td>
                ))}
                <td className={clsx('border-t-2 border-ink py-2.5 pr-4', num)}>{formatDecimal(data.totals.total)}</td>
                <td className={clsx('border-t-2 border-ink py-2.5 pr-4', num)}>{amt(data.totals.advance)}</td>
                <td className={clsx('border-t-2 border-ink py-2.5 pr-4', num)}>₹{formatDecimal(data.totals.net)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </div>
  );
}
