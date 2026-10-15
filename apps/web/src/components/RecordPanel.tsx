import { computeGst, isIntraState, isVisible, type ActionDef, type LinesField, type Many2oneValue, type ModelDef, type RecordData } from '@osuite/kernel';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { Archive, ArchiveRestore, BookOpen, Printer, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api.ts';
import { defaults, fillFrom, linesPayload, type Values } from '../lib/document.ts';
import { formatDateTime, formatValue } from '../lib/format.ts';
import { quickActions } from '../lib/quickActions.ts';
import { useMeta, useSession } from '../lib/session.ts';
import { Link, useNavigate } from 'react-router';
import { Field } from './fields.tsx';
import { ApplyCredit } from './ApplyCredit.tsx';
import { EInvoicePanel } from './EInvoicePanel.tsx';
import { BalanceSummary } from './BalanceSummary.tsx';
import { GstSummary } from './GstSummary.tsx';
import { LinesEditor } from './LinesEditor.tsx';

/** Models with a print layout (see views/PrintView.tsx). */
export const PRINTABLE = new Set(['sales.quotation', 'sales.invoice', 'sales.credit_note']);

const idOf = (v: unknown) => (v && typeof v === 'object' ? ((v as Many2oneValue).id ?? null) : (v ?? null));

/** Converts form state to the API payload, sending only what changed. */
function toPayload(model: ModelDef, children: Record<string, ModelDef>, values: Values, original: Values | null): Values {
  const out: Values = {};
  for (const [k, f] of Object.entries(model.fields)) {
    if (f.readonly || !(k in values)) continue;
    if (f.type === 'lines') {
      const child = children[k];
      if (!child) continue;
      const now = linesPayload(f, child, (values[k] as Values[]) ?? []);
      const before = original ? linesPayload(f, child, (original[k] as Values[]) ?? []) : [];
      if (JSON.stringify(now) !== JSON.stringify(before)) out[k] = now;
      continue;
    }
    let v = values[k];
    if (f.type === 'many2one') v = idOf(v);
    if (original) {
      let o = original[k];
      if (f.type === 'many2one') o = idOf(o);
      if ((o ?? '') === (v ?? '') || (f.type === 'decimal' && o != null && v != null && Number(o) === Number(v))) continue;
    } else if (v === '' || v === null) continue;
    out[k] = v;
  }
  return out;
}

export function RecordPanel({
  model,
  id,
  onClose,
  onCreated,
  flash,
  initial,
}: {
  model: ModelDef;
  id: number | 'new';
  onClose: () => void;
  onCreated: (id: number) => void;
  /** Starting values for a new record (menu filters, prefill from another document). */
  initial?: Values;
  /** Message to show on mount, e.g. after a create. */
  flash?: string | null;
}) {
  const { license, company } = useSession();
  const { data: meta } = useMeta();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const isNew = id === 'new';
  const page = model.form.layout === 'page';
  const [tab, setTab] = useState<'details' | 'history'>('details');
  const [values, setValues] = useState<Values>(() => (isNew ? { ...defaults(model), ...initial } : {}));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<{ kind: 'error' | 'ok'; text: string } | null>(flash ? { kind: 'ok', text: flash } : null);
  const formRef = useRef<HTMLFormElement>(null);

  const linesEntries = Object.entries(model.fields).filter((e): e is [string, LinesField] => e[1].type === 'lines');
  const children = useMemo(() => {
    const out: Record<string, ModelDef> = {};
    for (const [k, f] of linesEntries) if (meta?.models[f.model]) out[k] = meta.models[f.model]!;
    return out;
  }, [meta, model]); // eslint-disable-line react-hooks/exhaustive-deps

  const record = useQuery({
    queryKey: ['record', model.name, id],
    queryFn: () => api.read(model.name, id as number),
    enabled: !isNew,
  });
  useEffect(() => {
    if (record.data) setValues(record.data);
  }, [record.data]);

  const original = isNew ? null : (record.data ?? null);
  const payload = useMemo(() => toPayload(model, children, values, original), [model, children, values, original]);
  const dirty = Object.keys(payload).length > 0;
  const stateValue = model.states ? String(values[model.states.field] ?? '') : '';
  const locked = !!model.states && !isNew && !!record.data && !model.states.editable.includes(stateValue);
  const readOnly = !license.writable || (!isNew && !record.data) || locked || !!model.readonly;

  // Live GST preview, computed with the same function the server uses.
  const gst = useMemo(() => {
    if (model.form.summary !== 'gst') return null;
    const intraState = isIntraState(model, values, company?.stateCode);
    const rows = (values.lines as Values[] | undefined) ?? [];
    const result = computeGst(
      rows.map((l) => ({ qty: l.qty as string, unitPrice: l.unitPrice as string, discountPct: l.discountPct as string, gstRate: l.gstRate as string })),
      { intraState },
    );
    const preview = result.lines.map((l) => ({ taxableAmount: l.taxable, taxAmount: l.tax, totalAmount: l.total }));
    return { result, intraState, preview };
  }, [model, values, company]);

  const refresh = (data?: RecordData) => {
    void qc.invalidateQueries({ queryKey: ['list', model.name] });
    void qc.invalidateQueries({ queryKey: ['history', model.name] });
    if (data) qc.setQueryData(['record', model.name, data.id], data);
  };
  const fail = (err: Error) => {
    setErrors(err instanceof ApiError ? err.fieldErrors : {});
    setMessage({ kind: 'error', text: err.message });
  };

  const save = useMutation({
    mutationFn: () => (isNew ? api.create(model.name, payload) : api.update(model.name, id, payload)),
    onSuccess: (data) => {
      setErrors({});
      refresh(data);
      if (!isNew) setMessage({ kind: 'ok', text: 'Changes saved' });
      if (isNew) onCreated(data.id);
    },
    onError: fail,
  });

  const runAction = useMutation({
    mutationFn: (a: ActionDef) => api.action(model.name, id as number, a.name),
    onSuccess: (data) => {
      setErrors({});
      refresh(data);
      setValues(data);
      const f = model.states ? model.fields[model.states.field] : undefined;
      const state = f?.type === 'selection' ? f.options.find(([v]) => v === data[model.states!.field])?.[1] : null;
      setMessage({ kind: 'ok', text: state ? `${model.label} ${state.toLowerCase()}` : 'Done' });
      // A quotation turned into an invoice: carry on in the new draft invoice.
      const inv = data.invoiceId as { id: number } | null | undefined;
      if (model.name === 'sales.quotation' && data.state === 'invoiced' && inv) {
        void qc.invalidateQueries({ queryKey: ['list', 'sales.invoice'] });
        void navigate(`/m/sales.invoice?id=${inv.id}`);
      }
    },
    onError: fail,
  });

  const setActive = useMutation({
    mutationFn: (active: boolean) => api.setActive(model.name, [id as number], active),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['record', model.name, id] });
      refresh();
    },
    onError: fail,
  });

  const remove = useMutation({
    mutationFn: () => api.remove(model.name, id as number),
    onSuccess: () => {
      refresh();
      onClose();
    },
    onError: fail,
  });

  const close = () => {
    if (dirty && !confirm('Discard unsaved changes?')) return;
    onClose();
  };

  const setField = async (name: string, v: unknown) => {
    setValues((prev) => ({ ...prev, [name]: v }));
    if (errors[name]) setErrors(({ [name]: _, ...rest }) => rest);
    const filled = await fillFrom(model.fields[name]!, v as Many2oneValue | null);
    if (Object.keys(filled).length) setValues((prev) => ({ ...prev, ...filled }));
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (dirty && !readOnly && !save.isPending) save.mutate();
      } else if (e.key === 'Escape' && !document.querySelector('[cmdk-dialog]')) {
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Focus the first field when creating.
  useEffect(() => {
    if (isNew) formRef.current?.querySelector<HTMLElement>('input,select,textarea')?.focus();
  }, [isNew]);

  useEffect(() => {
    if (message?.kind !== 'ok') return;
    const t = setTimeout(() => setMessage(null), 2500);
    return () => clearTimeout(t);
  }, [message]);

  // The display name may be a linked record (e.g. stock on hand is named by its product).
  const name = record.data ? formatValue(model.fields[model.recName], record.data[model.recName]) : '';
  const title = isNew ? `New ${model.label.toLowerCase()}` : name ? name : record.data ? `Draft ${model.label.toLowerCase()}` : '…';
  const archived = record.data && !record.data.active;
  const stateField = model.states ? model.fields[model.states.field] : undefined;
  const stateLabel = stateField?.type === 'selection' ? stateField.options.find(([v]) => v === stateValue)?.[1] : undefined;
  const actions = !isNew && record.data && license.writable ? (model.actions ?? []).filter((a) => !a.states || a.states.includes(stateValue)) : [];

  return (
    <aside className={clsx('panel-in relative flex w-full flex-col border-l border-rule bg-sheet', !page && 'lg:w-[min(600px,48vw)]')} aria-label={title}>
      {/* Ledger margin rule */}
      <div aria-hidden className="pointer-events-none absolute inset-y-0 left-7 w-px bg-crimson/45" />

      <header className="flex items-start gap-3 py-4 pr-4 pl-11">
        <div className="min-w-0 flex-1">
          <p className="text-[12.5px] text-ink-3">{model.label}</p>
          <h2 className="truncate text-[19px] font-semibold tracking-tight">{title}</h2>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {stateLabel && !isNew && <StateBadge state={stateValue} label={stateLabel} />}
            {!isNew &&
              Object.entries(model.fields).map(([k, f]) =>
                f.type === 'selection' && f.badge && isVisible(f, values) ? (
                  <StateBadge key={k} state={String(values[k])} label={formatValue(f, values[k])} />
                ) : null,
              )}
            {archived && <span className="rounded bg-amber-soft px-1.5 text-[12px] text-amber">Archived</span>}
          </div>
        </div>
        {!isNew &&
          quickActions(model, record.data).map((a) => (
            <Link key={a.href} className="btn-outline" to={a.href}>
              {a.label}
            </Link>
          ))}
        {!isNew && record.data && (
          <ApplyCredit model={model} record={record.data} onResult={(kind, text) => setMessage({ kind, text })} />
        )}
        {model.name === 'base.contact' && !isNew && record.data && (
          <Link className="btn-outline" to={`/reports/ledger?partner=${record.data.id}`}>
            <BookOpen size={15} /> Statement
          </Link>
        )}
        {PRINTABLE.has(model.name) && !isNew && record.data && (
          <a className="btn-outline" href={`/print/${model.name}/${record.data.id}`} target="_blank" rel="noreferrer">
            <Printer size={15} /> Print
          </a>
        )}
        <button className="btn-quiet px-2" onClick={close} aria-label="Close" title="Close (Esc)">
          <X size={18} />
        </button>
      </header>

      {!isNew && !model.readonly && (
        <div role="tablist" className="flex gap-4 border-b border-rule pl-11 text-[13px]">
          {(['details', 'history'] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={clsx('-mb-px border-b-2 pb-2 capitalize', tab === t ? 'border-accent text-ink' : 'border-transparent text-ink-3 hover:text-ink')}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'history' && !isNew ? (
          <History model={model} id={id as number} />
        ) : record.isError ? (
          <p className="py-10 pl-11 text-crimson">{record.error.message}</p>
        ) : (
          <form
            ref={formRef}
            className={clsx('space-y-6 py-5 pr-5 pl-11', page && 'max-w-6xl')}
            onSubmit={(e) => {
              e.preventDefault();
              if (dirty) save.mutate();
            }}
          >
            {locked && (
              <p className="rounded-[5px] bg-paper px-3 py-2 text-[13px] text-ink-2">
                {stateLabel} {model.labelPlural.toLowerCase()} can’t be edited.
              </p>
            )}
            {!isNew && record.data && (
              <EInvoicePanel
                model={model}
                record={record.data}
                onChanged={(text) => {
                  void api.read(model.name, id as number).then((data) => {
                    refresh(data);
                    setValues(data);
                  });
                  setMessage({ kind: 'ok', text });
                }}
              />
            )}
            {model.form.sections.map((s, i) => {
              const cols = s.columns ?? 2;
              return (
                <fieldset key={i} disabled={readOnly}>
                  {s.title && <legend className="mb-2 text-[13px] font-semibold text-ink">{s.title}</legend>}
                  <div className={clsx('grid gap-x-4 gap-y-3', cols === 1 ? 'grid-cols-1' : cols === 3 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2')}>
                    {s.fields.map((fname) => {
                      const f = model.fields[fname]!;
                      if (!isVisible(f, values)) return null;
                      if (f.type === 'lines') {
                        const child = children[fname];
                        if (!child) return null;
                        return (
                          <div key={fname} className="space-y-5">
                            <LinesEditor
                              name={fname}
                              field={f}
                              child={child}
                              rows={(values[fname] as Values[]) ?? []}
                              onChange={(update) => {
                                setValues((prev) => ({ ...prev, [fname]: update((prev[fname] as Values[]) ?? []) }));
                                setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([k]) => !k.startsWith(`${fname}.`))));
                              }}
                              errors={errors}
                              disabled={readOnly}
                              parent={values}
                              preview={gst?.preview}
                            />
                            {model.form.summary === 'balance' && <BalanceSummary lines={(values[fname] as Values[]) ?? []} />}
                            {gst && (
                              <GstSummary
                                result={gst.result}
                                intraState={gst.intraState}
                                placeOfSupply={values[model.gst?.placeOfSupplyField ?? ''] ?? company?.stateCode}
                              />
                            )}
                          </div>
                        );
                      }
                      return (
                        <Field
                          key={fname}
                          name={fname}
                          field={f}
                          value={values[fname]}
                          error={errors[fname]}
                          asText={locked || !!model.readonly}
                          onChange={(v) => void setField(fname, v)}
                        />
                      );
                    })}
                  </div>
                </fieldset>
              );
            })}
            <button type="submit" hidden />
          </form>
        )}
      </div>

      <footer className="flex flex-wrap items-center gap-2 border-t border-rule py-3 pr-4 pl-11">
        {license.writable && !locked && !model.readonly && (
          <>
            <button className="btn-primary" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>
              {save.isPending ? 'Saving…' : isNew ? 'Create' : 'Save'}
              <span className="kbd border-white/30 bg-transparent text-white/80">Ctrl S</span>
            </button>
            {dirty && !isNew && (
              <button className="btn-quiet" onClick={() => record.data && setValues(record.data)}>
                Discard
              </button>
            )}
          </>
        )}
        {actions.map((a) => (
          <button
            key={a.name}
            className={clsx(a.danger ? 'btn-quiet text-crimson hover:bg-crimson-soft hover:text-crimson' : a.primary && locked ? 'btn-primary' : 'btn-outline')}
            disabled={dirty || runAction.isPending}
            title={dirty ? 'Save your changes first' : undefined}
            onClick={() => (!a.confirm || confirm(a.confirm)) && runAction.mutate(a)}
          >
            {a.label}
          </button>
        ))}
        <span
          role="status"
          className={clsx('min-w-0 flex-1 text-[13px]', message?.kind === 'error' ? 'text-crimson' : 'truncate text-ok')}
        >
          {message?.text}
        </span>
        {!isNew && license.writable && record.data && !model.readonly && (
          <>
            <button
              className="btn-quiet px-2"
              title={archived ? 'Restore' : 'Archive'}
              aria-label={archived ? 'Restore' : 'Archive'}
              onClick={() => setActive.mutate(!!archived)}
            >
              {archived ? <ArchiveRestore size={16} /> : <Archive size={16} />}
            </button>
            {!locked && (
              <button
                className="btn-quiet px-2 hover:text-crimson"
                title="Delete"
                aria-label="Delete"
                onClick={() => confirm(`Delete "${title}"? This cannot be undone.`) && remove.mutate()}
              >
                <Trash2 size={16} />
              </button>
            )}
          </>
        )}
      </footer>
    </aside>
  );
}

const STATE_STYLE: Record<string, string> = {
  draft: 'bg-paper text-ink-2 ring-1 ring-rule-strong',
  posted: 'bg-[color-mix(in_srgb,var(--ok)_14%,transparent)] text-ok',
  cancelled: 'bg-crimson-soft text-crimson',
  sent: 'bg-accent-soft text-accent',
  accepted: 'bg-[color-mix(in_srgb,var(--ok)_14%,transparent)] text-ok',
  declined: 'bg-crimson-soft text-crimson',
  invoiced: 'bg-paper text-ink-2 ring-1 ring-rule-strong',
  active: 'bg-accent-soft text-accent',
  unpaid: 'bg-amber-soft text-amber',
  partial: 'bg-accent-soft text-accent',
  paid: 'bg-[color-mix(in_srgb,var(--ok)_14%,transparent)] text-ok',
};

export function StateBadge({ state, label }: { state: string; label: string }) {
  return <span className={clsx('inline-block rounded px-1.5 text-[12px] font-medium', STATE_STYLE[state] ?? 'bg-paper text-ink-2')}>{label}</span>;
}

const ACTION_LABEL: Record<string, string> = {
  create: 'Created',
  update: 'Edited',
  archive: 'Archived',
  restore: 'Restored',
  delete: 'Deleted',
};

function History({ model, id }: { model: ModelDef; id: number }) {
  const { data, isLoading } = useQuery({ queryKey: ['history', model.name, id], queryFn: () => api.history(model.name, id) });
  if (isLoading) return <p className="py-6 pl-11 text-ink-3">Loading…</p>;
  if (!data?.length) return <p className="py-6 pl-11 text-ink-3">No changes recorded.</p>;
  return (
    <ol className="py-4 pr-5 pl-11">
      {data.map((e) => (
        <li key={e.id} className="border-b border-rule py-3 last:border-0">
          <p className="text-[13px]">
            <span className="font-medium">{ACTION_LABEL[e.action] ?? model.actions?.find((a) => a.name === e.action)?.label ?? e.action}</span>
            <span className="text-ink-3">
              {' '}
              by {e.userName ?? 'system'}, {formatDateTime(e.at)}
            </span>
          </p>
          {e.action !== 'create' && e.action !== 'delete' && Object.keys(e.changes).length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-[13px] text-ink-2">
              {Object.entries(e.changes).map(([k, c]) => {
                const f = model.fields[k];
                const show = (v: unknown) => formatValue(f, v) || '(empty)';
                return (
                  <li key={k}>
                    {f?.label ?? k}: <span className="text-ink-3 line-through">{show(c.from)}</span> → <span className="text-ink">{show(c.to)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </li>
      ))}
    </ol>
  );
}
