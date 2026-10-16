import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api, ApiError, type UserRow } from '../lib/api.ts';
import { formatDate } from '../lib/format.ts';
import { useSession } from '../lib/session.ts';
import { FormError, TextField } from './AuthLayout.tsx';

/** One choice covers both: "admin", or a role id. */
const ADMIN = 'admin';
const accessValue = (u: Pick<UserRow, 'isAdmin' | 'roleId'>) => (u.isAdmin ? ADMIN : u.roleId ? String(u.roleId) : '');
const accessInput = (v: string) => ({ isAdmin: v === ADMIN, roleId: v && v !== ADMIN ? Number(v) : null });

export function UsersView() {
  const { user: me, license } = useSession();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['users'], queryFn: api.users });
  const { data: roles } = useQuery({ queryKey: ['list', 'base.role', 'all'], queryFn: () => api.search('base.role', { limit: 100 }) });
  const [adding, setAdding] = useState(false);
  const empty = { name: '', login: '', password: '', access: '' };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.createUser({ name: form.name, login: form.login, password: form.password, ...accessInput(form.access) }),
    onSuccess: () => {
      setAdding(false);
      setForm(empty);
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
  const changeAccess = useMutation({
    mutationFn: ({ id, value }: { id: number; value: string }) => api.setUserAccess(id, accessInput(value)),
    onSuccess: () => {
      setError(null);
      void qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err) => setError(err.message),
  });

  const active = data?.users.filter((u) => u.active).length ?? 0;
  const options = (
    <>
      <option value={ADMIN}>Administrator (everything)</option>
      {roles?.records.map((r) => (
        <option key={String(r.id)} value={String(r.id)}>
          {String(r.name)}
        </option>
      ))}
    </>
  );

  return (
    <div className="h-full overflow-y-auto px-5 py-6 sm:px-10">
      <div className="flex max-w-3xl flex-wrap items-center gap-3">
        <h1 className="mr-auto text-[22px] font-semibold tracking-tight">Users</h1>
        {data && (
          <span className="text-[13px] text-ink-2">
            {data.seats ? `${active} of ${data.seats} seats in use` : `${active} active`}
          </span>
        )}
        <Link className="btn-outline" to="/m/base.role">
          Roles
        </Link>
        {license.writable && !adding && (
          <button className="btn-primary" onClick={() => setAdding(true)}>
            <UserPlus size={16} /> Add user
          </button>
        )}
      </div>
      <p className="mt-1 max-w-3xl text-[13px] text-ink-2">
        A role sets what someone may do in sales, purchases, stock, payments, accounts and GST. Administrators may do everything, including
        company settings, users and backups.
      </p>

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
          <div>
            <label htmlFor="a-access" className="mb-1 block text-[12.5px] font-medium text-ink-2">
              Role
            </label>
            <select
              id="a-access"
              className="field-input"
              value={form.access}
              onChange={(e) => setForm({ ...form, access: e.target.value })}
              aria-invalid={errors.roleId ? true : undefined}
              required
            >
              <option value="">Choose…</option>
              {options}
            </select>
            {errors.roleId && <p className="mt-1 text-[12.5px] text-crimson">{errors.roleId}</p>}
          </div>
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
              <td className="border-b border-rule py-1.5">
                {u.id === me.id || !license.writable ? (
                  (u.isAdmin ? 'Administrator' : (u.roleName ?? 'No role'))
                ) : (
                  <select
                    className="field-input h-8 py-0 text-[13px]"
                    aria-label={`Role of ${u.name}`}
                    value={accessValue(u)}
                    onChange={(e) => changeAccess.mutate({ id: u.id, value: e.target.value })}
                  >
                    {!accessValue(u) && <option value="">No role</option>}
                    {options}
                  </select>
                )}
              </td>
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
      {!adding && (
        <div className="mt-3 max-w-3xl">
          <FormError message={error} />
        </div>
      )}
    </div>
  );
}
