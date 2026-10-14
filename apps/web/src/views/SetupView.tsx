import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { IN_STATES } from '@osuite/kernel';
import { api, ApiError, setToken } from '../lib/api.ts';
import { AuthLayout, FormError, TextField } from './AuthLayout.tsx';

const STATES = [...IN_STATES].sort((a, b) => a[1].localeCompare(b[1]));

export function SetupView() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ companyName: '', gstin: '', stateCode: '', adminName: '', login: '', password: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const onGstin = (e: React.ChangeEvent<HTMLInputElement>) => {
    const gstin = e.target.value.toUpperCase();
    // The first two GSTIN digits are the state code.
    const code = gstin.slice(0, 2);
    setForm((f) => ({ ...f, gstin, stateCode: STATES.some(([c]) => c === code) ? code : f.stateCode }));
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.setup(form);
      const { token } = await api.login(form.login, form.password);
      setToken(token);
      await qc.invalidateQueries({ queryKey: ['bootstrap'] });
    } catch (err) {
      setErrors(err instanceof ApiError ? err.fieldErrors : {});
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Set up your company" intro="This takes a minute. You can change these details later.">
      <form onSubmit={submit} className="space-y-4">
        <TextField label="Company name" name="companyName" value={form.companyName} onChange={set('companyName')} error={errors.companyName} required autoFocus />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="GSTIN (optional)" name="gstin" value={form.gstin} onChange={onGstin} maxLength={15} />
          <div>
            <label htmlFor="a-state" className="mb-1 block text-[12.5px] font-medium text-ink-2">
              State
            </label>
            <select id="a-state" className="field-input" value={form.stateCode} onChange={set('stateCode')}>
              <option value="">Select</option>
              {STATES.map(([c, n]) => (
                <option key={c} value={c}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
        <hr className="border-rule" />
        <p className="text-[13px] text-ink-2">Your administrator account</p>
        <TextField label="Your name" name="adminName" value={form.adminName} onChange={set('adminName')} error={errors.adminName} required />
        <TextField label="Login" name="login" value={form.login} onChange={set('login')} error={errors.login} autoComplete="username" required />
        <TextField
          label="Password"
          name="password"
          type="password"
          value={form.password}
          onChange={set('password')}
          error={errors.password}
          autoComplete="new-password"
          minLength={8}
          required
        />
        <FormError message={error} />
        <button className="btn-primary w-full justify-center" disabled={busy}>
          {busy ? 'Setting up…' : 'Create company'}
        </button>
      </form>
    </AuthLayout>
  );
}
