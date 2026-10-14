import type { FieldDef, LinesField, Many2oneValue, ModelDef } from '@osuite/kernel';
import { api } from './api.ts';

export type Values = Record<string, unknown>;

/** Field defaults for a new record or line. */
export function defaults(model: ModelDef): Values {
  const v: Values = {};
  for (const [k, f] of Object.entries(model.fields)) {
    if (!('default' in f) || f.default === undefined) continue;
    v[k] = f.default === 'today' ? new Date().toLocaleDateString('en-CA') : f.default;
  }
  return v;
}

/**
 * Values copied from a picked record (many2one `fill`). Returns {} when the
 * field has no fill or the selection was cleared.
 */
export async function fillFrom(field: FieldDef, picked: Many2oneValue | null): Promise<Values> {
  if (field.type !== 'many2one' || !field.fill || !picked) return {};
  const rec = await api.read(field.relation, picked.id);
  const out: Values = {};
  for (const [own, source] of Object.entries(field.fill)) {
    const v = rec[source];
    if (v !== undefined && v !== null && v !== '') out[own] = v;
  }
  return out;
}

const idOf = (v: unknown) => (v && typeof v === 'object' ? ((v as Many2oneValue).id ?? null) : (v ?? null));

/** A row with nothing entered yet; dropped on save instead of failing validation. */
export function isBlankLine(child: ModelDef, row: Values, fresh: Values): boolean {
  return Object.entries(child.fields).every(([k, f]) => {
    if (f.readonly || f.type === 'lines') return true;
    const v = row[k];
    return v === null || v === undefined || v === '' || String(v) === String(fresh[k] ?? '');
  });
}

/** Lines as the API expects them: editable fields, many2one as ids, ids kept. */
export function linesPayload(field: LinesField, child: ModelDef, rows: Values[]): Values[] {
  const fresh = defaults(child);
  return rows
    .filter((r) => !isBlankLine(child, r, fresh))
    .map((r) => {
      const out: Values = typeof r.id === 'number' ? { id: r.id } : {};
      for (const [k, f] of Object.entries(child.fields)) {
        if (f.readonly || f.type === 'lines' || k === field.inverse || !(k in r)) continue;
        out[k] = f.type === 'many2one' ? idOf(r[k]) : r[k] === '' ? null : r[k];
      }
      return out;
    });
}
