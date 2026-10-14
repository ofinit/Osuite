import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type Plan, type StaffUser } from '../api.ts';
import { ErrorText, PageHeader, Table } from '../components/ui.tsx';
import { money } from '../format.ts';

export function PlansPage({ me }: { me: StaffUser }) {
  const { data: plans = [] } = useQuery({ queryKey: ['plans'], queryFn: api.plans });
  const owner = me.role === 'owner';
  return (
    <>
      <PageHeader
        title="Plans"
        sub={owner ? 'Prices are in rupees, before GST. Changes apply to new licences and renewals.' : 'Only the owner can change plans.'}
      />
      <Table head={['Plan', 'Users', 'Monthly', 'Yearly', 'Cloud add-on / month', 'Offered', '']}>
        {plans.map((p) => (owner && p.id !== 'trial' ? <EditableRow key={p.id} plan={p} /> : <ReadRow key={p.id} plan={p} />))}
      </Table>
    </>
  );
}

function ReadRow({ plan: p }: { plan: Plan }) {
  return (
    <tr>
      <td className="font-medium">{p.name}</td>
      <td className="tabular-nums">{p.seats}</td>
      <td className="tabular-nums">{money(p.priceMonthly)}</td>
      <td className="tabular-nums">{money(p.priceYearly)}</td>
      <td className="tabular-nums">{money(p.cloudAddonMonthly)}</td>
      <td>{p.active ? 'Yes' : 'No'}</td>
      <td />
    </tr>
  );
}

function EditableRow({ plan }: { plan: Plan }) {
  const qc = useQueryClient();
  const initial = {
    seats: String(plan.seats),
    priceMonthly: String(Number(plan.priceMonthly)),
    priceYearly: String(Number(plan.priceYearly)),
    cloudAddonMonthly: String(Number(plan.cloudAddonMonthly)),
    active: plan.active,
  };
  const [v, setV] = useState(initial);
  const save = useMutation({
    mutationFn: () => api.updatePlan(plan.id, { ...v, seats: Number(v.seats) }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['plans'] }),
  });
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const num = (k: 'seats' | 'priceMonthly' | 'priceYearly' | 'cloudAddonMonthly') => (
    <input
      className="field-input h-8 w-24 text-right"
      inputMode="decimal"
      aria-label={`${plan.name} ${k}`}
      value={v[k]}
      onChange={(e) => setV({ ...v, [k]: e.target.value.replace(/[^\d.]/g, '') })}
    />
  );

  return (
    <tr>
      <td className="font-medium">
        {plan.name}
        {save.error && (
          <div className="mt-1 max-w-xs">
            <ErrorText error={save.error} />
          </div>
        )}
      </td>
      <td>{num('seats')}</td>
      <td>{num('priceMonthly')}</td>
      <td>{num('priceYearly')}</td>
      <td>{num('cloudAddonMonthly')}</td>
      <td>
        <input
          type="checkbox"
          className="size-4 accent-[var(--accent)]"
          aria-label={`${plan.name} offered`}
          checked={v.active}
          onChange={(e) => setV({ ...v, active: e.target.checked })}
        />
      </td>
      <td className="text-right">
        <button className="btn-outline h-8" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
          Save
        </button>
      </td>
    </tr>
  );
}
