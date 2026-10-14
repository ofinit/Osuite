import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../api.ts';
import { Empty, ErrorText, Field, PageHeader, Table } from '../components/ui.tsx';
import { formatDate } from '../format.ts';

export function CustomersPage() {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [term, setTerm] = useState('');
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 200);
    return () => clearTimeout(t);
  }, [q]);

  const { data, isSuccess } = useQuery({
    queryKey: ['customers', term],
    queryFn: () => api.customers(term || undefined),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader title="Customers">
        <div className="relative w-full sm:w-64">
          <Search size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
          <input className="field-input pl-8" placeholder="Name, company, email or phone" aria-label="Search customers" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {!adding && (
          <button className="btn-primary" onClick={() => setAdding(true)}>
            <Plus size={16} /> Add customer
          </button>
        )}
      </PageHeader>

      {adding && <NewCustomer onDone={(id) => (id ? navigate(`/customers/${id}`) : setAdding(false))} />}

      {isSuccess && data.length === 0 ? (
        <Empty>{term ? `No customers match "${term}".` : 'No customers yet. Trials sign customers up automatically.'}</Empty>
      ) : (
        <Table head={['Customer', 'Contact', 'Licences', 'Since']}>
          {data?.map((c) => (
            <tr key={c.id} className="cursor-pointer hover:bg-sheet" onClick={() => navigate(`/customers/${c.id}`)}>
              <td>
                <span className="font-medium">{c.company ?? c.name}</span>
                {c.paying && <span className="ml-2 text-[12px] text-ok">Paying</span>}
                {c.company && <span className="block text-[12.5px] text-ink-3">{c.name}</span>}
              </td>
              <td>
                {c.email}
                {c.phone && <span className="block text-[12.5px] text-ink-3">{c.phone}</span>}
              </td>
              <td className="tabular-nums">{c.licenses}</td>
              <td className="whitespace-nowrap">{formatDate(c.createdAt)}</td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}

function NewCustomer({ onDone }: { onDone: (id?: number) => void }) {
  const qc = useQueryClient();
  const [v, setV] = useState({ name: '', email: '', phone: '', company: '', gstin: '' });
  const create = useMutation({
    mutationFn: () => api.createCustomer(v),
    onSuccess: (c) => {
      void qc.invalidateQueries({ queryKey: ['customers'] });
      onDone(c.id);
    },
  });
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value });

  return (
    <form
      className="mb-8 grid gap-4 rounded-lg border border-rule bg-sheet p-5 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        create.mutate();
      }}
    >
      <Field label="Contact name" value={v.name} onChange={set('name')} required autoFocus />
      <Field label="Email" type="email" value={v.email} onChange={set('email')} required />
      <Field label="Company" value={v.company} onChange={set('company')} />
      <Field label="Phone" type="tel" value={v.phone} onChange={set('phone')} />
      <Field label="GSTIN" value={v.gstin} onChange={set('gstin')} maxLength={15} hint="For GST invoices on their subscription" />
      <div className="sm:col-span-2">
        <ErrorText error={create.error} />
      </div>
      <div className="flex gap-2 sm:col-span-2">
        <button className="btn-primary" disabled={create.isPending}>
          Add customer
        </button>
        <button type="button" className="btn-quiet" onClick={() => onDone()}>
          Cancel
        </button>
      </div>
    </form>
  );
}
