// Shared by sales and purchase orders: an order is fulfilled by stock
// documents (delivery challans, goods receipts) and billed by GST documents
// (invoices, bills). This counts both against each order line.
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Tx } from '../db/client.ts';
import { tableFor } from '../db/tables.ts';
import { appendAudit } from '../services/audit.ts';
import type { HookCtx, ModelHooks, Values } from '../services/hooks.ts';
import { goodsProductIds } from './stock/service.ts';

/** The models of one side of the flow. */
export interface OrderFlow {
  order: string;
  orderLine: string;
  /** The stock document (challan / receipt), its line model and the line's many2one to it. */
  ship: string;
  shipLine: string;
  shipInverse: string;
  /** The GST document (invoice / bill), its line model and the line's many2one to it. */
  bill: string;
  billLine: string;
  billInverse: string;
}

export const SALES_FLOW: OrderFlow = {
  order: 'sales.order',
  orderLine: 'sales.order_line',
  ship: 'sales.delivery',
  shipLine: 'sales.delivery_line',
  shipInverse: 'deliveryId',
  bill: 'sales.invoice',
  billLine: 'sales.invoice_line',
  billInverse: 'invoiceId',
};

export const PURCHASE_FLOW: OrderFlow = {
  order: 'purchase.order',
  orderLine: 'purchase.order_line',
  ship: 'purchase.receipt',
  shipLine: 'purchase.receipt_line',
  shipInverse: 'receiptId',
  bill: 'purchase.bill',
  billLine: 'purchase.bill_line',
  billInverse: 'billId',
};

/** Line fields copied from one document to the next; amounts are recomputed. */
export const ITEM_FIELDS = ['productId', 'description', 'hsnCode', 'uom', 'unitPrice', 'discountPct', 'gstRate'];

/** Quantities carry three decimals; compare them in thousandths to avoid float noise. */
export const milli = (v: unknown) => Math.round(Number(v ?? 0) * 1000);
export const qty = (m: number) => (m / 1000).toFixed(3);
export const showQty = (m: number) => (m / 1000).toLocaleString('en-IN', { maximumFractionDigits: 3 });
export const pick = (row: Values, keys: string[]) => Object.fromEntries(keys.map((k) => [k, row[k]]));
export const sortLines = (rows: Values[]) => [...rows].sort((a, b) => Number(a.sequence) - Number(b.sequence));
export const productIds = (rows: Values[]) => rows.map((l) => l.productId).filter((v): v is number => typeof v === 'number');

/** Quantity per order line on documents in `states` (milli units). */
export async function qtyByOrderLine(tx: Tx, lineModel: string, parentModel: string, inverse: string, states: string[], orderLineIds: number[], extra?: SQL) {
  if (!orderLineIds.length) return new Map<number, number>();
  const l = tableFor(lineModel);
  const p = tableFor(parentModel);
  const rows = await tx
    .select({ id: l.orderLineId, qty: sql<string>`sum(${l.qty})` })
    .from(l)
    .innerJoin(p, eq(p.id, l[inverse]))
    .where(and(inArray(l.orderLineId, orderLineIds), inArray(p.state, states), extra))
    .groupBy(l.orderLineId);
  return new Map(rows.map((r) => [r.id as number, milli(r.qty)]));
}

export const shippedQty = (tx: Tx, f: OrderFlow, states: string[], ids: number[], extra?: SQL) => qtyByOrderLine(tx, f.shipLine, f.ship, f.shipInverse, states, ids, extra);
export const billedQty = (tx: Tx, f: OrderFlow, states: string[], ids: number[], extra?: SQL) => qtyByOrderLine(tx, f.billLine, f.bill, f.billInverse, states, ids, extra);

/**
 * Recounts what was delivered (or received) and billed on an order from its
 * posted documents, and completes or reopens it. Only stock items are
 * delivered; services count as done once billed.
 */
