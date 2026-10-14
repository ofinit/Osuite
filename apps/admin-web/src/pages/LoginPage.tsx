import { BrandMark } from '@osuite/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../api.ts';
import { ErrorText, Field } from '../components/ui.tsx';

export function LoginPage() {
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      qc.setQueryData(['me'], await api.login(email, password));
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full px-4 py-16">
      <div className="mx-auto max-w-sm">
        <div className="mb-6 flex items-center gap-2">
          <BrandMark withName />
          <span className="rounded bg-ink px-1.5 py-px text-[11px] font-semibold text-paper">Admin</span>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-lg border border-rule bg-sheet p-6 shadow-sm">
          <h1 className="text-[19px] font-semibold tracking-tight">Sign in</h1>
          <Field label="Email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus required />
          <Field
            label="Password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <ErrorText error={error} />
          <button className="btn-primary w-full justify-center" disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
