import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '../api.ts';
import { Empty, PageHeader, StandingBadge, Table } from '../components/ui.tsx';
import { actionLabel, cycleLabel, describeDetails, formatDate, formatDateTime, money, relativeDays } from '../format.ts';

export function DashboardPage() {
  const { data, error } = useQuery({ queryKey: ['dashboard'], queryFn: api.dashboard });
  if (error) return <p className="text-crimson">{error.message}</p>;
  if (!data) return null;
  const t = data.totals;

  return (
    <>
      <PageHeader title="Overview" />

      {/* Revenue leads; the counts read as its supporting ledger lines. */}
      <section className="grid gap-x-10 gap-y-4 border-y border-rule py-5 sm:grid-cols-[auto_1fr]">
        <div>
          <p className="text-[13px] text-ink-2">Monthly recurring revenue</p>
          <p className="text-[34px] leading-tight font-semibold tracking-tight tabular-nums">{money(t.mrr)}</p>
          <p className="text-[12.5px] text-ink-3">Yearly plans counted at one-twelfth; includes cloud hosting</p>
        </div>
        <dl className="grid grid-cols-2 content-center gap-x-8 gap-y-2 sm:grid-cols-4">
          {(
            [
              ['Paying licences', t.paying],
              ['Active trials', t.trials],
              ['Cloud-hosted', t.cloud],
              ['New trials, 30 days', t.newTrials30d],
            ] as const
          ).map(([k, v]) => (
            <div key={k}>
              <dt className="text-[12.5px] text-ink-2">{k}</dt>
              <dd className="text-[20px] font-semibold tabular-nums">{v.toLocaleString('en-IN')}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-8 grid gap-10 lg:grid-cols-[3fr_2fr]">
        <section>
          <h2 className="mb-1 text-[15px] font-semibold">Renewals due</h2>
          <p className="mb-3 text-[13px] text-ink-3">Ending in the next 14 days, or lapsed in the last 7.</p>
          {data.dueSoon.length === 0 ? (
            <Empty>Nothing due. Every active licence is paid beyond the next two weeks.</Empty>
          ) : (
            <Table head={['Customer', 'Plan', 'Ends', '']}>
              {data.dueSoon.map((l) => (
                <tr key={l.id}>
                  <td>
                    <Link to={`/licenses/${l.id}`} className="font-medium hover:underline">
                      {l.customer}
                    </Link>
                    <span className="block text-[12.5px] text-ink-3">{l.email}</span>
                  </td>
                  <td>
                    {l.planName}
                    {l.billingCycle !== 'trial' && <span className="block text-[12.5px] text-ink-3">{cycleLabel[l.billingCycle]}</span>}
                  </td>
                  <td className="whitespace-nowrap">
                    {formatDate(l.currentPeriodEnd)}
                    <span className="block text-[12.5px] text-ink-3">{relativeDays(l.currentPeriodEnd)}</span>
                  </td>
                  <td className="text-right">
                    <StandingBadge standing={l.standing} />
                  </td>
                </tr>
              ))}
            </Table>
          )}
        </section>

        <section>
          <h2 className="mb-3 text-[15px] font-semibold">Recent activity</h2>
          {data.activity.length === 0 ? (
            <Empty>No changes yet.</Empty>
          ) : (
            <ol className="divide-y divide-rule border-y border-rule">
              {data.activity.map((a) => {
                const detail = describeDetails(a.action, a.details);
                const body = (
                  <>
                    <span className="font-medium">{actionLabel(a.action)}</span>
                    {a.customer && <span className="block text-[13px] text-ink">{a.customer}</span>}
                    {detail && <span className="block text-[13px] text-ink-2">{detail}</span>}
                    <span className="block text-[12.5px] text-ink-3">
                      {a.staffName ?? 'System'}, {formatDateTime(a.at)}
                    </span>
                  </>
                );
                return (
                  <li key={a.id} className="py-2.5">
                    {a.licenseId ? (
                      <Link to={`/licenses/${a.licenseId}`} className="block hover:bg-sheet">
                        {body}
                      </Link>
                    ) : (
                      body
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}
