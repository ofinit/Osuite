import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { api, type Customer, type Deployment } from '../api.ts';
import { Empty, ErrorText, Field, PageHeader, Select, StandingBadge, Table } from '../components/ui.tsx';
import { cycleLabel, formatDate, money } from '../format.ts';

export function CustomerPage() {
  const id = Number(useParams().id);
  const { data: customer, error } = useQuery({ queryKey: ['customer', id], queryFn: () => api.customer(id) });
  const { data: licenses = [] } = useQuery({ queryKey: ['customer-licenses', id], queryFn: () => api.customerLicenses(id) });
  if (error) return <p className="text-crimson">{error.message}</p>;
  if (!customer) return null;

  return (
    <>
      <PageHeader title={customer.company ?? customer.name} sub={`Customer since ${formatDate(customer.createdAt)}`} />
      <div className="grid gap-10 lg:grid-cols-[1fr_320px]">
        <section className="min-w-0">
          <h2 className="mb-3 text-[15px] font-semibold">Licences</h2>
          {licenses.length === 0 ? (
            <Empty>No licences yet. Issue one on the right.</Empty>
          ) : (
            <Table head={['Key', 'Plan', 'Paid until', 'Status']}>
              {licenses.map((l) => (
                <tr key={l.id}>
                  <td>
                    <Link to={`/licenses/${l.id}`} className="font-medium tracking-wide hover:underline">
                      {l.key}
                    </Link>
                  </td>
                  <td>
                    {l.planName}
                    <span className="block text-[12.5px] text-ink-3">
                      {cycleLabel[l.billingCycle]}
                      {l.deployment === 'cloud' && ', cloud'}
                    </span>
                  </td>
                  <td className="whitespace-nowrap">{formatDate(l.currentPeriodEnd)}</td>
                  <td>
                    <StandingBadge standing={l.standing} />
                  </td>
                </tr>
              ))}
            </Table>
          )}
          <h2 className="mt-10 mb-3 text-[15px] font-semibold">Details</h2>
          <EditCustomer customer={customer} />
        </section>
        <aside>
          <IssueLicense customerId={customer.id} />
        </aside>
      </div>
    </>
  );
}

function EditCustomer({ customer }: { customer: Customer }) {
  const qc = useQueryClient();
  const initial = {
    name: customer.name,
    email: customer.email,
    phone: customer.phone ?? '',
    company: customer.company ?? '',
    gstin: customer.gstin ?? '',
  };
  const [v, setV] = useState(initial);
  useEffect(() => {
    setV(initial);
  }, [customer]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = useMutation({
    mutationFn: () => api.updateCustomer(customer.id, v),
    onSuccess: (c) => {
      qc.setQueryData(['customer', customer.id], c);
      void qc.invalidateQueries({ queryKey: ['customers'] });
    },
  });
  const dirty = JSON.stringify(v) !== JSON.stringify(initial);
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  return (
    <form
      className="grid max-w-2xl gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate();
      }}
    >
      <Field label="Contact name" value={v.name} onChange={set('name')} required />
      <Field label="Email" type="email" value={v.email} onChange={set('email')} required />
      <Field label="Company" value={v.company} onChange={set('company')} />
      <Field label="Phone" type="tel" value={v.phone} onChange={set('phone')} />
      <Field label="GSTIN" value={v.gstin} onChange={set('gstin')} maxLength={15} />
      <div className="sm:col-span-2">
        <ErrorText error={save.error} />
        {save.isSuccess && !dirty && <p className="text-[13px] text-ok">Saved</p>}
      </div>
      <div className="sm:col-span-2">
        <button className="btn-outline" disabled={!dirty || save.isPending}>
          Save details
        </button>
      </div>
    </form>
  );
}

function IssueLicense({ customerId }: { customerId: number }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: plans = [] } = useQuery({ queryKey: ['plans'], queryFn: api.plans });
  const paid = plans.filter((p) => p.id !== 'trial' && p.active);
  const [planId, setPlanId] = useState('');
  const [cycle, setCycle] = useState<'monthly' | 'yearly'>('yearly');
  const [deployment, setDeployment] = useState<Deployment>('desktop');
  const issue = useMutation({
    mutationFn: () => api.createLicense({ customerId, planId, billingCycle: cycle, deployment }),
    onSuccess: (l) => {
      void qc.invalidateQueries({ queryKey: ['customer-licenses', customerId] });
      void qc.invalidateQueries({ queryKey: ['licenses'] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
      navigate(`/licenses/${l.id}`);
    },
  });
  const plan = paid.find((p) => p.id === planId);
  const total = plan
    ? (cycle === 'yearly' ? Number(plan.priceYearly) : Number(plan.priceMonthly)) +
      (deployment === 'cloud' ? Number(plan.cloudAddonMonthly) * (cycle === 'yearly' ? 12 : 1) : 0)
    : null;

  return (
    <section>
      <h2 className="text-[14px] font-semibold">Issue a licence</h2>
      <p className="mt-0.5 mb-3 text-[12.5px] text-ink-3">Starts today. A new key is generated for the customer to enter.</p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          issue.mutate();
        }}
      >
        <Select label="Plan" value={planId} onChange={(e) => setPlanId(e.target.value)} required>
          <option value="" disabled>
            Choose a plan
          </option>
          {paid.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}: {p.seats} users
            </option>
          ))}
        </Select>
        <Select label="Billing" value={cycle} onChange={(e) => setCycle(e.target.value as 'monthly' | 'yearly')}>
          <option value="yearly">Yearly</option>
          <option value="monthly">Monthly</option>
        </Select>
        <Select label="Hosting" value={deployment} onChange={(e) => setDeployment(e.target.value as Deployment)}>
          <option value="desktop">Customer’s computer</option>
          <option value="cloud">Cloud (hosted by us)</option>
        </Select>
        {total !== null && (
          <p className="text-[13px] text-ink-2">
            {money(total)} per {cycle === 'yearly' ? 'year' : 'month'}, before GST
          </p>
        )}
        <ErrorText error={issue.error} />
        <button className="btn-primary" disabled={!planId || issue.isPending}>
          Issue licence
        </button>
      </form>
    </section>
  );
}
