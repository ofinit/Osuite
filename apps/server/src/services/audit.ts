// Hash-chained edit log. Each entry commits to the previous one, so any
// out-of-band tampering (even by a DB superuser) breaks verification.
import { createHash } from 'node:crypto';
import type { AuditEntry } from '@osuite/kernel';
import { asc, desc, eq, and, sql } from 'drizzle-orm';
import type { Tx } from '../db/client.ts';
import { auditLog, users } from '../db/tables.ts';
import { toIso } from '../util/time.ts';

const GENESIS = '0'.repeat(64);
const AUDIT_LOCK_KEY = 7_406_001;

type Action = AuditEntry['action'];
export type Changes = Record<string, { from: unknown; to: unknown }>;

/** JSON with recursively sorted keys; jsonb does not preserve key order. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function entryHash(e: {
  prevHash: string;
  at: string;
  userId: number | null;
  model: string;
  recordId: number;
  action: string;
  changes: unknown;
}): string {
  const at = toIso(e.at);
  return createHash('sha256')
    .update(canonical([e.prevHash, at, e.userId, e.model, e.recordId, e.action, e.changes]))
    .digest('hex');
}

export async function appendAudit(
  tx: Tx,
  e: { userId: number | null; model: string; recordId: number; action: Action; changes: Changes },
) {
  // Serialise writers so the chain stays linear.
  await tx.execute(sql`select pg_advisory_xact_lock(${AUDIT_LOCK_KEY})`);
  const [last] = await tx.select({ hash: auditLog.hash }).from(auditLog).orderBy(desc(auditLog.id)).limit(1);
  const entry = { ...e, at: new Date().toISOString(), prevHash: last?.hash ?? GENESIS };
  await tx.insert(auditLog).values({ ...entry, hash: entryHash(entry) });
}

export async function recordHistory(tx: Tx, model: string, recordId: number): Promise<AuditEntry[]> {
  const rows = await tx
    .select({
      id: auditLog.id,
      at: auditLog.at,
      userName: users.name,
      action: auditLog.action,
      changes: auditLog.changes,
    })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.userId))
    .where(and(eq(auditLog.model, model), eq(auditLog.recordId, recordId)))
    .orderBy(desc(auditLog.id));
  return rows.map((r) => ({ ...r, at: toIso(r.at) as string, action: r.action as Action, changes: r.changes as Changes }));
}

/** Walks the whole chain; returns the first broken entry id, if any. */
export async function verifyAuditChain(tx: Tx): Promise<{ ok: boolean; entries: number; brokenAt?: number }> {
  let prev = GENESIS;
  let count = 0;
  const batch = 1000;
  for (let lastId = 0; ; ) {
    const rows = await tx
      .select()
      .from(auditLog)
      .where(sql`${auditLog.id} > ${lastId}`)
      .orderBy(asc(auditLog.id))
      .limit(batch);
    for (const r of rows) {
      if (r.prevHash !== prev || entryHash(r) !== r.hash) return { ok: false, entries: count, brokenAt: r.id };
      prev = r.hash;
      count++;
    }
    if (rows.length < batch) return { ok: true, entries: count };
    lastId = rows[rows.length - 1]!.id;
  }
}
