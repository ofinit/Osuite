// Purchase orders and goods receipts: what was ordered from a vendor, what
// arrived, and what has been billed. Orders never touch the books; receipts
// add stock against "Goods received, not billed"; bills made from receipts
// clear that account instead of adding the stock again.
import { localToday, money, netUnitCost } from '@osuite/kernel';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { tableFor } from '../../db/tables.ts';
import { RecordError } from '../../services/errors.ts';
import type { HookCtx, ModelHooks, Values } from '../../services/hooks.ts';
import { nextDocumentNumber } from '../../services/numbering.ts';
import { postJournal, reverseJournal } from '../account/journal.ts';
import { gstDocumentHooks, noDuplicate } from '../gst-document.ts';
import {
  billedQty,
  createDraft,
  ITEM_FIELDS,
  milli,
  pick,
  productIds,
  PURCHASE_FLOW as F,
  qty,
  refreshOrder,
  releaseShipments,
  shippedQty,
  showQty,
  sortLines,
  withOrderRefresh,
} from '../order-flow.ts';
import { defaultWarehouseId, goodsProductIds, postMoves, reverseMoves } from '../stock/service.ts';
import { Bill, Order, Receipt } from './index.ts';

const partner = { partnerField: 'vendorId', gstinField: 'vendorGstin', partnerStateField: 'vendorState' };
const orderGst = gstDocumentHooks(Order, { prefix: 'PO', ...partner, journal: 'purchase' });
const receiptGst = gstDocumentHooks(Receipt, { prefix: 'GRN', ...partner, stock: 'in', journal: 'purchase' });
export const billGst = gstDocumentHooks(Bill, {
  prefix: 'BILL',
  ...partner,
  async beforePost(ctx, record) {
    if (!String(record.vendorBillNo ?? '').trim()) throw new RecordError(422, "Enter the vendor's bill number before posting.");
    await noDuplicate('purchase.bill', 'vendorId', 'vendorBillNo', 'Bill')(ctx, record);
  },
  stock: 'in',
  journal: 'purchase',
});

const VENDOR = ['vendorId', 'vendorGstin', 'vendorState', 'placeOfSupply'];

/** A new draft bill for the vendor of an order or receipt. The vendor's bill number is left to fill in. */
function draftBill(ctx: HookCtx, from: Values, lines: Values[], note: string, orderId: number | null) {
  return createDraft(ctx, {
    model: 'purchase.bill',
    lineModel: 'purchase.bill_line',
    inverse: 'billId',
    hooks: billGst,
    header: { ...pick(from, VENDOR), vendorBillNo: '', date: localToday(), warehouseId: from.warehouseId, orderId, amountPaid: '0' },
    lines,
    note: { source: note },
  });
}

// ---------------------------------------------------------------- orders

