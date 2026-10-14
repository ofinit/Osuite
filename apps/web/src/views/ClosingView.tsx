import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Lock, LockOpen } from 'lucide-react';
import { useState } from 'react';
import { api } from '../lib/api.ts';
import { formatDate, formatDecimal } from '../lib/format.ts';
import { useSession } from '../lib/session.ts';

/** Close financial years: move profit to reserves and lock the year. */
export function ClosingView() {
  const { user, license } = useSession();
  const qc = useQueryClient();
  const { data: years } = useQuery({ queryKey: ['years'], queryFn: api.years });
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const done = (text: string) => {
    setMessage({ kind: 'ok', text });
    void qc.invalidateQueries();
  };
  const close = useMutation({
    mutationFn: (fy: string) => api.closeYear(fy),
    onSuccess: (r) => done(`Financial year closed. ₹${formatDecimal(r.profit.replace('-', ''))} ${Number(r.profit) >= 0 ? 'profit' : 'loss'} moved to Reserves & surplus.`),
    onError: (e) => setMessage({ kind: 'error', text: e.message }),
  });
  const reopen = useMutation({
    mutationFn: (fy: string) => api.reopenYear(fy),
    onSuccess: () => done('Financial year reopened. Entries can be posted in it again.'),
    onError: (e) => setMessage({ kind: 'error', text: e.message }),
  });
  const canAct = user.isAdmin && license.writable;
  const latestClosed = years?.find((y) => y.closed)?.fy;
  const th = 'border-b border-rule-strong py-2 pr-4 text-[12.5px] font-medium whitespace-nowrap text-ink-2';
  const td = 'border-b border-rule py-3 pr-4 align-top';

  return (
    <div className="h-full overflow-y-auto px-5 py-6 sm:px-10">
      <h1 className="text-[22px] font-semibold tracking-tight">Year-end closing</h1>
      <p className="mt-1 max-w-3xl text-ink-2">
        Closing a financial year moves its profit or loss into Reserves & surplus and locks it: nothing new can be posted with a date in
        that year. Profit & loss for a closed year still shows its figures. The most recent closing can be reopened to make a correction.
      </p>
      {message && (
        <p role="status" className={clsx('mt-4 text-[13px]', message.kind === 'error' ? 'text-crimson' : 'text-ok')}>
          {message.text}
        </p>
      )}
      <table className="mt-6 w-full max-w-4xl border-separate border-spacing-0 text-left">
        <thead>
          <tr>
            <th className={th}>Financial year</th>
            <th className={clsx(th, 'text-right')}>Profit / loss</th>
            <th className={th}>Status</th>
            <th className={th} />
          </tr>
        </thead>
        <tbody>
          {years?.map((y) => (
            <tr key={y.fy}>
              <td className={td}>
                <span className="font-medium">{y.label}</span>
                <span className="block text-[12.5px] text-ink-3">
                  {formatDate(y.from)} to {formatDate(y.to)}
                </span>
              </td>
              <td className={clsx(td, 'text-right tabular-nums', Number(y.profit) < 0 && 'text-crimson')}>{formatDecimal(y.profit)}</td>
              <td className={td}>
                {y.closed ? (
                  <span className="inline-flex items-center gap-1.5 text-ok">
                    <Lock size={14} /> Closed
                  </span>
                ) : y.ended ? (
                  <span>
                    Open
                    {y.blockers.length > 0 && <span className="block text-[12.5px] text-amber">Still in draft: {y.blockers.join(', ')}</span>}
                  </span>
                ) : (
                  <span className="text-ink-3">Current year</span>
                )}
              </td>
              <td className={clsx(td, 'text-right')}>
                {canAct && !y.closed && y.ended && (
                  <button
                    className="btn-outline h-8"
                    disabled={y.blockers.length > 0 || close.isPending}
                    title={y.blockers.length ? 'Post or delete the drafts first' : undefined}
                    onClick={() => confirm(`Close ${y.label}? Its profit moves to reserves and the year is locked.`) && close.mutate(y.fy)}
                  >
                    <Lock size={14} /> Close year
                  </button>
                )}
                {canAct && y.fy === latestClosed && (
                  <button
                    className="btn-quiet h-8"
                    disabled={reopen.isPending}
                    onClick={() => confirm(`Reopen ${y.label}? The closing is reversed and the year can be posted to again.`) && reopen.mutate(y.fy)}
                  >
                    <LockOpen size={14} /> Reopen
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {years?.length === 0 && <p className="mt-6 text-ink-3">Nothing has been posted yet.</p>}
    </div>
  );
}
