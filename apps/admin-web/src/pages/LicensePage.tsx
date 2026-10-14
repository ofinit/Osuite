import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { api, type Deployment, type LicenseDetail } from '../api.ts';
import { Empty, ErrorText, Field, PageHeader, Select, StandingBadge, Table } from '../components/ui.tsx';
import { actionLabel, cycleLabel, describeDetails, formatDate, formatDateTime, money, relativeDays } from '../format.ts';

export function LicensePage() {
  const { id = '' } = useParams();
  const { data, error } = useQuery({ queryKey: ['license', id], queryFn: () => api.license(id) });
  if (error) return <p className="text-crimson">{error.message}</p>;
  if (!data) return null;
  return <LicenseView d={data} />;
}

function useLicenseAction<T>(id: string, fn: (v: T) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['license', id] });
      void qc.invalidateQueries({ queryKey: ['licenses'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}

function LicenseView({ d }: { d: LicenseDetail }) {
  const { license: l, customer: c, plan, standing } = d;
  const revoked = l.status === 'revoked';
  const isTrial = l.billingCycle === 'trial';
  const activeMachines = d.machines.filter((m) => !m.deactivatedAt);

  const renew = useLicenseAction(l.id, (cycle: 'monthly' | 'yearly') => api.renew(l.id, cycle));
  const status = useLicenseAction(l.id, (s: 'active' | 'suspended' | 'revoked') => api.setStatus(l.id, s));
  const removeMachine = useLicenseAction(l.id, (mid: number) => api.removeMachine(mid));
  const err = renew.error ?? status.error ?? removeMachine.error;

  const price = l.billingCycle === 'yearly' ? `${money(plan.priceYearly)} a year` : isTrial ? 'Free' : `${money(plan.priceMonthly)} a month`;

  return (
    <>
      <PageHeader
        title={c.company ?? c.name}
        sub={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StandingBadge standing={standing} />
            <Link to={`/customers/${c.id}`} className="underline-offset-2 hover:underline">
              {c.name}, {c.email}
            </Link>
          </span>
        }
      />

      <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0 space-y-10">
          <dl className="divide-y divide-rule border-y border-rule">
            <Row label="Licence key">
              <KeyCopy value={l.key} />
            </Row>
            <Row label="Plan">
              {plan.name}, {cycleLabel[l.billingCycle].toLowerCase()} <span className="text-ink-3">({price})</span>
            </Row>
            <Row label={isTrial ? 'Trial ends' : 'Paid until'}>
              {formatDate(l.currentPeriodEnd)} <span className="text-ink-3">({relativeDays(l.currentPeriodEnd)})</span>
            </Row>
            <Row label="Users">{l.seats}</Row>
            <Row label="Computers">
              {activeMachines.length} of {l.maxActivations} in use
            </Row>
            <Row label="Hosting">{l.deployment === 'cloud' ? `Cloud (+${money(plan.cloudAddonMonthly)} a month)` : 'Customer’s computer'}</Row>
            {l.razorpaySubscriptionId && <Row label="Razorpay subscription">{l.razorpaySubscriptionId}</Row>}
            <Row label="Issued">{formatDate(l.createdAt)}</Row>
          </dl>

          <section>
            <h2 className="mb-3 text-[15px] font-semibold">Computers</h2>
            {d.machines.length === 0 ? (
              <Empty>Not activated on any computer yet. Send the customer the licence key.</Empty>
            ) : (
              <Table head={['Computer', 'App version', 'Last seen', '']}>
                {d.machines.map((m) => (
                  <tr key={m.id} className={m.deactivatedAt ? 'text-ink-3' : ''}>
                    <td>
                      {m.hostname ?? 'Unknown'}
                      <span className="block text-[12px] text-ink-3">{m.fingerprint.slice(0, 12)}</span>
                    </td>
                    <td>{m.appVersion ?? ''}</td>
                    <td className="whitespace-nowrap">
                      {m.deactivatedAt ? `Removed ${formatDate(m.deactivatedAt)}` : m.lastCheckinAt ? relativeDays(m.lastCheckinAt) : 'Never'}
                    </td>
                    <td className="text-right">
                      {!m.deactivatedAt && !revoked && (
                        <button
                          className="btn-quiet h-8 text-[13px]"
                          disabled={removeMachine.isPending}
                          onClick={() =>
                            confirm(`Remove ${m.hostname ?? 'this computer'}? The licence can then be activated on another computer.`) &&
                            removeMachine.mutate(m.id)
                          }
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </Table>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-[15px] font-semibold">History</h2>
            {d.history.length === 0 ? (
              <Empty>No changes yet.</Empty>
            ) : (
              <ol className="divide-y divide-rule border-y border-rule">
                {d.history.map((h) => {
                  const detail = describeDetails(h.action, h.details);
                  return (
                    <li key={`${h.kind}-${h.id}`} className="py-2.5">
                      <span className="font-medium">{actionLabel(h.action)}</span>
                      {detail && <span className="block text-[13px] text-ink-2">{detail}</span>}
                      <span className="block text-[12.5px] text-ink-3">
                        {h.kind === 'billing' ? 'Razorpay' : (h.staffName ?? 'System')}, {formatDateTime(h.at)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>

        <aside className="space-y-8">
          <ErrorText error={err} />
          {revoked ? (
            <p className="text-ink-2">This licence is revoked and can no longer be changed. Issue a new licence from the customer’s page.</p>
          ) : (
            <>
              {!isTrial && (
                <Panel
                  title="Record a renewal"
                  note="Use when payment arrived outside Razorpay. Extends from the later of today or the current end date; billing stays as it is."
                >
                  <div className="flex gap-2">
                    {(['monthly', 'yearly'] as const).map((cy) => (
                      <button
                        key={cy}
                        className="btn-outline flex-1 justify-center"
                        disabled={renew.isPending}
                        onClick={() => confirm(`Extend by one ${cy === 'monthly' ? 'month' : 'year'}?`) && renew.mutate(cy)}
                      >
                        + 1 {cy === 'monthly' ? 'month' : 'year'}
                      </button>
                    ))}
                  </div>
                </Panel>
              )}
              <ChangePlan d={d} />
              <EditLimits d={d} />
              <Panel title="Access">
                <div className="flex flex-wrap gap-2">
                  {l.status === 'suspended' ? (
                    <button className="btn-outline" onClick={() => status.mutate('active')}>
                      Reactivate
                    </button>
                  ) : (
                    <button
                      className="btn-outline"
                      onClick={() => confirm('Suspend? The customer’s app goes read-only after its grace period.') && status.mutate('suspended')}
                    >
                      Suspend
                    </button>
                  )}
                  <button
                    className="btn-quiet text-crimson hover:bg-crimson-soft hover:text-crimson"
                    onClick={() =>
                      prompt('Revoking is permanent: the app stops working with this key at its next check-in. Type REVOKE to confirm.') ===
                        'REVOKE' && status.mutate('revoked')
                    }
                  >
                    Revoke
                  </button>
                </div>
              </Panel>
            </>
          )}
        </aside>
      </div>
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-0.5 py-2.5">
      <dt className="w-40 shrink-0 text-ink-2">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

function Panel({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="text-[14px] font-semibold">{title}</h2>
      {note && <p className="mt-0.5 mb-2.5 text-[12.5px] text-ink-3">{note}</p>}
      <div className={note ? '' : 'mt-2.5'}>{children}</div>
    </section>
  );
}

function KeyCopy({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-medium tracking-wider">{value}</span>
      <button
        className="btn-quiet h-7 px-1.5"
        aria-label="Copy licence key"
        title="Copy"
        onClick={() =>
          void navigator.clipboard.writeText(value).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          })
        }
      >
        {copied ? <Check size={14} className="text-ok" /> : <Copy size={14} />}
      </button>
    </span>
  );
}

function ChangePlan({ d }: { d: LicenseDetail }) {
  const l = d.license;
  const isTrial = l.billingCycle === 'trial';
  const { data: plans = [] } = useQuery({ queryKey: ['plans'], queryFn: api.plans });
  const paid = plans.filter((p) => p.id !== 'trial' && p.active);
  const [planId, setPlanId] = useState(isTrial ? '' : l.planId);
  const [cycle, setCycle] = useState<'monthly' | 'yearly'>(l.billingCycle === 'yearly' ? 'yearly' : 'monthly');
  const change = useLicenseAction(l.id, () => api.changePlan(l.id, planId, cycle));
  const unchanged = planId === l.planId && cycle === l.billingCycle;

  return (
    <Panel
      title={isTrial ? 'Convert to paid' : 'Change plan'}
      note={isTrial ? 'Keeps the same key and computer. The customer’s app upgrades at its next check-in.' : undefined}
    >
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          change.mutate();
        }}
      >
        <Select label="Plan" value={planId} onChange={(e) => setPlanId(e.target.value)} required>
          <option value="" disabled>
            Choose a plan
          </option>
          {paid.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}: {p.seats} users, {money(p.priceMonthly)}/mo
            </option>
          ))}
        </Select>
        <Select label="Billing" value={cycle} onChange={(e) => setCycle(e.target.value as 'monthly' | 'yearly')}>
          <option value="monthly">Monthly</option>
          <option value="yearly">Yearly</option>
        </Select>
        <ErrorText error={change.error} />
        <button className="btn-primary" disabled={!planId || unchanged || change.isPending}>
          {isTrial ? 'Convert to paid' : 'Change plan'}
        </button>
      </form>
    </Panel>
  );
}

function EditLimits({ d }: { d: LicenseDetail }) {
  const l = d.license;
  const [seats, setSeats] = useState(String(l.seats));
  const [machines, setMachines] = useState(String(l.maxActivations));
  const [deployment, setDeployment] = useState<Deployment>(l.deployment);
  const save = useLicenseAction(l.id, () =>
    api.updateLicense(l.id, { seats: Number(seats), maxActivations: Number(machines), deployment }),
  );
  const dirty = seats !== String(l.seats) || machines !== String(l.maxActivations) || deployment !== l.deployment;

  return (
    <Panel title="Limits">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Users" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value.replace(/\D/g, ''))} />
          <Field label="Computers" inputMode="numeric" value={machines} onChange={(e) => setMachines(e.target.value.replace(/\D/g, ''))} />
        </div>
        <Select label="Hosting" value={deployment} onChange={(e) => setDeployment(e.target.value as Deployment)}>
          <option value="desktop">Customer’s computer</option>
          <option value="cloud">Cloud (hosted by us)</option>
        </Select>
        <ErrorText error={save.error} />
        <button className="btn-outline" disabled={!dirty || save.isPending}>
          Save limits
        </button>
      </form>
    </Panel>
  );
}
