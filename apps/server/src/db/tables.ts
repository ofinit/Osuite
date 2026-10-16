// Generates Drizzle tables from model metadata, plus the fixed system tables.
import type { FieldDef, ModelDef } from '@osuite/kernel';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  type PgColumnBuilderBase,
  type PgTableWithColumns,
} from 'drizzle-orm/pg-core';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyTable = PgTableWithColumns<any>;

export const snake = (s: string) => s.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

// ---------------------------------------------------------------- system tables

export const users = pgTable('users', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  login: varchar('login', { length: 120 }).notNull().unique(),
  name: varchar('name', { length: 200 }).notNull(),
  passwordHash: text('password_hash').notNull(),
  isAdmin: boolean('is_admin').notNull().default(false),
  /** What a non-administrator may do; administrators may do everything. */
  roleId: bigint('role_id', { mode: 'number' }).references(() => tableFor('base.role').id, { onDelete: 'restrict' }),
  active: boolean('active').notNull().default(true),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const sessions = pgTable(
  'sessions',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    tokenHash: text('token_hash').notNull().unique(),
    userId: bigint('user_id', { mode: 'number' })
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [index('sessions_user_idx').on(t.userId)],
);

/** Append-only, hash-chained edit log (UPDATE/DELETE blocked by trigger). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    at: ts('at').notNull(),
    userId: bigint('user_id', { mode: 'number' }),
    model: varchar('model', { length: 100 }).notNull(),
    recordId: bigint('record_id', { mode: 'number' }).notNull(),
    action: varchar('action', { length: 20 }).notNull(),
    changes: jsonb('changes').notNull(),
    prevHash: varchar('prev_hash', { length: 64 }).notNull(),
    hash: varchar('hash', { length: 64 }).notNull(),
  },
  (t) => [index('audit_log_record_idx').on(t.model, t.recordId)],
);

/** Gap-free document numbering per code and period (e.g. INV, 26-27). */
export const sequences = pgTable(
  'sequences',
  {
    code: varchar('code', { length: 30 }).notNull(),
    period: varchar('period', { length: 10 }).notNull(),
    lastValue: integer('last_value').notNull(),
  },
  (t) => [primaryKey({ columns: [t.code, t.period] })],
);

export const settings = pgTable('settings', {
  key: varchar('key', { length: 100 }).primaryKey(),
  value: jsonb('value').notNull(),
});

// ---------------------------------------------------------------- model tables

const modelTables = new Map<string, AnyTable>();

export function tableFor(modelName: string): AnyTable {
  const t = modelTables.get(modelName);
  if (!t) throw new Error(`No table for model ${modelName}`);
  return t;
}

function column(name: string, f: FieldDef): PgColumnBuilderBase {
  const col = snake(name);
  let c;
  switch (f.type) {
    case 'char':
    case 'email':
    case 'phone':
      c = varchar(col, { length: f.type === 'char' ? (f.maxLength ?? 255) : 255 });
      if (f.default !== undefined) c = c.default(f.default);
      break;
    case 'text':
      c = text(col);
      break;
    case 'selection':
      c = varchar(col, { length: 50 });
      if (f.default !== undefined) c = c.default(f.default);
      break;
    case 'int':
      c = integer(col);
      if (f.default !== undefined) c = c.default(f.default);
      break;
    case 'decimal':
      c = numeric(col, { precision: f.precision ?? 16, scale: f.scale ?? 2 });
      if (f.default !== undefined) c = c.default(f.default);
      break;
    case 'bool':
      c = boolean(col).notNull().default(f.default ?? false);
      break;
    case 'date':
      c = date(col, { mode: 'string' });
      if (f.default === 'today') c = c.default(sql`current_date`);
      break;
    case 'datetime':
      c = ts(col);
      break;
    case 'many2one':
      c = bigint(col, { mode: 'number' }).references(() => tableFor(f.relation).id, {
        onDelete: f.onDelete ?? 'restrict',
      });
      break;
    case 'lines':
      throw new Error('lines fields have no column');
  }
  return f.required && f.type !== 'bool' ? c.notNull() : c;
}

export function defineModelTable(model: ModelDef): AnyTable {
  const cols: Record<string, PgColumnBuilderBase> = {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    active: boolean('active').notNull().default(true),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    createdBy: bigint('created_by', { mode: 'number' }).references(() => users.id),
    updatedBy: bigint('updated_by', { mode: 'number' }).references(() => users.id),
  };
  for (const [name, f] of Object.entries(model.fields)) if (f.type !== 'lines') cols[name] = column(name, f);

  const table = pgTable(model.table, cols, (t) =>
    [
      ...Object.entries(model.fields).flatMap(([name, f]) => {
        if (f.type === 'lines') return [];
        const idxName = `${model.table}_${snake(name)}_idx`;
        if (f.unique) return [uniqueIndex(idxName).on(t[name]!)];
        if (f.index || f.type === 'many2one') return [index(idxName).on(t[name]!)];
        return [];
      }),
      ...(model.uniqueTogether ?? []).map((combo) => {
        const [first, ...rest] = combo.map((f) => t[f]!);
        return uniqueIndex(`${model.table}_${combo.map(snake).join('_')}_key`).on(first!, ...rest);
      }),
    ],
  ) as AnyTable;
  modelTables.set(model.name, table);
  return table;
}
