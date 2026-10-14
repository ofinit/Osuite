import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { api, type StaffUser } from '../api.ts';
import { ErrorText, Field, PageHeader, Select, Table } from '../components/ui.tsx';
import { formatDate, relativeDays } from '../format.ts';

export function TeamPage({ me }: { me: StaffUser }) {
  const qc = useQueryClient();
  const { data = [], error } = useQuery({ queryKey: ['staff'], queryFn: api.staff, enabled: me.role === 'owner' });
  const [adding, setAdding] = useState(false);
  const [v, setV] = useState({ name: '', email: '', password: '', role: 'staff' as 'owner' | 'staff' });
  const create = useMutation({
    mutationFn: () => api.createStaff(v),
    onSuccess: () => {
      setAdding(false);
      setV({ name: '', email: '', password: '', role: 'staff' });
      void qc.invalidateQueries({ queryKey: ['staff'] });
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => api.setStaffActive(id, active),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['staff'] }),
  });

  if (me.role !== 'owner') return <p className="text-ink-2">Only the owner can manage the team.</p>;

  return (
    <>
      <PageHeader title="Team" sub="Staff can manage customers and licences. Owners can also change plans and the team.">
        {!adding && (
          <button className="btn-primary" onClick={() => setAdding(true)}>
            <UserPlus size={16} /> Add person
          </button>
        )}
      </PageHeader>
      <ErrorText error={error ?? toggle.error} />

      {adding && (
        <form
          className="mb-8 grid gap-4 rounded-lg border border-rule bg-sheet p-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <Field label="Name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} required autoFocus />
          <Field label="Email" type="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} required />
          <Field
            label="Temporary password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            hint="At least 10 characters. Ask them to change it after signing in."
            value={v.password}
            onChange={(e) => setV({ ...v, password: e.target.value })}
            required
          />
          <Select label="Role" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as 'owner' | 'staff' })}>
            <option value="staff">Staff</option>
            <option value="owner">Owner</option>
          </Select>
          <div className="sm:col-span-2">
            <ErrorText error={create.error} />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <button className="btn-primary" disabled={create.isPending}>
              Add person
            </button>
            <button type="button" className="btn-quiet" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <Table head={['Name', 'Role', 'Last signed in', 'Added', '']}>
        {data.map((s) => (
          <tr key={s.id} className={s.active ? '' : 'text-ink-3'}>
            <td>
              <span className="font-medium">{s.name}</span>
              <span className="block text-[12.5px] text-ink-3">{s.email}</span>
            </td>
            <td>{s.role === 'owner' ? 'Owner' : 'Staff'}</td>
            <td>{s.lastLoginAt ? relativeDays(s.lastLoginAt) : 'Never'}</td>
            <td className="whitespace-nowrap">{formatDate(s.createdAt)}</td>
            <td className="text-right">
              {s.id !== me.id && (
                <button className="btn-quiet h-8 text-[13px]" onClick={() => toggle.mutate({ id: s.id, active: !s.active })}>
                  {s.active ? 'Deactivate' : 'Reactivate'}
                </button>
              )}
            </td>
          </tr>
        ))}
      </Table>
    </>
  );
}
