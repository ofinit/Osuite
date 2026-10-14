import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api, type StaffUser } from '../api.ts';
import { ErrorText, Field, PageHeader } from '../components/ui.tsx';

export function AccountPage({ me }: { me: StaffUser }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirmNext, setConfirmNext] = useState('');
  const change = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: () => {
      setCurrent('');
      setNext('');
      setConfirmNext('');
    },
  });
  const mismatch = confirmNext.length > 0 && next !== confirmNext;

  return (
    <>
      <PageHeader title="My account" sub={`${me.name}, ${me.email}`} />
      <form
        className="max-w-sm space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!mismatch) change.mutate();
        }}
      >
        <h2 className="text-[15px] font-semibold">Change password</h2>
        <Field label="Current password" type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
        <Field
          label="New password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          hint="At least 10 characters"
          value={next}
          onChange={(e) => setNext(e.target.value)}
          required
        />
        <Field label="Repeat new password" type="password" autoComplete="new-password" value={confirmNext} onChange={(e) => setConfirmNext(e.target.value)} required />
        <ErrorText error={mismatch ? 'The new passwords do not match' : change.error} />
        {change.isSuccess && <p className="text-[13px] text-ok">Password changed</p>}
        <button className="btn-primary" disabled={change.isPending || mismatch}>
          Change password
        </button>
      </form>
    </>
  );
}
