import { isVisible, type ModelDef, type RecordData } from '@osuite/kernel';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Plus, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { RecordPanel, StateBadge } from '../components/RecordPanel.tsx';
import { api } from '../lib/api.ts';
import { formatValue, isNumeric } from '../lib/format.ts';
import { filterDefaults, findMenu, urlFilters } from '../lib/menus.ts';
import { useAccess } from '../lib/access.ts';
import { useMeta, useModel } from '../lib/session.ts';

const PAGE = 80;

const typingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));

export function ListView() {
  const { model: modelName } = useParams();
  const model = useModel(modelName);
  const access = useAccess();
  if (!modelName) return null;
  if (!model) return <div className="p-8 text-ink-3">Loading…</div>;
  if (!access.can(model.name, 'view'))
    return <div className="p-8 text-ink-2">Your role does not include {model.labelPlural.toLowerCase()}. Ask an administrator if you need them.</div>;
  return <ModelList key={model.name} model={model} />;
}

function ModelList({ model }: { model: ModelDef }) {
  const access = useAccess();
  const canCreate = access.canChange(model.name);
  const { data: meta } = useMeta();
  const [params, setParams] = useSearchParams();
  const openId = params.get('id');
  // Fixed filters from the menu entry (e.g. payments received) and their title.
  const fixed = urlFilters(params);
  const fixedKey = JSON.stringify(fixed);
  const title = findMenu(meta, model.name, fixed)?.label ?? model.labelPlural;
  const prefill = (() => {
    try {
      return params.get('with') ? (JSON.parse(params.get('with')!) as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  })();
  const sort = params.get('sort') ?? undefined;
  const archived = params.get('archived') === '1';
  const page = Number(params.get('page') ?? 0);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [cursor, setCursor] = useState(0);
  // Survives the panel remount when ?id=new becomes ?id=<created id>.
  const [flash, setFlash] = useState<string | null>(null);
  useEffect(() => {
    setFlash(null);
  }, [openId]);
  const searchRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLTableRowElement | null)[]>([]);

  const update = (patch: Record<string, string | null>) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        for (const [k, v] of Object.entries(patch)) (v === null ? next.delete(k) : next.set(k, v));
        return next;
      },
      { replace: !('id' in patch) },
    );

  // Debounce the search box into the URL.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('q') ?? '') !== q) update({ q: q || null, page: null });
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const query = useQuery({
    queryKey: ['list', model.name, params.get('q') ?? '', sort, archived, page, fixedKey],
    queryFn: () =>
      api.search(model.name, {
        q: params.get('q') ?? undefined,
        sort,
        includeArchived: archived,
        limit: PAGE,
        offset: page * PAGE,
        filters: fixed,
      }),
    placeholderData: keepPreviousData,
  });
  const records = query.data?.records ?? [];
  const total = query.data?.total ?? 0;

  useEffect(() => {
    setCursor(0);
  }, [query.data]);
  useEffect(() => {
    rowRefs.current[cursor]?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typingTarget(e.target)) return;
      if (document.querySelector('[cmdk-dialog]')) return;
      if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key.toLowerCase() === 'n' && canCreate && !model.readonly && !openId) {
        e.preventDefault();
        update({ id: 'new' });
      } else if (!openId && e.key === 'ArrowDown') {
        e.preventDefault();
        setCursor((c) => Math.min(c + 1, records.length - 1));
      } else if (!openId && e.key === 'ArrowUp') {
        e.preventDefault();
        setCursor((c) => Math.max(c - 1, 0));
      } else if (!openId && e.key === 'Enter' && records[cursor]) {
        e.preventDefault();
        update({ id: String(records[cursor].id) });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const toggleSort = (col: string) => {
    const next = sort === col ? `-${col}` : sort === `-${col}` ? null : col;
    update({ sort: next, page: null });
  };

  // Split view: keep the list readable next to the open record.
  const columns = openId ? model.list.columns.slice(0, 4) : model.list.columns;
  const from = total ? page * PAGE + 1 : 0;
  const to = Math.min((page + 1) * PAGE, total);
  const searching = !!params.get('q');

  return (
    <div className="flex h-full">
      <section
        className={clsx('flex min-w-0 flex-1 flex-col', openId && (model.form.layout === 'page' ? 'hidden' : 'max-lg:hidden'))}
      >
        <header className="flex flex-wrap items-center gap-3 px-5 pt-5 pb-3">
          <h1 className="mr-auto text-[22px] font-semibold tracking-tight">
            {title}
            <span className="ml-2 align-middle text-[13px] font-normal text-ink-3">{query.data ? total.toLocaleString('en-IN') : ''}</span>
          </h1>
          <div className="relative w-full sm:w-72">
            <Search size={15} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-3" />
            <input
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setQ('');
                  e.currentTarget.blur();
                } else if (e.key === 'ArrowDown' || e.key === 'Enter') {
                  e.currentTarget.blur();
                }
              }}
              placeholder={`Search ${title.toLowerCase()}`}
              className="field-input pr-8 pl-8"
              aria-label={`Search ${title}`}
            />
            <span className="kbd absolute top-1/2 right-2 -translate-y-1/2">/</span>
          </div>
          {!model.readonly && (
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              <input
                type="checkbox"
                className="accent-[var(--accent)]"
                checked={archived}
                onChange={(e) => update({ archived: e.target.checked ? '1' : null, page: null })}
              />
              Include archived
            </label>
          )}
          {canCreate && !model.readonly && (
            <button className="btn-primary" onClick={() => update({ id: 'new' })}>
              <Plus size={16} /> New <span className="kbd border-white/30 bg-transparent text-white/80">N</span>
            </button>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-auto px-5">
          <table className="w-full border-separate border-spacing-0 text-left">
            <thead className="sticky top-0 z-10 bg-paper">
              <tr>
                {columns.map((c) => {
                  const f = model.fields[c]!;
                  const dir = sort === c ? 'asc' : sort === `-${c}` ? 'desc' : null;
                  return (
                    <th
                      key={c}
                      scope="col"
                      aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}
                      className={clsx('border-b border-rule-strong py-2 pr-4 text-[12.5px] font-medium whitespace-nowrap text-ink-2', isNumeric(f) && 'text-right')}
                    >
                      <button className="inline-flex items-center gap-1 hover:text-ink" onClick={() => toggleSort(c)}>
                        {f.label}
                        {dir === 'asc' && <ArrowUp size={12} />}
                        {dir === 'desc' && <ArrowDown size={12} />}
                      </button>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {records.map((r, i) => (
                <Row
                  key={r.id}
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  model={model}
                  columns={columns}
                  record={r}
                  selected={String(r.id) === openId}
                  cursor={!openId && i === cursor}
                  onOpen={() => update({ id: String(r.id) })}
                />
              ))}
            </tbody>
          </table>

          {query.isSuccess && records.length === 0 && (
            <div className="py-16 text-center">
              <p className="text-[15px] text-ink">
                {searching ? `No ${model.labelPlural.toLowerCase()} match "${params.get('q')}"` : `No ${model.labelPlural.toLowerCase()} yet`}
              </p>
              <p className="mt-1 text-ink-3">
                {searching ? 'Try a shorter search, or include archived records.' : `Add your first ${model.label.toLowerCase()} to get started.`}
              </p>
              {!searching && canCreate && !model.readonly && (
                <button className="btn-primary mt-4" onClick={() => update({ id: 'new' })}>
                  <Plus size={16} /> New {model.label.toLowerCase()}
                </button>
              )}
            </div>
          )}
          {query.isError && <p className="py-10 text-center text-crimson">{query.error.message}</p>}
        </div>

        {total > PAGE && (
          <footer className="flex items-center justify-end gap-2 border-t border-rule px-5 py-2 text-[13px] text-ink-2">
            <span>
              {from.toLocaleString('en-IN')}–{to.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')}
            </span>
            <button className="btn-quiet h-8 px-2" disabled={page === 0} onClick={() => update({ page: page > 1 ? String(page - 1) : null })} aria-label="Previous page">
              <ChevronLeft size={16} />
            </button>
            <button className="btn-quiet h-8 px-2" disabled={to >= total} onClick={() => update({ page: String(page + 1) })} aria-label="Next page">
              <ChevronRight size={16} />
            </button>
          </footer>
        )}
      </section>

      {openId && (
        <RecordPanel
          key={`${model.name}:${openId}`}
          model={model}
          id={openId === 'new' ? 'new' : Number(openId)}
          initial={openId === 'new' ? { ...filterDefaults(model, fixed), ...prefill } : undefined}
          onClose={() => update({ id: null })}
          flash={flash}
          onCreated={(id) => {
            setFlash(`${model.label} created`);
            update({ id: String(id), with: null });
          }}
        />
      )}
    </div>
  );
}

function Row({
  model,
  columns,
  record,
  selected,
  cursor,
  onOpen,
  ref,
}: {
  model: ModelDef;
  columns: string[];
  record: RecordData;
  selected: boolean;
  cursor: boolean;
  onOpen: () => void;
  ref: React.Ref<HTMLTableRowElement>;
}) {
  return (
    <tr
      ref={ref}
      onClick={onOpen}
      className={clsx(
        'cursor-pointer',
        selected ? 'bg-accent-soft' : cursor ? 'bg-sheet shadow-[inset_2px_0_0_var(--accent)]' : 'hover:bg-sheet',
        !record.active && 'text-ink-3',
      )}
    >
      {columns.map((c, i) => {
        const f = model.fields[c];
        return (
          <td
            key={c}
            className={clsx(
              'max-w-72 truncate border-b border-rule py-2 pr-4',
              isNumeric(f) && 'text-right',
              i === 0 && 'font-medium',
            )}
          >
            {!isVisible(f ?? {}, record) ? null : (model.states?.field === c || (f?.type === 'selection' && f.badge)) && f?.type === 'selection' ? (
              <StateBadge state={String(record[c])} label={formatValue(f, record[c])} />
            ) : i === 0 && (record[c] === null || record[c] === undefined) ? (
              <span className="font-normal text-ink-3">{model.states ? 'Draft' : '—'}</span>
            ) : (
              formatValue(f, record[c])
            )}
            {i === 0 && !record.active && <span className="ml-2 text-[12px] font-normal">(archived)</span>}
          </td>
        );
      })}
    </tr>
  );
}
