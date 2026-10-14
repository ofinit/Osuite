import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api, setToken } from '../lib/api.ts';
import { AuthLayout, FormError, TextField } from './AuthLayout.tsx';

export function LoginView({ company }: { company?: string }) {
  const qc = useQueryClient();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One-time notice left by the page that signed us out (e.g. after a restore).
  const [notice] = useState(() => {
    try {
      const n = sessionStorage.getItem('osuite.notice');
      sessionStorage.removeItem('osuite.notice');
      return n;
    } catch {
      return null;
    }
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await api.login(login, password);
      setToken(res.token);
      await qc.invalidateQueries({ queryKey: ['bootstrap'] });
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <AuthLayout title="Sign in" intro={company}>
      <form onSubmit={submit} className="space-y-4">
        {notice && (
          <p role="status" className="rounded-[5px] bg-accent-soft px-3 py-2 text-[13px] text-ink">
            {notice}
          </p>
        )}
        <TextField label="Login" name="login" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" autoFocus required />
        <TextField
          label="Password"
          name="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        <FormError message={error} />
        <button className="btn-primary w-full justify-center" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </AuthLayout>
  );
}
