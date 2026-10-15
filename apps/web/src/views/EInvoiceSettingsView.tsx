import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api.ts';
import { useSession } from '../lib/session.ts';

/** Turn e-invoicing on and choose who connects to the GST portal. */
export function EInvoiceSettingsView() {
  const { license } = useSession();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['einvoice-settings'], queryFn: api.einvoiceSettings });
  const [form, setForm] = useState<{ enabled: boolean; provider: string } | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  useEffect(() => {
    if (data && !form) setForm({ enabled: data.enabled, provider: data.provider });
  }, [data, form]);
  const save = useMutation({
    mutationFn: () => api.saveEinvoiceSettings(form!),
    onSuccess: () => {
      setMessage({ kind: 'ok', text: 'E-invoicing settings saved.' });
      void qc.invalidateQueries({ queryKey: ['einvoice-settings'] });
    },
    onError: (e) => setMessage({ kind: 'error', text: e.message }),
  });
  const chosen = data?.providers.find((p) => p.id === form?.provider);

  return (
    <div className="h-full overflow-y-auto px-5 py-6 sm:px-10">
      <h1 className="text-[22px] font-semibold tracking-tight">E-invoicing</h1>
      <p className="mt-1 max-w-3xl text-ink-2">
        Businesses above the GST e-invoicing turnover limit must register B2B invoices and credit notes on the Invoice Registration Portal (IRP) and print
        the IRN and signed QR code on them. OSuite builds the e-invoice from each posted document, checks it against the portal’s rules, and records the
        IRN, the QR code and any e-way bill on the document.
      </p>

      {form && data && (
        <section className="mt-6 max-w-3xl space-y-4 rounded-[6px] border border-rule bg-sheet p-4 text-[13.5px]">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
            Generate e-invoices for B2B invoices and credit notes
          </label>
          <label className="block">
            <span className="mb-1 block text-[12.5px] text-ink-2">Connect through</span>
            <select className="field-input max-w-sm" value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value })}>
              {data.providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          {chosen?.simulated && (
            <p className="rounded-[4px] bg-amber-soft px-3 py-2 text-amber">
              The simulator works offline and produces IRNs exactly as the portal computes them, but nothing is registered with the government. Use it to
              try the workflow and check your data. To issue real e-invoices, OSuite connects through a GST Suvidha Provider (GSP) with your API
              credentials; ask OfinIT support to enable yours.
            </p>
          )}
          <p className="text-ink-3">
            The portal needs your full address and PIN code (set them under{' '}
            <Link to="/settings/company" className="text-accent underline-offset-2 hover:underline">
              Company
            </Link>
            ) and each customer’s GSTIN, address and PIN code.
          </p>
          <div className="flex items-center gap-3">
            <button className="btn-primary" disabled={!license.writable || save.isPending} onClick={() => save.mutate()}>
              Save
            </button>
            {message && (
              <span role="status" className={clsx(message.kind === 'error' ? 'text-crimson' : 'text-ok')}>
                {message.text}
              </span>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
