import { useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useState } from 'react';
import { api } from '../lib/api.ts';
import { useSession } from '../lib/session.ts';
import { AuthLayout, FormError, TextField } from './AuthLayout.tsx';

export function ActivateView({ onSkip }: { onSkip?: () => void }) {
  return (
    <AuthLayout title="Activate OSuite" intro="Start a 14-day free trial, or enter the licence key from your purchase email.">
      <ActivationForms />
      {onSkip && (
        <button className="mt-5 text-[13px] text-ink-2 underline underline-offset-2 hover:text-ink" onClick={onSkip}>
          Look around first (read-only)
        </button>
      )}
    </AuthLayout>
  );
}

export function ActivationForms() {
  const { company, user } = useSession();
  const qc = useQueryClient();
  const [mode, setMode] = useState<'trial' | 'key'>('trial');
  const [key, setKey] = useState('');
  const [trial, setTrial] = useState({ name: user?.name ?? '', email: '', phone: '', company: company?.name ?? '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: ['bootstrap'] });
      await qc.invalidateQueries({ queryKey: ['license'] });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const tabClass = (m: string) =>
    clsx('flex-1 rounded-[4px] py-1.5 text-[13px]', mode === m ? 'bg-sheet font-medium text-ink shadow-sm' : 'text-ink-2');

  return (
    <div>
      <div role="tablist" className="mb-5 flex gap-1 rounded-[6px] bg-paper p-1">
        <button role="tab" aria-selected={mode === 'trial'} className={tabClass('trial')} onClick={() => setMode('trial')}>
          Free trial
        </button>
        <button role="tab" aria-selected={mode === 'key'} className={tabClass('key')} onClick={() => setMode('key')}>
          I have a licence key
        </button>
      </div>

      {mode === 'trial' ? (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api.startTrial(trial));
          }}
        >
          <TextField label="Your name" name="name" value={trial.name} onChange={(e) => setTrial({ ...trial, name: e.target.value })} required />
          <TextField label="Work email" name="email" type="email" value={trial.email} onChange={(e) => setTrial({ ...trial, email: e.target.value })} required />
          <TextField label="Mobile (optional)" name="phone" type="tel" value={trial.phone} onChange={(e) => setTrial({ ...trial, phone: e.target.value })} />
          <TextField label="Company" name="company" value={trial.company} onChange={(e) => setTrial({ ...trial, company: e.target.value })} required />
          <FormError message={error} />
          <button className="btn-primary w-full justify-center" disabled={busy}>
            {busy ? 'Starting…' : 'Start 14-day trial'}
          </button>
        </form>
      ) : (
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(() => api.activate(key));
          }}
        >
          <TextField
            label="Licence key"
            name="key"
            value={key}
            onChange={(e) => setKey(e.target.value.toUpperCase())}
            placeholder="OSX-XXXX-XXXX-XXXX-XXXX"
            className="field-input tracking-wider"
            autoFocus
            required
          />
          <FormError message={error} />
          <button className="btn-primary w-full justify-center" disabled={busy}>
            {busy ? 'Activating…' : 'Activate'}
          </button>
        </form>
      )}
      <p className="mt-4 text-[12.5px] text-ink-3">Activation needs an internet connection. After that, OSuite works offline.</p>
    </div>
  );
}
