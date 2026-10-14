import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { DatabaseBackup, Download, RotateCcw, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api, downloadBackup, setToken, type BackupInfo, type BackupSettings } from '../lib/api.ts';
import { useSession } from '../lib/session.ts';

const KIND: Record<BackupInfo['kind'], string> = {
  auto: 'Daily',
  manual: 'Manual',
  'before-restore': 'Before a restore',
  uploaded: 'From a file',
};

const when = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));

function size(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Backups: take, download, restore, and the daily schedule. */
export function BackupView() {
  const { license } = useSession();
  const qc = useQueryClient();
  const { data, error } = useQuery({ queryKey: ['backups'], queryFn: api.backups });
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [form, setForm] = useState<BackupSettings | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (data && !form) setForm(data.settings);
  }, [data, form]);

  const refresh = () => void qc.invalidateQueries({ queryKey: ['backups'] });
  const fail = (e: Error) => setMessage({ kind: 'error', text: e.message });

  const backup = useMutation({
    mutationFn: api.backupNow,
    onSuccess: (b) => {
      setMessage({ kind: 'ok', text: `Backup taken (${size(b.size)}).` });
      refresh();
    },
    onError: fail,
  });
  const save = useMutation({
    mutationFn: (s: BackupSettings) => api.saveBackupSettings(s),
    onSuccess: (s) => {
      setForm(s);
      setMessage({ kind: 'ok', text: 'Backup settings saved.' });
      refresh();
    },
    onError: fail,
  });
  const restore = useMutation({
    mutationFn: (name: string) => api.restoreBackup(name),
    onSuccess: (r) => {
      // Sessions are not part of a backup: everyone signs in again.
      try {
        sessionStorage.setItem('osuite.notice', `Backup restored${r.company ? ` (${r.company})` : ''}. Sign in to continue.`);
      } catch {
        /* notice is a nicety */
      }
      setToken(null);
      window.location.assign('/');
    },
    onError: fail,
  });
  const upload = useMutation({
    mutationFn: (f: File) => api.uploadBackup(f),
    onSuccess: (b) => {
      refresh();
      if (confirmRestore(b, 'the uploaded file')) restore.mutate(b.name);
      else setMessage({ kind: 'ok', text: 'Backup file added to the list.' });
    },
    onError: fail,
  });
  const remove = useMutation({
    mutationFn: (name: string) => api.deleteBackup(name),
    onSuccess: refresh,
    onError: fail,
  });

  const busy = backup.isPending || restore.isPending || upload.isPending;
  const th = 'border-b border-rule-strong py-2 pr-4 text-[12.5px] font-medium whitespace-nowrap text-ink-2';
  const td = 'border-b border-rule py-2.5 pr-4';

  return (
    <div className="h-full overflow-y-auto px-5 py-6 sm:px-10">
      <div className="flex max-w-4xl flex-wrap items-center gap-3">
        <h1 className="mr-auto text-[22px] font-semibold tracking-tight">Backups</h1>
        {data?.available && (
          <>
            <input
              ref={fileInput}
              type="file"
              accept=".osbak"
              className="hidden"
              aria-label="Backup file"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f) upload.mutate(f);
              }}
            />
            {license.writable && (
              <button className="btn-outline" disabled={busy} onClick={() => fileInput.current?.click()}>
                <Upload size={15} /> Restore from a file
              </button>
            )}
            <button className="btn-primary" disabled={busy} onClick={() => backup.mutate()}>
              <DatabaseBackup size={15} /> {backup.isPending ? 'Backing up…' : 'Back up now'}
            </button>
          </>
        )}
      </div>
      <p className="mt-1 max-w-3xl text-ink-2">
        A backup holds all your company’s data. Restoring one replaces the current data; OSuite backs up the current data first, so a
        restore can be undone.
      </p>
      {error && <p className="mt-4 text-crimson">{error.message}</p>}
      {data && !data.available && (
        <p className="mt-4 max-w-3xl rounded-[5px] bg-crimson-soft px-3 py-2 text-[13px] text-crimson">
          Backups are not available on this installation because the PostgreSQL tools were not found.
        </p>
      )}
      {restore.isPending && (
        <p role="status" className="mt-4 text-[13px] text-ink-2">
          Restoring… other users are paused until this finishes.
        </p>
      )}
      {message && (
        <p role="status" className={clsx('mt-4 text-[13px]', message.kind === 'error' ? 'text-crimson' : 'text-ok')}>
          {message.text}
        </p>
      )}

      {data?.available && form && (
        <section className="mt-6 max-w-4xl rounded-[6px] border border-rule bg-sheet p-4">
          <h2 className="mb-3 font-semibold">Schedule</h2>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[13.5px]">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={form.auto} onChange={(e) => setForm({ ...form, auto: e.target.checked })} />
              Back up automatically every day
            </label>
            <label className="flex items-center gap-2">
              Keep the last
              <input
                type="number"
                min={1}
                max={365}
                className="field-input h-8 w-20"
                value={form.keep}
                onChange={(e) => setForm({ ...form, keep: Number(e.target.value) })}
              />
              daily backups
            </label>
          </div>
          <label className="mt-3 block text-[13.5px]">
            <span className="mb-1 block">Also copy each backup to this folder (another drive, a USB disk, or a OneDrive / Google Drive folder)</span>
            <input
              className="field-input max-w-xl"
              placeholder="D:\OSuite backups"
              value={form.copyTo ?? ''}
              onChange={(e) => setForm({ ...form, copyTo: e.target.value })}
            />
          </label>
          <div className="mt-3 flex items-center gap-3">
            <button className="btn-outline h-8" disabled={save.isPending} onClick={() => save.mutate(form)}>
              Save schedule
            </button>
            <span className="text-[12.5px] text-ink-3">Backups are kept in {data.folder}</span>
          </div>
        </section>
      )}

      {data?.available && (
        <table className="mt-6 w-full max-w-4xl border-separate border-spacing-0 text-left">
          <thead>
            <tr>
              <th className={th}>Taken</th>
              <th className={th}>Kind</th>
              <th className={th}>Company</th>
              <th className={clsx(th, 'text-right')}>Size</th>
              <th className={th} />
            </tr>
          </thead>
          <tbody>
            {data.backups.map((b) => (
              <tr key={b.name} className="hover:bg-sheet">
                <td className={clsx(td, 'whitespace-nowrap')} title={b.name}>
                  {when(b.createdAt)}
                </td>
                <td className={td}>{KIND[b.kind]}</td>
                <td className={td}>{b.company ?? '—'}</td>
                <td className={clsx(td, 'text-right tabular-nums')}>{size(b.size)}</td>
                <td className={clsx(td, 'text-right whitespace-nowrap')}>
                  <button className="btn-quiet h-8 px-2" title="Download" aria-label={`Download backup of ${when(b.createdAt)}`} onClick={() => downloadBackup(b.name).catch(fail)}>
                    <Download size={15} />
                  </button>
                  {license.writable && (
                    <button
                      className="btn-quiet h-8"
                      disabled={busy}
                      onClick={() => confirmRestore(b, `the backup of ${when(b.createdAt)}`) && restore.mutate(b.name)}
                    >
                      <RotateCcw size={15} /> Restore
                    </button>
                  )}
                  <button
                    className="btn-quiet h-8 px-2 text-crimson"
                    title="Delete"
                    aria-label={`Delete backup of ${when(b.createdAt)}`}
                    disabled={busy}
                    onClick={() => confirm(`Delete the backup of ${when(b.createdAt)}? This cannot be undone.`) && remove.mutate(b.name)}
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
            {data.backups.length === 0 && (
              <tr>
                <td colSpan={5} className={clsx(td, 'py-8 text-center text-ink-3')}>
                  No backups yet. {form?.auto ? 'The first daily backup is taken within the hour.' : ''}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}

function confirmRestore(b: BackupInfo, what: string) {
  return confirm(
    `Replace ALL current data with ${what}${b.company ? ` (${b.company})` : ''}?\n\n` +
      'Your current data is backed up first, so you can undo this from the Backups page. Everyone will need to sign in again.',
  );
}