export const orderHooks: ModelHooks = {
  normalize: orderGst.normalize,
  validate(v, existing) {
    const errors = orderGst.validate?.(v, existing) ?? {};
    const get = (k: string) => (k in v ? v[k] : existing?.[k]);
    const date = get('date');
    const by = get('deliverBy');
    if (typeof date === 'string' && typeof by === 'string' && by < date) errors.deliverBy = 'Expected by is before the order date';
    return errors;
  },
  async compute(ctx, record, lines) {
    await orderGst.compute!(ctx, record, lines);
    if (!record.warehouseId) record.warehouseId = await defaultWarehouseId(ctx.tx);
  },
  actions: {
    async confirm({ tx }, record, lines) {
      if (!(lines.lines ?? []).length) throw new RecordError(422, 'Add at least one item before confirming.');
      return { state: 'confirmed', number: await nextDocumentNumber(tx, 'PO', String(record.date)) };
    },

    /** A draft receipt for every stock item still to arrive (less any draft receipts). */
    async createReceipt(ctx, record, lines) {
      const items = sortLines(lines.lines ?? []);
      const goods = await goodsProductIds(ctx.tx, productIds(items));
      const stockLines = items.filter((l) => goods.has(l.productId as number));
      if (!stockLines.length) throw new RecordError(422, 'This order has no stock items to receive. Create the bill directly.');
      const drafts = await shippedQty(ctx.tx, F, ['draft'], stockLines.map((l) => l.id as number));
      const out = stockLines
        .map((l) => ({ l, left: milli(l.qty) - milli(l.qtyDelivered) - (drafts.get(l.id as number) ?? 0) }))
        .filter(({ left }) => left > 0)
        .map(({ l, left }) => ({ ...pick(l, ITEM_FIELDS), qty: qty(left), orderLineId: l.id }));
      if (!out.length) throw new RecordError(422, 'Everything on this order has been received or is on a draft receipt.');
      const id = await createDraft(ctx, {
        model: 'purchase.receipt',
        lineModel: 'purchase.receipt_line',
        inverse: 'receiptId',
        hooks: receiptGst,
        header: { ...pick(record, VENDOR), date: localToday(), warehouseId: record.warehouseId, orderId: record.id },
        lines: out,
        note: { orderId: String(record.number) },
      });
      return { $open: { model: 'purchase.receipt', id } };
    },

    /**
     * A draft bill for what is ready to bill. Once an order uses receipts, its
     * stock items are billed as received (from posted receipts not yet billed);
     * otherwise, and for services, whatever is left on the order.
     */
    async createBill(ctx, record, lines) {
      const { tx } = ctx;
      const items = sortLines(lines.lines ?? []);
      const goods = await goodsProductIds(tx, productIds(items));
      const r = tableFor('purchase.receipt');
      const rl = tableFor('purchase.receipt_line');
      const usesReceipts = !!(await tx.select({ id: r.id }).from(r).where(and(eq(r.orderId, record.id as number), ne(r.state, 'cancelled'))).limit(1)).length;
      const ready = usesReceipts
        ? await tx
            .select({ line: rl, receiptId: r.id })
            .from(rl)
            .innerJoin(r, eq(r.id, rl.receiptId))
            .where(and(eq(r.orderId, record.id as number), eq(r.state, 'posted'), isNull(r.billId)))
            .orderBy(asc(r.id), asc(rl.sequence))
        : [];
      const drafts = await billedQty(tx, F, ['draft'], items.map((l) => l.id as number));

      const out: Values[] = [];
      for (const l of items) {
        const id = l.id as number;
        if (usesReceipts && goods.has(l.productId as number)) {
          for (const x of ready.filter((y) => y.line.orderLineId === id))
            out.push({ ...pick(x.line, ITEM_FIELDS), qty: x.line.qty, orderLineId: id, stockDone: true, receivedValue: x.line.stockValue });
          continue;
        }
        const left = milli(l.qty) - milli(l.qtyInvoiced) - (drafts.get(id) ?? 0);
        if (left > 0) out.push({ ...pick(l, ITEM_FIELDS), qty: qty(left), orderLineId: id, stockDone: false });
      }
      if (!out.length)
        throw new RecordError(
          422,
          usesReceipts ? 'Nothing received is waiting to be billed. Post a goods receipt first.' : 'Everything on this order has been billed or is on a draft bill.',
        );
      const id = await draftBill(ctx, record, out, `Order ${String(record.number)}`, record.id as number);
      const receipts = [...new Set(ready.map((x) => x.receiptId as number))];
      if (receipts.length) await tx.update(r).set({ billId: id }).where(inArray(r.id, receipts));
      return { $open: { model: 'purchase.bill', id } };
    },

    async cancel({ tx }, record) {
      for (const [model, label] of [
        ['purchase.receipt', 'goods receipt'],
        ['purchase.bill', 'bill'],
      ] as const) {
        const t = tableFor(model);
        const open = await tx
          .select({ number: t.number })
          .from(t)
          .where(and(eq(t.orderId, record.id as number), ne(t.state, 'cancelled')));
        if (open.length)
          throw new RecordError(
            409,
            `This order has ${open.length === 1 ? `a ${label}` : `${open.length} ${label}s`} (${open.map((x) => (x.number ? String(x.number) : 'draft')).join(', ')}). Cancel or delete ${open.length === 1 ? 'it' : 'them'} first.`,
          );
      }
      return { state: 'cancelled' };
    },
  },
};

// ---------------------------------------------------------------- goods receipts

const receiptSource = (record: Values, number = String(record.number)) => ({
  date: String(record.date),
  reference: number,
  refModel: 'purchase.receipt',
  refId: record.id as number,
});

