// Posting stock movements: updates stock on hand (weighted average) and
// appends to the immutable stock ledger, all inside the caller's transaction.
import { applyMove, localToday, money } from '@osuite/kernel';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { Tx } from '../../db/client.ts';
import { tableFor } from '../../db/tables.ts';
import { getCompany } from '../../services/company.ts';
import { RecordError } from '../../services/errors.ts';
import type { Values } from '../../services/hooks.ts';

export type MoveKind = 'purchase' | 'sale' | 'opening' | 'adjustment' | 'return' | 'reversal';

export interface MoveInput {
  productId: number;
  warehouseId: number;
  /** Signed quantity: positive adds stock. */
  qty: string;
  /** Cost for incoming stock; outgoing uses the average unless `atCost`. */
  unitCost?: string;
  atCost?: boolean;
  kind: MoveKind;
}

export interface MoveSource {
  date: string;
  reference: string;
  refModel: string;
  refId: number;
}

export async function defaultWarehouseId(tx: Tx): Promise<number> {
  const w = tableFor('stock.warehouse');
  const [row] = await tx.select({ id: w.id }).from(w).where(eq(w.active, true)).orderBy(asc(w.id)).limit(1);
  if (!row) throw new RecordError(422, 'Create a warehouse first (Inventory → Warehouses).');
  return row.id as number;
}

/** Product ids among `ids` that are stock-tracked goods. */
export async function goodsProductIds(tx: Tx, ids: number[]): Promise<Set<number>> {
  if (!ids.length) return new Set();
  const p = tableFor('base.product');
  const rows = await tx
    .select({ id: p.id })
    .from(p)
    .where(and(inArray(p.id, ids), eq(p.kind, 'goods')));
  return new Set(rows.map((r) => r.id as number));
}

async function names(tx: Tx, model: string, ids: number[]): Promise<Map<number, string>> {
  const t = tableFor(model);
  const rows = await tx.select({ id: t.id, name: t.name }).from(t).where(inArray(t.id, ids));
  return new Map(rows.map((r) => [r.id as number, String(r.name)]));
}

/**
 * Applies movements in order. Unless the company allows negative stock,
 * fails (and rolls back) when any product would go below zero, listing every
 * shortage at once.
 */
/** Inserted ledger ids, and the signed total value moved (for the journal). */
export interface PostedMoves {
  ids: number[];
  value: string;
}

export async function postMoves(tx: Tx, source: MoveSource, moves: MoveInput[]): Promise<PostedMoves> {
  const real = moves.filter((m) => Number(m.qty) !== 0);
  if (!real.length) return { ids: [], value: '0.00' };
  const quants = tableFor('stock.quant');
  const ledger = tableFor('stock.move');
  const allowNegative = !!(await getCompany(tx))?.allowNegativeStock;

  // Make sure every position exists, then lock them in a stable order.
  const keys = [...new Map(real.map((m) => [`${m.productId}:${m.warehouseId}`, m])).values()];
  await tx
    .insert(quants)
    .values(keys.map((m) => ({ productId: m.productId, warehouseId: m.warehouseId })))
    .onConflictDoNothing();
  const locked = await tx
    .select()
    .from(quants)
    .where(sql`(${quants.productId}, ${quants.warehouseId}) in (${sql.join(keys.map((m) => sql`(${m.productId}, ${m.warehouseId})`), sql`, `)})`)
    .orderBy(asc(quants.id))
    .for('update');
  const byKey = new Map(locked.map((q) => [`${String(q.productId)}:${String(q.warehouseId)}`, q as Values]));

  const shortages: { productId: number; warehouseId: number; need: number; have: number }[] = [];
  const rows: Values[] = [];
  for (const m of real) {
    const q = byKey.get(`${m.productId}:${m.warehouseId}`)!;
    const before = { qty: String(q.qty), value: String(q.value), avgCost: String(q.avgCost) };
    const r = applyMove(before, m.qty, m.unitCost, { atCost: m.atCost });
    if (Number(m.qty) < 0 && Number(r.position.qty) < 0 && !allowNegative) {
      shortages.push({ productId: m.productId, warehouseId: m.warehouseId, need: -Number(m.qty), have: Number(before.qty) });
    }
    Object.assign(q, r.position);
    rows.push({ ...source, ...m, unitCost: r.unitCost, value: r.moveValue, balanceQty: r.position.qty });
  }

  if (shortages.length) {
    const products = await names(tx, 'base.product', shortages.map((s) => s.productId));
    const warehouses = await names(tx, 'stock.warehouse', shortages.map((s) => s.warehouseId));
    const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
    const detail = shortages
      .map((s) => `${products.get(s.productId)}: need ${fmt(s.need)}, have ${fmt(s.have)} in ${warehouses.get(s.warehouseId)}`)
      .join('; ');
    throw new RecordError(409, `Not enough stock. ${detail}.`);
  }

  for (const q of byKey.values()) {
    await tx.update(quants).set({ qty: q.qty, value: q.value, avgCost: q.avgCost, updatedAt: new Date().toISOString() }).where(eq(quants.id, q.id as number));
  }
  const inserted = await tx
    .insert(ledger)
    .values(rows.map(({ atCost: _, ...r }) => r))
    .returning({ id: ledger.id });
  return { ids: inserted.map((r) => r.id as number), value: money.add(...rows.map((r) => r.value as string)) };
}

/** Reverses every not-yet-reversed movement of a document, at original cost. */
export async function reverseMoves(tx: Tx, source: MoveSource): Promise<PostedMoves> {
  const ledger = tableFor('stock.move');
  const originals = await tx
    .select()
    .from(ledger)
    .where(and(eq(ledger.refModel, source.refModel), eq(ledger.refId, source.refId), ne(ledger.kind, 'reversal'), isNull(ledger.reversedById)))
    .orderBy(asc(ledger.id));
  if (!originals.length) return { ids: [], value: '0.00' };
  const reversal = await postMoves(
    tx,
    // Dated today, like journal reversals.
    { ...source, date: localToday(), reference: `Cancel ${source.reference}` },
    originals.map((o) => ({
      productId: o.productId as number,
      warehouseId: o.warehouseId as number,
      qty: String(-Number(o.qty)),
      unitCost: String(o.unitCost),
      atCost: true,
      kind: 'reversal' as const,
    })),
  );
  // Link each original to its reversal so it is never reversed twice.
  for (const [i, o] of originals.entries()) {
    await tx.update(ledger).set({ reversedById: reversal.ids[i] }).where(eq(ledger.id, o.id as number));
  }
  return reversal;
}