export async function refreshOrder(tx: Tx, f: OrderFlow, orderId: number): Promise<void> {
  const o = tableFor(f.order);
  const ol = tableFor(f.orderLine);
  const bl = tableFor(f.billLine);
  const [order] = await tx.select().from(o).where(eq(o.id, orderId)).for('update');
  if (!order) return;
  const lines = await tx.select().from(ol).where(eq(ol.orderId, orderId));
  const ids = lines.map((l) => l.id as number);
  const shipped = await shippedQty(tx, f, ['posted'], ids);
  const billed = await billedQty(tx, f, ['posted'], ids);
  // Goods billed without a challan or receipt moved stock on the bill itself.
  const direct = await billedQty(tx, f, ['posted'], ids, eq(bl.stockDone, false));
  const goods = await goodsProductIds(tx, productIds(lines));

  const total = { ordered: 0, billed: 0, goods: 0, delivered: 0 };
  for (const l of lines) {
    const id = l.id as number;
    const q = milli(l.qty);
    const d = (shipped.get(id) ?? 0) + (direct.get(id) ?? 0);
    const b = billed.get(id) ?? 0;
    if (d !== milli(l.qtyDelivered) || b !== milli(l.qtyInvoiced)) await tx.update(ol).set({ qtyDelivered: qty(d), qtyInvoiced: qty(b) }).where(eq(ol.id, id));
    total.ordered += q;
    total.billed += Math.min(q, b);
    if (goods.has(l.productId as number)) {
      total.goods += q;
      total.delivered += Math.min(q, d);
    }
  }
  const progress = (done: number, of: number) => (done <= 0 ? 'none' : done >= of ? 'full' : 'partial');
  const invoiceStatus = progress(total.billed, total.ordered);
  const deliveryStatus = total.goods ? progress(total.delivered, total.goods) : invoiceStatus;
  const complete = deliveryStatus === 'full' && invoiceStatus === 'full';
  const state = order.state === 'confirmed' && complete ? 'done' : order.state === 'done' && !complete ? 'confirmed' : order.state;
  if (deliveryStatus !== order.deliveryStatus || invoiceStatus !== order.invoiceStatus || state !== order.state)
    await tx.update(o).set({ deliveryStatus, invoiceStatus, state }).where(eq(o.id, orderId));
}

/** Refreshes every order that the given order lines belong to. */
export async function refreshOrdersOfLines(tx: Tx, f: OrderFlow, orderLineIds: unknown[]): Promise<void> {
  const ids = [...new Set(orderLineIds.filter((v): v is number => typeof v === 'number'))];
  if (!ids.length) return;
  const ol = tableFor(f.orderLine);
  const rows = await tx.selectDistinct({ orderId: ol.orderId }).from(ol).where(inArray(ol.id, ids));
  for (const r of rows) await refreshOrder(tx, f, r.orderId as number);
}

/** Creates a draft document with lines, computing its GST totals as a save would. */
export async function createDraft(
  ctx: HookCtx,
  o: { model: string; lineModel: string; inverse: string; hooks: ModelHooks; header: Values; lines: Values[]; note: Values },
): Promise<number> {
  const header: Values = { ...o.header, state: 'draft' };
  const lines = o.lines.map((l, i) => ({ ...l, sequence: i + 1 }));
  await o.hooks.compute!(ctx, header, { lines });
  const t = tableFor(o.model);
  const lt = tableFor(o.lineModel);
  const [created] = await ctx.tx
    .insert(t)
    .values({ ...header, createdBy: ctx.userId, updatedBy: ctx.userId })
    .returning({ id: t.id });
  const id = created!.id as number;
  await ctx.tx.insert(lt).values(lines.map((l) => ({ ...l, [o.inverse]: id, createdBy: ctx.userId, updatedBy: ctx.userId })));
  const changes = Object.fromEntries(Object.entries(o.note).map(([k, v]) => [k, { from: null, to: v }]));
  await appendAudit(ctx.tx, { userId: ctx.userId, model: o.model, recordId: id, action: 'create', changes });
  return id;
}

/** Stock documents on a bill that is deleted or cancelled can be billed again. */
export function releaseShipments(f: OrderFlow) {
  return async ({ tx, userId }: HookCtx, bill: Values): Promise<void> => {
    const s = tableFor(f.ship);
    const field = f.billInverse;
    const freed = await tx.update(s).set({ [field]: null }).where(eq(s[field], bill.id as number)).returning({ id: s.id });
    for (const row of freed)
      await appendAudit(tx, { userId, model: f.ship, recordId: row.id as number, action: 'update', changes: { [field]: { from: bill.id, to: null } } });
  };
}

/** Wraps a bill action so the orders it touches are recounted once its new state is written. */
export function withOrderRefresh(f: OrderFlow, fn: NonNullable<ModelHooks['actions']>[string], after?: (ctx: HookCtx, record: Values) => Promise<void>) {
  return async (ctx: HookCtx, record: Values, lines: Record<string, Values[]>) => {
    const patch = (await fn(ctx, record, lines)) ?? {};
    const t = tableFor(f.bill);
    await ctx.tx.update(t).set(patch).where(eq(t.id, record.id as number));
    await after?.(ctx, record);
    await refreshOrdersOfLines(ctx.tx, f, (lines.lines ?? []).map((l) => l.orderLineId));
    if (record.orderId) await refreshOrder(ctx.tx, f, record.orderId as number);
    return patch;
  };
}