export const receiptHooks: ModelHooks = {
  normalize: receiptGst.normalize,
  validate: receiptGst.validate,
  compute: receiptGst.compute,
  actions: {
    async post({ tx }, record, lines) {
      const rows = sortLines(lines.lines ?? []);
      const goods = await goodsProductIds(tx, productIds(rows));
      const moving = rows.filter((l) => goods.has(l.productId as number));
      if (!moving.length) throw new RecordError(422, 'A goods receipt brings in stock items. Add at least one product kept in stock.');

      // An order's receipts together cannot bring in more than was ordered.
      const linked = rows.filter((l) => typeof l.orderLineId === 'number');
      if (linked.length) {
        const ol = tableFor('purchase.order_line');
        const orderLines = await tx.select().from(ol).where(inArray(ol.id, linked.map((l) => l.orderLineId as number)));
        const taking = new Map<number, number>();
        for (const l of linked) taking.set(l.orderLineId as number, (taking.get(l.orderLineId as number) ?? 0) + milli(l.qty));
        const over = orderLines
          .filter((o) => milli(o.qtyDelivered) + (taking.get(o.id as number) ?? 0) > milli(o.qty))
          .map((o) => `${String(o.description)}: ordered ${showQty(milli(o.qty))}, received ${showQty(milli(o.qtyDelivered))}, this receipt ${showQty(taking.get(o.id as number) ?? 0)}`);
        if (over.length) throw new RecordError(422, `More than ordered. ${over.join('; ')}.`);
      }

      const number = await nextDocumentNumber(tx, 'GRN', String(record.date));
      const src = receiptSource(record, number);
      // Stock comes in at the net rate (GST is an input credit, not cost).
      const posted = await postMoves(
        tx,
        src,
        moving.map((l) => ({
          productId: l.productId as number,
          warehouseId: record.warehouseId as number,
          qty: String(l.qty),
          unitCost: netUnitCost(l.qty as string, l.taxableAmount as string),
          kind: 'purchase' as const,
        })),
      );
      // Remember each line's stock value: the bill clears exactly that.
      const moves = tableFor('stock.move');
      const rl = tableFor('purchase.receipt_line');
      const values = await tx.select({ id: moves.id, value: moves.value }).from(moves).where(inArray(moves.id, posted.ids));
      const byId = new Map(values.map((v) => [v.id as number, String(v.value)]));
      for (const [i, l] of moving.filter((m) => Number(m.qty) !== 0).entries())
        await tx.update(rl).set({ stockValue: byId.get(posted.ids[i]!) ?? '0' }).where(eq(rl.id, l.id as number));

      await postJournal(tx, { ...src, narration: `Goods receipt ${number}` }, [
        { account: 'inventory', amount: posted.value },
        { account: 'grni', amount: money.sub(0, posted.value) },
      ]);
      const patch = { state: 'posted', number };
      const t = tableFor('purchase.receipt');
      await tx.update(t).set(patch).where(eq(t.id, record.id as number));
      if (record.orderId) await refreshOrder(tx, F, record.orderId as number);
      return patch;
    },

    async createBill(ctx, record, lines) {
      if (record.billId) throw new RecordError(409, 'This receipt is already on a bill.');
      const out = sortLines(lines.lines ?? []).map((l) => ({
        ...pick(l, ITEM_FIELDS),
        qty: l.qty,
        orderLineId: l.orderLineId ?? null,
        stockDone: true,
        receivedValue: l.stockValue,
      }));
      const id = await draftBill(ctx, record, out, `Receipt ${String(record.number)}`, (record.orderId as number | null) ?? null);
      return { billId: id, $open: { model: 'purchase.bill', id } };
    },

    async cancel({ tx }, record) {
      if (record.billId) {
        const b = tableFor('purchase.bill');
        const [bill] = await tx.select({ number: b.number }).from(b).where(eq(b.id, record.billId as number));
        throw new RecordError(409, `This receipt is on bill ${bill?.number ? String(bill.number) : '(draft)'}. Cancel or delete that bill first.`);
      }
      const src = receiptSource(record);
      await reverseMoves(tx, src);
      await reverseJournal(tx, src);
      const t = tableFor('purchase.receipt');
      await tx.update(t).set({ state: 'cancelled' }).where(eq(t.id, record.id as number));
      if (record.orderId) await refreshOrder(tx, F, record.orderId as number);
      return { state: 'cancelled' };
    },
  },
};

// ---------------------------------------------------------------- bills

const releaseReceipts = releaseShipments(F);

export const billHooks: ModelHooks = {
  ...billGst,
  beforeRemove: releaseReceipts,
  actions: {
    ...billGst.actions,
    // Orders count posted bills; a cancelled bill's receipts can be billed again.
    post: withOrderRefresh(F, billGst.actions!.post!),
    cancel: withOrderRefresh(F, billGst.actions!.cancel!, releaseReceipts),
  },
};
