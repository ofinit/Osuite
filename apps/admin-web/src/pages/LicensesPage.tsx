import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../api.ts';
import { Empty, PageHeader, StandingBadge, Table } from '../components/ui.tsx';
import { cycleLabel, formatDate } from '../format.ts';

const FILTERS = [
  ['', 'All'],
  ['active', 'Active'],
  ['trial', 'Trial'],
  ['expired', 'Expired'],
  ['suspended', 'Suspended'],
  ['revoked', 'Revoked'],
] as const;

export function LicensesPage() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const standing = params.get('standing') ?? '';
  const [q, setQ] = useState(params.get('q') ?? '');

  useEffect(() => {
    const t = setTimeout(() => {
      setParams((p) => {
        const n = new URLSearchParams(p);
        if (q) n.set('q', q);
        else n.delete('q');
        return n;
      }, { replace: true });
    }, 200);
    return () => clearTimeout(t);
  }, [q, setParams]);

  const { data, isSuccess } = useQuery({
    queryKey: ['licenses', params.get('q') ?? '', standing],
    queryFn: () => api.licenses({ q: params.get('q') ?? undefined, standing: standing || undefined }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader title="Licences" sub="To issue a licence, open the customer.">
        <div className="relative w-full sm:w-72">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
          <input
            className="field-input pl-8"
            placeholder="Customer, email or key"
            aria-label="Search licences"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      </PageHeader>

      <div role="tablist" className="mb-4 flex flex-wrap gap-1">
        {FILTERS.map(([value, label]) => (
          <button
            key={value}
            role="tab"
            aria-selected={standing === value}
            onClick={() =>
              setParams((p) => {
                const n = new URLSearchParams(p);
                if (value) n.set('standing', value);
                else n.delete('standing');
                return n;
              })
            }
            className={clsx(
              'h-8 rounded-[5px] px-3 text-[13px]',
              standing === value ? 'bg-ink font-medium text-paper' : 'text-ink-2 hover:bg-rule',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {isSuccess && data.length === 0 ? (
        <Empty>No licences match.</Empty>
      ) : (
        <Table head={['Customer', 'Plan', 'Users', 'Computers', 'Paid until', 'Status']}>
          {data?.map((l) => (
            <tr key={l.id} className="cursor-pointer hover:bg-sheet" onClick={() => navigate(`/licenses/${l.id}`)}>
              <td>
                <Link to={`/licenses/${l.id}`} className="font-medium" onClick={(e) => e.stopPropagation()}>
                  {l.customer}
                </Link>
                <span className="block text-[12.5px] text-ink-3">{l.key}</span>
              </td>
              <td>
                {l.planName}
                <span className="block text-[12.5px] text-ink-3">
                  {cycleLabel[l.billingCycle]}
                  {l.deployment === 'cloud' && ', cloud'}
                </span>
              </td>
              <td className="tabular-nums">{l.seats}</td>
              <td className="tabular-nums">{l.machines}</td>
              <td className="whitespace-nowrap">{formatDate(l.currentPeriodEnd)}</td>
              <td>
                <StandingBadge standing={l.standing} />
              </td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
