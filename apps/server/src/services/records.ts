// Generic, metadata-driven CRUD used by every model, including documents with
// child lines (saved as a set), computed fields, state locking and actions.
import {
  flattenErrors,
  inputSchema,
  type FieldErrors,
  type LinesField,
  type Many2oneValue,
  type ModelDef,
  type RecordData,
  type SearchParams,
  type SearchResult,
} from '@osuite/kernel';
import { pgError } from '@osuite/server-kit';
import { and, asc, count, desc, eq, ilike, inArray, isNull, notInArray, or, sql, type SQL } from 'drizzle-orm';
import type { Db, Tx } from '../db/client.ts';
import { snake, type AnyTable } from '../db/tables.ts';
import { getModel, hooks, ownedBy, tables } from '../registry.ts';
import { toIso } from '../util/time.ts';
import { appendAudit, recordHistory, type Changes } from './audit.ts';
import { RecordError } from './errors.ts';
import type { Values } from './hooks.ts';

export { RecordError };

type Row = Record<string, unknown>;
const MAX_LIMIT = 500;
const MAX_LINES = 1000;
const SORTABLE_SYSTEM = new Set(['id', 'createdAt', 'updatedAt']);
/** Columns managed by the service, never taken from input or copied between rows. */
const SYSTEM_KEYS = new Set(['id', 'active', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy']);

function resolve(name: string): { model: ModelDef; table: AnyTable } {
  const model = getModel(name);
  const table = tables.get(name);
  if (!model || !table) throw new RecordError(404, `Unknown model "${name}"`);
  return { model, table };
}

/** Record name, or e.g. "Invoice #12" while the name is still empty (drafts). */
const displayOf = (model: ModelDef, r: { id: unknown; display: unknown }) =>
  r.display === null || r.display === undefined || r.display === '' ? `${model.label} #${String(r.id)}` : String(r.display);

/** Lines are only written through their parent; ledgers only by server logic. */
function assertNotOwned(model: ModelDef) {
  const parent = ownedBy.get(model.name);
  if (parent) throw new RecordError(403, `${model.labelPlural} are edited through their ${parent.label.toLowerCase()}.`);
  if (model.readonly) throw new RecordError(403, `${model.labelPlural} are maintained automatically and can't be edited.`);
}

/**
 * Quick-search condition. Text fields match directly; many2one fields match
 * the linked record's text fields (one level), e.g. invoices by customer name.
 */
function searchCond(model: ModelDef, table: AnyTable, q: string): SQL | undefined {
  const pattern = `%${escapeLike(q)}%`;
  return or(
    ...model.searchFields.map((f) => {
      const field = model.fields[f];
      if (field?.type !== 'many2one') return ilike(table[f], pattern);
      const { model: target, table: tt } = resolve(field.relation);
      const textFields = target.searchFields.filter((tf) => target.fields[tf]?.type !== 'many2one');
      return sql`${table[f]} in (select ${tt.id} from ${tt} where ${or(...textFields.map((tf) => ilike(tt[tf], pattern)))})`;
    }),
  );
}

const linesFields = (model: ModelDef) =>
  Object.entries(model.fields).filter((e): e is [string, LinesField] => e[1].type === 'lines');

/** Fields the server derives (readonly, stored). */
const computedFields = (model: ModelDef) =>
  Object.entries(model.fields)
    .filter(([, f]) => f.readonly && f.type !== 'lines')
    .map(([k]) => k);

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function orderBy(model: ModelDef, table: AnyTable, sort?: string): SQL[] {
  const spec = sort ?? model.order?.replace(/\s+asc$/i, '').replace(/^(\w+)\s+desc$/i, '-$1') ?? 'id';
  const out: SQL[] = [];
  for (const part of spec.split(',')) {
    const descending = part.startsWith('-');
    const key = descending ? part.slice(1) : part;
    const f = model.fields[key];
    if ((!f || f.type === 'lines') && !SORTABLE_SYSTEM.has(key)) throw new RecordError(400, `Cannot sort by "${key}"`);
    out.push(descending ? desc(table[key]) : asc(table[key]));
  }
  out.push(asc(table.id)); // stable pagination
  return out;
}

/** Exact-match filters on stored fields (values arrive as query-string scalars). */
function filterConds(model: ModelDef, table: AnyTable, filters: SearchParams['filters']): SQL[] {
  return Object.entries(filters ?? {}).map(([key, value]) => {
    const f = model.fields[key];
    if ((!f || f.type === 'lines') && key !== 'active') throw new RecordError(400, `Cannot filter on "${key}"`);
    return value === null ? isNull(table[key]) : eq(table[key], value);
  });
}

/** Replaces many2one ids with { id, display } and normalises timestamps. */
async function expand(tx: Tx, model: ModelDef, rows: Row[]): Promise<RecordData[]> {
  for (const [name, field] of Object.entries(model.fields)) {
    if (field.type !== 'many2one') continue;
    const ids = [...new Set(rows.map((r) => r[name]).filter((v): v is number => typeof v === 'number'))];
    if (!ids.length) continue;
    const { model: target, table } = resolve(field.relation);
    const found = await tx
      .select({ id: table.id, display: table[target.recName] })
      .from(table)
      .where(inArray(table.id, ids));
    const byId = new Map(found.map((f) => [f.id as number, { id: f.id as number, display: displayOf(target, f) }]));
    for (const r of rows) {
      const id = r[name];
      r[name] = typeof id === 'number' ? (byId.get(id) ?? { id, display: `#${id}` }) : null;
    }
  }
  for (const r of rows) {
    r.createdAt = toIso(r.createdAt);
    r.updatedAt = toIso(r.updatedAt);
  }
  return rows as RecordData[];
}

function diff(before: Row, after: Row, model: ModelDef): Changes {
  const changes: Changes = {};
  for (const [key, f] of [...Object.entries(model.fields), ['active', null] as const]) {
    if (f?.type === 'lines') continue;
    const a = before[key] ?? null;
    const b = after[key] ?? null;
    if (String(a) !== String(b)) changes[key] = { from: a, to: b };
  }
  return changes;
}

/** Turns Postgres constraint violations into user-facing errors. */
function mapDbError(err: unknown, model: ModelDef, onDelete = false): never {
  const e = pgError(err);
  if (e.code === '23505') {
    const field = Object.keys(model.fields).find((f) => e.constraint === `${model.table}_${snake(f)}_idx`);
    const label = field ? model.fields[field]!.label : 'Value';
    throw new RecordError(409, `${label} must be unique`, field ? { [field]: `This ${label} is already in use` } : undefined);
  }
  if (e.code === '23503') {
    if (onDelete) throw new RecordError(409, 'This record is used elsewhere. Archive it instead.');
    throw new RecordError(422, 'A linked record does not exist');
  }
  throw err;
}

function validate(model: ModelDef, mode: 'create' | 'update', input: Row, existing?: Row, errorPrefix = ''): Row {
  const values = { ...input };
  const h = hooks.get(model.name);
  h?.normalize?.(values);
  const parsed = inputSchema(model, mode).safeParse(values);
  const prefix = (errs: FieldErrors) => Object.fromEntries(Object.entries(errs).map(([k, v]) => [`${errorPrefix}${k}`, v]));
  if (!parsed.success) throw new RecordError(422, 'Please fix the highlighted fields', prefix(flattenErrors(parsed.error)));
  const data = parsed.data as Row;
  const errors = h?.validate?.(data, existing);
  if (errors && Object.keys(errors).length) throw new RecordError(422, 'Please fix the highlighted fields', prefix(errors));
  return data;
}

/** Throws if the record's workflow state does not allow edits. */
function assertEditable(model: ModelDef, row: Row, verb = 'edited') {
  if (!model.states) return;
  const state = row[model.states.field];
  if (model.states.editable.includes(String(state))) return;
  const f = model.fields[model.states.field];
  const label = f?.type === 'selection' ? (f.options.find(([v]) => v === state)?.[1] ?? String(state)) : String(state);
  throw new RecordError(409, `${label} ${model.labelPlural.toLowerCase()} can't be ${verb}.`);
}

async function loadLines(tx: Tx, model: ModelDef, parentId: number): Promise<Record<string, Row[]>> {
  const out: Record<string, Row[]> = {};
  for (const [name, f] of linesFields(model)) {
    const { model: child, table } = resolve(f.model);
    out[name] = await tx.select().from(table).where(eq(table[f.inverse], parentId)).orderBy(...orderBy(child, table));
  }
  return out;
}

/** Canonical form of the user-editable part of lines, to detect real changes. */
function linesSignature(child: ModelDef, rows: Row[]): string {
  const keys = Object.entries(child.fields)
    .filter(([, f]) => !f.readonly)
    .map(([k]) => k);
  return JSON.stringify(rows.map((r) => keys.map((k) => String(r[k] ?? ''))));
}

export function createRecordService(db: Db) {
  /** Shared by create and update: validates, computes and writes parent + lines. */
  async function save(
    tx: Tx,
    model: ModelDef,
    table: AnyTable,
    id: number | null,
    input: unknown,
    userId: number,
  ): Promise<Row> {
    const raw = input && typeof input === 'object' ? { ...(input as Row) } : {};
    const linesInput: Record<string, unknown> = {};
    for (const [name] of linesFields(model)) {
      if (name in raw) linesInput[name] = raw[name];
      delete raw[name];
    }

    let before: Row | undefined;
    if (id !== null) {
      [before] = await tx.select().from(table).where(eq(table.id, id)).for('update');
      if (!before) throw new RecordError(404, `${model.label} not found`);
      assertEditable(model, before);
    }
    const data = validate(model, id === null ? 'create' : 'update', raw, before);

    // Lines: validated per row against the child model.
    const existingLines = id === null ? {} : await loadLines(tx, model, id);
    const lines: Record<string, Values[]> = {};
    const provided = new Set<string>();
    for (const [name, f] of linesFields(model)) {
      const { model: child } = resolve(f.model);
      if (!(name in linesInput)) {
        lines[name] = (existingLines[name] ?? []).map((r) => ({ ...r }));
        continue;
      }
      const rows = linesInput[name];
      if (!Array.isArray(rows)) throw new RecordError(422, `${f.label} must be a list`);
      if (rows.length > MAX_LINES) throw new RecordError(422, `At most ${MAX_LINES} lines`);
      const ownIds = new Set((existingLines[name] ?? []).map((r) => r.id as number));
      provided.add(name);
      lines[name] = rows.map((r, i) => {
        const row = (r && typeof r === 'object' ? r : {}) as Row;
        const lineId = typeof row.id === 'number' && ownIds.has(row.id) ? row.id : undefined;
        const fields = Object.fromEntries(Object.entries(row).filter(([k]) => !SYSTEM_KEYS.has(k) && k !== f.inverse));
        return { ...validate(child, 'create', fields, undefined, `${name}.${i}.`), ...(lineId ? { id: lineId } : {}) };
      });
    }

    // Derived fields.
    const record: Values = { ...(before ?? {}), ...data };
    const merged = { ...record };
    await hooks.get(model.name)?.compute?.({ tx, userId }, record, lines);
    // Persist derived fields, plus any editable field the hook filled in (e.g. a default).
    for (const [k, f] of Object.entries(model.fields)) {
      if (f.type === 'lines' || !(k in record)) continue;
      if (f.readonly ? !before || record[k] !== before[k] : record[k] !== merged[k]) data[k] = record[k];
    }

    const now = new Date().toISOString();
    let row: Row;
    if (id === null) {
      [row] = (await tx.insert(table).values({ ...data, createdBy: userId, updatedBy: userId }).returning()) as [Row];
    } else if (Object.keys(data).length || provided.size) {
      [row] = (await tx
        .update(table)
        .set({ ...data, updatedAt: now, updatedBy: userId })
        .where(eq(table.id, id))
        .returning()) as [Row];
    } else {
      row = before!;
    }
    const parentId = row.id as number;

    const changes = diff(before ?? {}, row, model);
    for (const [name, f] of linesFields(model)) {
      const { model: child, table: childTable } = resolve(f.model);
      const childComputed = computedFields(child);
      const rows = lines[name] ?? [];
      if (provided.has(name)) {
        const keep = rows.map((r) => r.id).filter((v): v is number => typeof v === 'number');
        await tx
          .delete(childTable)
          .where(and(eq(childTable[f.inverse], parentId), keep.length ? notInArray(childTable.id, keep) : undefined));
        for (const [i, r] of rows.entries()) {
          const { id: lineId, ...values } = r;
          const set = { ...values, ...('sequence' in child.fields ? { sequence: i + 1 } : {}) };
          if (typeof lineId === 'number') {
            await tx.update(childTable).set({ ...set, updatedAt: now, updatedBy: userId }).where(eq(childTable.id, lineId));
          } else {
            await tx.insert(childTable).values({ ...set, [f.inverse]: parentId, createdBy: userId, updatedBy: userId });
          }
        }
        const beforeSig = linesSignature(child, existingLines[name] ?? []);
        if (beforeSig !== linesSignature(child, rows)) {
          const n = (existingLines[name] ?? []).length;
          changes[name] = { from: `${n} line${n === 1 ? '' : 's'}`, to: `${rows.length} line${rows.length === 1 ? '' : 's'}` };
        }
      } else if (childComputed.length) {
        // Parent changes (e.g. place of supply) can change derived line values.
        for (const r of rows) {
          const orig = existingLines[name]?.find((o) => o.id === r.id);
          const set = Object.fromEntries(childComputed.filter((k) => orig && orig[k] !== r[k]).map((k) => [k, r[k]]));
          if (Object.keys(set).length) await tx.update(childTable).set(set).where(eq(childTable.id, r.id as number));
        }
      }
    }

    if (id === null) {
      await appendAudit(tx, { userId, model: model.name, recordId: parentId, action: 'create', changes });
    } else if (Object.keys(changes).length) {
      await appendAudit(tx, { userId, model: model.name, recordId: parentId, action: 'update', changes });
    }
    return row;
  }

  async function readFull(tx: Tx, name: string, id: number): Promise<RecordData> {
    const { model, table } = resolve(name);
    const rows = await tx.select().from(table).where(eq(table.id, id));
    if (!rows.length) throw new RecordError(404, `${model.label} not found`);
    const [rec] = await expand(tx, model, rows);
    for (const [fieldName, f] of linesFields(model)) {
      const { model: child } = resolve(f.model);
      const children = (await loadLines(tx, model, id))[fieldName] ?? [];
      (rec as Row)[fieldName] = await expand(tx, child, children);
    }
    return rec!;
  }

  const guard = async <T>(model: ModelDef, fn: () => Promise<T>, onDelete = false): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof RecordError) throw err;
      mapDbError(err, model, onDelete);
    }
  };

  return {
    async search(name: string, p: SearchParams): Promise<SearchResult> {
      const { model, table } = resolve(name);
      const conds: (SQL | undefined)[] = [];
      if (!p.includeArchived) conds.push(eq(table.active, true));
      const q = p.q?.trim();
      if (q) conds.push(searchCond(model, table, q));
      conds.push(...filterConds(model, table, p.filters));
      const where = and(...conds);
      const limit = Math.min(Math.max(p.limit ?? 80, 1), MAX_LIMIT);
      const [rows, [total]] = await Promise.all([
        db
          .select()
          .from(table)
          .where(where)
          .orderBy(...orderBy(model, table, p.sort))
          .limit(limit)
          .offset(Math.max(p.offset ?? 0, 0)),
        db.select({ n: count() }).from(table).where(where),
      ]);
      return { records: await expand(db, model, rows), total: total?.n ?? 0 };
    },

    async nameSearch(name: string, q: string, limit = 8, filters?: SearchParams['filters']): Promise<Many2oneValue[]> {
      const { model, table } = resolve(name);
      const rows = await db
        .select({ id: table.id, display: table[model.recName] })
        .from(table)
        .where(
          and(
            eq(table.active, true),
            q.trim() ? searchCond(model, table, q.trim()) : undefined,
            ...filterConds(model, table, filters),
          ),
        )
        .orderBy(asc(table[model.recName]))
        .limit(Math.min(limit, 50));
      return rows.map((r) => ({ id: r.id as number, display: displayOf(model, r) }));
    },

    read: (name: string, id: number) => readFull(db, name, id),

    async create(name: string, input: unknown, userId: number): Promise<RecordData> {
      const { model, table } = resolve(name);
      assertNotOwned(model);
      return guard(model, () =>
        db.transaction(async (tx) => readFull(tx, name, (await save(tx, model, table, null, input, userId)).id as number)),
      );
    },

    async update(name: string, id: number, input: unknown, userId: number): Promise<RecordData> {
      const { model, table } = resolve(name);
      assertNotOwned(model);
      return guard(model, () =>
        db.transaction(async (tx) => {
          await save(tx, model, table, id, input, userId);
          return readFull(tx, name, id);
        }),
      );
    },

    /** Runs a workflow action (ModelDef.actions + hooks.actions) atomically. */
    async action(name: string, id: number, actionName: string, userId: number): Promise<RecordData> {
      const { model, table } = resolve(name);
      const def = model.actions?.find((a) => a.name === actionName);
      const fn = hooks.get(name)?.actions?.[actionName];
      if (!def || !fn) throw new RecordError(404, `Unknown action "${actionName}"`);
      return guard(model, () =>
        db.transaction(async (tx) => {
          const [before] = await tx.select().from(table).where(eq(table.id, id)).for('update');
          if (!before) throw new RecordError(404, `${model.label} not found`);
          if (def.states && model.states && !def.states.includes(String(before[model.states.field])))
            throw new RecordError(409, `"${def.label}" is not available in this state`);
          const lines = await loadLines(tx, model, id);
          // `$open` names a document the action created, for the client to open next.
          const { $open, ...patch } = (await fn({ tx, userId }, { ...before }, lines)) ?? {};
          const [after] = Object.keys(patch).length
            ? ((await tx
                .update(table)
                .set({ ...patch, updatedAt: new Date().toISOString(), updatedBy: userId })
                .where(eq(table.id, id))
                .returning()) as [Row])
            : [before];
          await appendAudit(tx, { userId, model: name, recordId: id, action: actionName, changes: diff(before, after, model) });
          const rec = await readFull(tx, name, id);
          return $open ? { ...rec, $open } : rec;
        }),
      );
    },

    async setActive(name: string, ids: number[], active: boolean, userId: number): Promise<number> {
      const { model, table } = resolve(name);
      assertNotOwned(model);
      if (!ids.length) return 0;
      return db.transaction(async (tx) => {
        const changed = await tx
          .update(table)
          .set({ active, updatedAt: new Date().toISOString(), updatedBy: userId })
          .where(and(inArray(table.id, ids), eq(table.active, !active)))
          .returning({ id: table.id });
        for (const r of changed) {
          await appendAudit(tx, {
            userId,
            model: model.name,
            recordId: r.id as number,
            action: active ? 'restore' : 'archive',
            changes: { active: { from: !active, to: active } },
          });
        }
        return changed.length;
      });
    },

    async remove(name: string, id: number, userId: number): Promise<void> {
      const { model, table } = resolve(name);
      assertNotOwned(model);
      await guard(
        model,
        () =>
          db.transaction(async (tx) => {
            const [existing] = await tx.select().from(table).where(eq(table.id, id)).for('update');
            if (!existing) throw new RecordError(404, `${model.label} not found`);
            assertEditable(model, existing, 'deleted');
            await hooks.get(model.name)?.beforeRemove?.({ tx, userId }, existing);
            const [deleted] = await tx.delete(table).where(eq(table.id, id)).returning();
            await appendAudit(tx, { userId, model: name, recordId: id, action: 'delete', changes: diff(deleted!, {}, model) });
          }),
        true,
      );
    },

    async history(name: string, id: number) {
      resolve(name);
      return recordHistory(db, name, id);
    },
  };
}

export type RecordService = ReturnType<typeof createRecordService>;
