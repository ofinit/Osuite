import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { api, ApiError } from '../lib/api.ts';
import { formatDate } from '../lib/format.ts';
import { useSession } from '../lib/session.ts';
import { FormError, TextField } from './AuthLayout.tsx';

export function UsersView() {
  const { user: me, license } = useSession();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['users'], queryFn: api.users });
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', login: '', password: '', isAdmin: false });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.createUser(form),
    onSuccess: () => {
      setAdding(false);
      setForm({ name: '', login: '', password: '', isAdmin: false });
      setErrors({});
      setError(null);
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err) => {
      setErrors(err instanceof ApiError ? err.fieldErrors : {});
      setError(err.message);
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: number; active: boolean }) => api.setUserActive(id, active),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['users'] }),
    onError: (err) => setError(err.message),
  });

  const active = data?.users.filter((u) => u.active).length ?? 0;

  return (
    <div className="h-full overflow-y-auto px-5 py-6 sm:px-10">
      <div className="flex max-w-3xl flex-wrap items-center gap-3">
        <h1 className="mr-auto text-[22px] font-semibold tracking-tight">Users</h1>
        {data && (
          <span className="text-[13px] text-ink-2">
            {data.seats ? `${active} of ${data.seats} seats in use` : `${active} active`}
          </span>
        )}
        {license.writable && !adding && (
          <button className="btn-primary" onClick={() => setAdding(true)}>
            <UserPlus size={16} /> Add user
          </button>
        )}
      </div>

      {adding && (
        <form
          className="mt-5 grid max-w-3xl grid-cols-1 gap-4 rounded-lg border border-rule bg-sheet p-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate();
          }}
        >
          <TextField label="Name" name="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} error={errors.name} autoFocus required />
          <TextField label="Login" name="login" value={form.login} onChange={(e) => setForm({ ...form, login: e.target.value })} error={errors.login} required />
          <TextField
            label="Temporary password"
            name="password"
            type="password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            error={errors.password}
            autoComplete="new-password"
            required
          />
          <label className="flex items-center gap-2.5 self-end pb-2">
            <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={form.isAdmin} onChange={(e) => setForm({ ...form, isAdmin: e.target.checked })} />
            Administrator
          </label>
          <div className="sm:col-span-2">
            <FormError message={error} />
          </div>
          <div className="flex gap-2 sm:col-span-2">
            <button className="btn-primary" disabled={create.isPending}>
              {create.isPending ? 'Adding…' : 'Add user'}
            </button>
            <button type="button" className="btn-quiet" onClick={() => setAdding(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <table className="mt-6 w-full max-w-3xl border-separate border-spacing-0 text-left">
        <thead>
          <tr className="text-[12.5px] text-ink-2">
            <th className="border-b border-rule-strong py-2 font-medium">Name</th>
            <th className="border-b border-rule-strong py-2 font-medium">Login</th>
            <th className="border-b border-rule-strong py-2 font-medium">Role</th>
            <th className="border-b border-rule-strong py-2 font-medium max-sm:hidden">Added</th>
            <th className="border-b border-rule-strong py-2" />
          </tr>
        </thead>
        <tbody>
          {data?.users.map((u) => (
            <tr key={u.id} className={u.active ? '' : 'text-ink-3'}>
              <td className="border-b border-rule py-2.5 font-medium">{u.name}</td>
              <td className="border-b border-rule py-2.5">{u.login}</td>
              <td className="border-b border-rule py-2.5">{u.isAdmin ? 'Administrator' : 'User'}</td>
              <td className="border-b border-rule py-2.5 max-sm:hidden">{formatDate(u.createdAt)}</td>
              <td className="border-b border-rule py-2.5 text-right">
                {u.id !== me.id && license.writable && (
                  <button className="btn-quiet h-8 text-[13px]" onClick={() => toggle.mutate({ id: u.id, active: !u.active })}>
                    {u.active ? 'Deactivate' : 'Reactivate'}
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {!adding && <div className="mt-3 max-w-3xl"><FormError message={error} /></div>}
    </div>
  );
}
