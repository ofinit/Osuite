import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { api } from '../lib/api.ts';
import { formatDate, formatDecimal } from '../lib/format.ts';
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

      <PlansAndSupport current={lic.plan} />
    </div>
  );
}

const rupees = (v: string) => `₹${formatDecimal(Math.round(Number(v)), 0)}`;

/** Plans on sale and how to reach the seller, as published from the admin panel. */
function PlansAndSupport({ current }: { current?: string | null }) {
  const { data } = useQuery({ queryKey: ['vendor'], queryFn: api.vendor, staleTime: 5 * 60 * 1000 });
  if (!data?.business) return null;
  const b = data.business;
  const paid = data.plans.filter((p) => Number(p.priceMonthly) > 0);
  const contact = [
    b.supportEmail && { label: 'Email', value: b.supportEmail, href: `mailto:${b.supportEmail}` },
    b.phone && { label: 'Phone', value: b.phone, href: `tel:${b.phone.replace(/[^\d+]/g, '')}` },
    b.whatsapp && { label: 'WhatsApp', value: b.whatsapp, href: `https://wa.me/${b.whatsapp.replace(/\D/g, '')}` },
  ].filter(Boolean) as { label: string; value: string; href: string }[];
  return (
    <div className="mt-12 max-w-3xl">
      {paid.length > 0 && (
        <>
          <h2 className="text-[16px] font-semibold">Plans</h2>
          <p className="mt-1 text-[13px] text-ink-3">{b.gstNote}. Buy or renew at osuite.business/pricing; your licence key arrives by email.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {paid.map((p) => (
              <div key={p.id} className={`rounded-[6px] border px-4 py-3 ${p.id === current ? 'border-accent bg-accent-soft' : 'border-rule bg-sheet'}`}>
                <p className="font-semibold">
                  {p.name}
                  {p.id === current && <span className="ml-2 text-[12px] font-normal text-accent">Your plan</span>}
                </p>
                <p className="mt-1 text-[20px] font-semibold tabular-nums">
                  {rupees(p.priceMonthly)}
                  <span className="text-[13px] font-normal text-ink-2"> / month</span>
                </p>
                <p className="text-[12.5px] text-ink-2 tabular-nums">
                  or {rupees(p.priceYearly)} a year · {p.seats} {p.seats === 1 ? 'user' : 'users'}
                </p>
                {p.tagline && <p className="mt-2 text-[13px] text-ink-2">{p.tagline}</p>}
              </div>
            ))}
          </div>
        </>
      )}
      {contact.length > 0 && (
        <>
          <h2 className="mt-8 text-[16px] font-semibold">Help from {b.brandName}</h2>
          <p className="mt-1 text-[13px] text-ink-2">{b.supportHours}</p>
          <dl className="mt-2 grid grid-cols-[6rem_1fr] gap-y-1 text-[13.5px]">
            {contact.map((c) => (
              <div key={c.label} className="contents">
                <dt className="text-ink-2">{c.label}</dt>
                <dd>
                  <a className="text-accent underline-offset-2 hover:underline" href={c.href} target="_blank" rel="noreferrer">
                    {c.value}
                  </a>
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}
