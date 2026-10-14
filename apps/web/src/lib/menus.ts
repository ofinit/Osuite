import type { MenuItem, Metadata, ModelDef } from '@osuite/kernel';

/** Fixed list filters carried in the URL as f.<field>=value. */
export function urlFilters(params: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of params) if (k.startsWith('f.')) out[k.slice(2)] = v;
  return out;
}

export function menuHref(item: MenuItem): string | null {
  if (item.path) return item.path;
  if (!item.model) return null;
  const qs = Object.entries(item.filter ?? {})
    .map(([k, v]) => `f.${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return `/m/${item.model}${qs ? `?${qs}` : ''}`;
}

export function flattenMenus(items: MenuItem[]): MenuItem[] {
  return items.flatMap((i) => (i.children ? flattenMenus(i.children) : [i]));
}

/** The menu entry for a model list with these fixed filters (for its title). */
export function findMenu(meta: Metadata | undefined, model: string, filters: Record<string, string>): MenuItem | undefined {
  return flattenMenus(meta?.menus ?? []).find(
    (m) =>
      m.model === model &&
      Object.keys(m.filter ?? {}).length === Object.keys(filters).length &&
      Object.entries(m.filter ?? {}).every(([k, v]) => filters[k] === String(v)),
  );
}

/** URL filter strings as typed field values for a new record. */
export function filterDefaults(model: ModelDef, filters: Record<string, string>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(filters).map(([k, v]) => {
      const f = model.fields[k];
      if (f?.type === 'bool') return [k, v === 'true'];
      if (f?.type === 'int' || f?.type === 'many2one') return [k, Number(v)];
      return [k, v];
    }),
  );
}
