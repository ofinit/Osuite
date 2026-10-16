import type { ModelDef } from '@osuite/kernel';
import { useQuery } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { FileText, Plus, Search, CornerDownLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { api } from '../lib/api.ts';
import { useAccess } from '../lib/access.ts';
import { flattenMenus, menuHref } from '../lib/menus.ts';
import { creatableModels, useMeta, useSession } from '../lib/session.ts';


function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data: meta } = useMeta();
  const { license } = useSession();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 180);
  // Records people open directly; lines and ledgers are reached through their documents.
  const access = useAccess();
  const models: ModelDef[] = creatableModels(meta).filter((m) => access.can(m.name, 'view'));

  const { data: hits = [], isFetching } = useQuery({
    queryKey: ['palette', term],
    enabled: open && term.length >= 2,
    queryFn: async () => {
      const results = await Promise.all(
        models.map(async (m) => (await api.nameSearch(m.name, term, 5)).map((r) => ({ ...r, model: m }))),
      );
      return results.flat();
    },
  });

  useEffect(() => {
    if (!open) setQ('');
  }, [open]);

  // Filtering is done here, not by cmdk: cmdk's own filter can leave items that
  // mount after the query changed (the async record hits) in a stale hidden state.
  const needle = q.trim().toLowerCase();
  const matches = (...texts: string[]) => !needle || texts.some((t) => t.toLowerCase().includes(needle));
  const goTo = flattenMenus(meta?.menus ?? []).filter((m) => menuHref(m) && matches(m.label));
  const creates = models.filter((m) => access.canChange(m.name) && matches(`new ${m.label}`, `create ${m.label}`));
  const records = term.length >= 2 ? hits : [];

  const go = (path: string) => {
    onOpenChange(false);
    void navigate(path);
  };

  const groupHeading = '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[12px] [&_[cmdk-group-heading]]:text-ink-3';
  const item =
    'flex h-9 cursor-pointer items-center gap-2.5 rounded-[5px] px-3 text-ink-2 data-[selected=true]:bg-accent-soft data-[selected=true]:text-ink';

  return (
    <Command.Dialog
      open={open}
      onOpenChange={onOpenChange}
      label="Command palette"
      shouldFilter={false}
      overlayClassName="fixed inset-0 z-40 bg-ink/25"
      contentClassName="fixed left-1/2 top-[12vh] z-50 w-[min(640px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-lg border border-rule-strong bg-sheet shadow-2xl"
    >
      <div className="flex items-center gap-2 border-b border-rule px-3">
        <Search size={16} className="text-ink-3" />
        <Command.Input
          value={q}
          onValueChange={setQ}
          placeholder="Search records, open a list or create something"
          className="h-12 flex-1 bg-transparent text-[15px] outline-none placeholder:text-ink-3"
        />
        <span className="kbd">Esc</span>
      </div>
      <Command.List className={`max-h-[56vh] overflow-y-auto p-1.5 ${groupHeading}`}>
        <Command.Empty className="px-3 py-6 text-center text-ink-3">
          {q.trim().length < 2
            ? 'Type at least 2 characters to search records'
            : isFetching || q.trim() !== term
              ? 'Searching…'
              : `No matches for "${term}"`}
        </Command.Empty>

        {records.length > 0 && (
          <Command.Group heading="Records">
            {records.map((h) => (
              <Command.Item
                key={`${h.model.name}:${h.id}`}
                value={`${h.display} ${h.model.label} ${h.model.name}:${h.id}`}
                onSelect={() => go(`/m/${h.model.name}?id=${h.id}`)}
                className={item}
              >
                <FileText size={15} />
                <span className="flex-1 truncate text-ink">{h.display}</span>
                <span className="text-[12px] text-ink-3">{h.model.label}</span>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {goTo.length > 0 && (
          <Command.Group heading="Go to">
            {goTo.map((m) => (
              <Command.Item key={m.id} value={`go ${m.label}`} onSelect={() => go(menuHref(m)!)} className={item}>
                <CornerDownLeft size={15} />
                {m.label}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {creates.length > 0 && (
          <Command.Group heading="Create">
            {creates.map((m) => (
              <Command.Item
                key={m.name}
                value={`new create ${m.label}`}
                onSelect={() => go(`/m/${m.name}?id=new`)}
                className={item}
              >
                <Plus size={15} />
                New {m.label.toLowerCase()}
              </Command.Item>
            ))}
          </Command.Group>
        )}
      </Command.List>
    </Command.Dialog>
  );
}
