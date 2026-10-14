import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatDate } from '../lib/format.ts';
import { ActivationForms } from './ActivateView.tsx';
import { FormError } from './AuthLayout.tsx';

const STATE_LABEL = {
  active: 'Active',
  grace: 'Needs attention',
  readonly: 'Read-only',
  unlicensed: 'Not activated',
  dev: 'Development mode',
} as const;

export function LicenseView() {
  const qc = useQueryClient();
  const { data: lic } = useQuery({ queryKey: ['license'], queryFn: api.license });
  const checkin = useMutation({
    mutationFn: api.checkin,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['license'] });
      void qc.invalidateQueries({ queryKey: ['bootstrap'] });
    },
  });
  if (!lic) return null;

  const rows: [string, string | undefined][] = [
    ['Status', STATE_LABEL[lic.state]],
    ['Plan', lic.plan && lic.plan[0]!.toUpperCase() + lic.plan.slice(1)],
    ['Licensed to', lic.customer],
    ['Users', lic.seats?.toString()],
    [lic.plan === 'trial' ? 'Trial ends' : 'Paid until', lic.expiresAt && formatDate(lic.expiresAt)],
    ['Next online check by', lic.refreshBy && formatDate(lic.refreshBy)],
    ['Machine ID', lic.fingerprint],
  ];

  return (
    <div className="h-full overflow-y-auto px-5 py-6 sm:px-10">
      <h1 className="text-[22px] font-semibold tracking-tight">Licence</h1>
      {lic.message && <p className="mt-1 text-ink-2">{lic.message}</p>}

      <dl className="mt-6 max-w-xl divide-y divide-rule border-y border-rule">
        {rows
          .filter(([, v]) => v)
          .map(([k, v]) => (
            <div key={k} className="flex gap-4 py-2.5">
              <dt className="w-44 shrink-0 text-ink-2">{k}</dt>
              <dd className="min-w-0 break-all">{v}</dd>
            </div>
          ))}
      </dl>

      {(lic.state === 'active' || lic.state === 'grace' || lic.state === 'readonly') && (
        <div className="mt-5 max-w-xl space-y-3">
          <button className="btn-outline" disabled={checkin.isPending} onClick={() => checkin.mutate()}>
            <RefreshCw size={15} className={checkin.isPending ? 'animate-spin' : ''} />
            {checkin.isPending ? 'Checking…' : 'Check licence now'}
          </button>
          <FormError message={checkin.error?.message} />
        </div>
      )}

      {lic.state !== 'dev' && lic.state !== 'active' && (
        <div className="mt-10 max-w-md">
          <h2 className="mb-4 text-[16px] font-semibold">Activate</h2>
          <ActivationForms />
        </div>
      )}
    </div>
  );
}
