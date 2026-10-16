import { TRANSPORT_MODES, type ModelDef, type RecordData } from '@osuite/kernel';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleCheck, Download, FileBadge, TriangleAlert, Truck } from 'lucide-react';
import { useState } from 'react';
import { api, type EWayBillRequest } from '../lib/api.ts';
import { formatDate } from '../lib/format.ts';
import { useAccess } from '../lib/access.ts';
import { useSession } from '../lib/session.ts';

const MODELS = new Set(['sales.invoice', 'sales.credit_note']);
const DAY = 24 * 60 * 60 * 1000;
const CANCEL_REASONS = [
  ['1', 'Duplicate'],
  ['2', 'Data entry mistake'],
  ['3', 'Order cancelled'],
  ['4', 'Other'],
] as const;

const when = (iso: unknown) =>
  iso ? new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(String(iso))) : '';

function saveJson(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** E-invoice (IRN) and e-way bill for a posted sales document. */
export function EInvoicePanel({ model, record, onChanged }: { model: ModelDef; record: RecordData; onChanged: (text: string) => void }) {
  const { license } = useSession();
  const access = useAccess();
  const qc = useQueryClient();
  // E-invoicing belongs to the GST area of a role.
  const applies = MODELS.has(model.name) && record.state !== 'draft' && access.area('gst');
  const { data: settings } = useQuery({ queryKey: ['einvoice-settings'], queryFn: api.einvoiceSettings, enabled: applies, staleTime: 60_000 });
  const live = applies && !!settings?.enabled;
  const { data: preview } = useQuery({
    queryKey: ['einvoice', model.name, record.id, record.updatedAt],
    queryFn: () => api.einvoicePreview(model.name, record.id),
    enabled: live && !record.irnStatus,
  });
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<'irn' | 'ewb' | null>(null);
  const [reason, setReason] = useState('2');
  const [remark, setRemark] = useState('');
  const [ewbOpen, setEwbOpen] = useState(false);
  const [ewb, setEwb] = useState<EWayBillRequest>({ distanceKm: 0, transMode: '1', vehicleNo: '' });

  const done = (text: string) => {
    setError(null);
    setCancelling(null);
    setEwbOpen(false);
    setRemark('');
    void qc.invalidateQueries({ queryKey: ['einvoice', model.name, record.id] });
    onChanged(text);
  };
  const fail = (e: Error) => setError(e.message);
  const generate = useMutation({ mutationFn: () => api.einvoiceGenerate(model.name, record.id), onSuccess: (r) => done(r.simulated ? 'Simulated e-invoice generated' : 'E-invoice generated'), onError: fail });
  const cancel = useMutation({
    mutationFn: () => (cancelling === 'ewb' ? api.ewayBillCancel : api.einvoiceCancel)(model.name, record.id, { reason, remark }),
    onSuccess: () => done(cancelling === 'ewb' ? 'E-way bill cancelled' : 'E-invoice cancelled'),
    onError: fail,
  });
  const makeEwb = useMutation({ mutationFn: () => api.ewayBill(model.name, record.id, ewb), onSuccess: (r) => done(`E-way bill ${r.ewbNo} generated`), onError: fail });

  if (!live) return null;
  const busy = generate.isPending || cancel.isPending || makeEwb.isPending;
  const canWrite = license.writable && record.state === 'posted' && access.area('gst', 'edit');
  const canCancel = access.area('gst', 'full');
  const irnActive = record.irnStatus === 'active';
  const within24h = (iso: unknown) => !!iso && Date.now() - Date.parse(String(iso)) < DAY;
  const simulated = !!record.irnSimulated;

  return (
    <section aria-label="E-invoice" className="rounded-[6px] border border-rule bg-sheet px-4 py-3 text-[13.5px]">
      <div className="flex flex-wrap items-center gap-3">
        <FileBadge size={16} className="text-ink-2" />
        <h2 className="mr-auto font-semibold">E-invoice</h2>
        {!record.irnStatus && preview && !preview.skipReason && canWrite && (
          <button type="button" className="btn-primary h-8" disabled={busy || preview.problems.length > 0} onClick={() => generate.mutate()}>
            {generate.isPending ? 'Generating…' : 'Generate e-invoice'}
          </button>
        )}
        {preview && !record.irnStatus && (
          <button type="button" className="btn-quiet h-8" onClick={() => saveJson(`${String(record.number ?? 'draft').replaceAll('/', '-')}-einvoice.json`, preview.payload)}>
            <Download size={14} /> JSON
          </button>
        )}
      </div>

      {simulated && irnActive && (
        <p className="mt-2 rounded-[4px] bg-amber-soft px-2 py-1 text-[12.5px] text-amber">
          Simulated: not registered with the GST portal. Connect a GSP under Settings → E-invoicing before issuing real e-invoices.
        </p>
      )}

      {!record.irnStatus && preview?.skipReason && <p className="mt-1 text-ink-3">{preview.skipReason}</p>}
      {!record.irnStatus && preview && !preview.skipReason && preview.problems.length === 0 && (
        <p className="mt-1 flex items-center gap-1.5 text-ok">
          <CircleCheck size={14} /> Ready: all details the portal checks are present.
        </p>
      )}
      {!record.irnStatus && preview && !preview.skipReason && preview.problems.length > 0 && (
        <div className="mt-2 text-amber">
          <p className="flex items-center gap-1.5 font-medium">
            <TriangleAlert size={14} /> Fix these before generating:
          </p>
          <ul className="mt-1 list-disc pl-6 text-ink-2">
            {preview.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      )}

      {!!record.irnStatus && (
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5">
          <dt className="text-ink-2">IRN</dt>
          <dd className="font-mono text-[12px] break-all">
            {String(record.irn)}
            {record.irnStatus === 'cancelled' && <span className="ml-2 font-sans text-crimson">Cancelled</span>}
          </dd>
          <dt className="text-ink-2">Acknowledgement</dt>
          <dd>
            {String(record.irnAckNo)} on {when(record.irnAckDate)}
          </dd>
          {!!record.ewbStatus && (
            <>
              <dt className="text-ink-2">E-way bill</dt>
              <dd>
                {String(record.ewbNo)}, valid until {formatDate(String(record.ewbValidUntil))}
                {record.ewbStatus === 'cancelled' && <span className="ml-2 text-crimson">Cancelled</span>}
              </dd>
            </>
          )}
        </dl>
      )}

      {canWrite && irnActive && !cancelling && !ewbOpen && (
        <div className="mt-3 flex flex-wrap gap-2">
          {model.name === 'sales.invoice' && !record.ewbStatus && (
            <button type="button" className="btn-outline h-8" disabled={busy} onClick={() => setEwbOpen(true)}>
              <Truck size={14} /> E-way bill
            </button>
          )}
          {canCancel && record.ewbStatus === 'active' && within24h(record.ewbDate) && (
            <button type="button" className="btn-quiet h-8 text-crimson" onClick={() => setCancelling('ewb')}>
              Cancel e-way bill
            </button>
          )}
          {canCancel && record.ewbStatus !== 'active' && within24h(record.irnAckDate) && (
            <button type="button" className="btn-quiet h-8 text-crimson" onClick={() => setCancelling('irn')}>
              Cancel e-invoice
            </button>
          )}
        </div>
      )}

      {ewbOpen && (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="block">
            <span className="mb-1 block text-[12.5px] text-ink-2">Distance (km)</span>
            <input className="field-input" type="number" min={0} max={4000} value={ewb.distanceKm} onChange={(e) => setEwb({ ...ewb, distanceKm: Number(e.target.value) })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12.5px] text-ink-2">Mode</span>
            <select className="field-input" value={ewb.transMode} onChange={(e) => setEwb({ ...ewb, transMode: e.target.value })}>
              {TRANSPORT_MODES.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[12.5px] text-ink-2">Vehicle number</span>
            <input className="field-input" placeholder="MH12AB1234" value={ewb.vehicleNo} onChange={(e) => setEwb({ ...ewb, vehicleNo: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12.5px] text-ink-2">Transporter GSTIN / ID (optional)</span>
            <input className="field-input" value={ewb.transporterGstin ?? ''} onChange={(e) => setEwb({ ...ewb, transporterGstin: e.target.value })} />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12.5px] text-ink-2">Transport doc no. (LR/RR)</span>
            <input className="field-input" value={ewb.transDocNo ?? ''} onChange={(e) => setEwb({ ...ewb, transDocNo: e.target.value })} />
          </label>
          <div className="flex items-end gap-2">
            <button type="button" className="btn-primary h-9" disabled={busy} onClick={() => makeEwb.mutate()}>
              Generate e-way bill
            </button>
            <button type="button" className="btn-quiet h-9" onClick={() => setEwbOpen(false)}>
              Close
            </button>
          </div>
          <p className="text-[12.5px] text-ink-3 sm:col-span-3">Distance 0 lets the portal work it out from the PIN codes. Valid one day per 200 km.</p>
        </div>
      )}

      {cancelling && (
        <div className="mt-3 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-[12.5px] text-ink-2">Reason</span>
            <select className="field-input w-48" value={reason} onChange={(e) => setReason(e.target.value)}>
              {CANCEL_REASONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="block min-w-60 flex-1">
            <span className="mb-1 block text-[12.5px] text-ink-2">Remark</span>
            <input className="field-input" maxLength={100} value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="e.g. Wrong rate on line 2" />
          </label>
          <button type="button" className="btn-outline h-9 text-crimson" disabled={busy || remark.trim().length < 3} onClick={() => cancel.mutate()}>
            Cancel {cancelling === 'ewb' ? 'e-way bill' : 'e-invoice'}
          </button>
          <button type="button" className="btn-quiet h-9" onClick={() => setCancelling(null)}>
            Keep it
          </button>
        </div>
      )}

      {error && (
        <p role="alert" className="mt-2 text-crimson">
          {error}
        </p>
      )}
    </section>
  );
}
