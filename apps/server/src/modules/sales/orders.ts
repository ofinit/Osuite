// Sales orders and delivery challans: what the customer ordered, what went out
// of stock, and what has been invoiced. Orders never touch the books; challans
// move stock and its cost; invoices made from challans book only the sale.
import { localToday, money } from '@osuite/kernel';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { tableFor } from '../../db/tables.ts';
import { appendAudit } from '../../services/audit.ts';
import { RecordError } from '../../services/errors.ts';
import type { HookCtx, ModelHooks, Values } from '../../services/hooks.ts';
import { nextDocumentNumber } from '../../services/numbering.ts';
import { postJournal, reverseJournal } from '../account/journal.ts';
import { gstDocumentHooks } from '../gst-document.ts';
import {
  billedQty,
  createDraft,
  ITEM_FIELDS,
  milli,
  pick,
  productIds,
  qty,
  refreshOrder as refresh,
  releaseShipments,
  SALES_FLOW as F,
  shippedQty,
  showQty,
  sortLines,
  withOrderRefresh as withRefresh,
} from '../order-flow.ts';
import { defaultWarehouseId, goodsProductIds, postMoves, reverseMoves } from '../stock/service.ts';
import { Delivery, Invoice, Order } from './index.ts';

const orderGst = gstDocumentHooks(Order, { prefix: 'SO', partnerField: 'customerId', gstinField: 'customerGstin', journal: 'sale' });
const deliveryGst = gstDocumentHooks(Delivery, { prefix: 'DC', partnerField: 'customerId', gstinField: 'customerGstin', stock: 'out', journal: 'sale' });
const invoiceGst = gstDocumentHooks(Invoice, { prefix: 'INV', partnerField: 'customerId', gstinField: 'customerGstin', stock: 'out', journal: 'sale' });

/** A new draft invoice for the customer of an order or challan. */
async function draftInvoice(ctx: HookCtx, from: Values, lines: Values[], reference: string, orderId: number | null): Promise<number> {
  return createDraft(ctx, {
    model: 'sales.invoice',
    lineModel: 'sales.invoice_line',
    inverse: 'invoiceId',
    hooks: invoiceGst,
    header: {
      customerId: from.customerId,
      customerGstin: from.customerGstin,
      placeOfSupply: from.placeOfSupply,
      date: localToday(),
      reference,
      warehouseId: from.warehouseId,
      orderId,
      notes: from.notes,
      amountPaid: '0',
    },
    lines,
    note: { source: reference },
  });
}

// ---------------------------------------------------------------- quotation → order

/** Copies a quotation into a new draft sales order; returns the order id. */
export async function quotationToOrder(ctx: HookCtx, record: Values, lines: Values[]): Promise<number> {
  if (!lines.length) throw new RecordError(422, 'This quotation has no items.');
  return createDraft(ctx, {
    model: 'sales.order',
    lineModel: 'sales.order_line',
    inverse: 'orderId',
    hooks: orderHooks,
    header: {
      customerId: record.customerId,
      customerGstin: record.customerGstin,
      placeOfSupply: record.placeOfSupply,
      date: localToday(),
      reference: record.reference ? String(record.reference) : `Quotation ${String(record.number)}`,
      warehouseId: await defaultWarehouseId(ctx.tx),
      quotationId: record.id,
      notes: record.notes,
    },
    lines: sortLines(lines).map((l) => ({ ...pick(l, ITEM_FIELDS), qty: l.qty })),
    note: { quotationId: String(record.number) },
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
    if (typeof date === 'string' && typeof by === 'string' && by < date) errors.deliverBy = 'Deliver by is before the order date';
    return errors;
  },
  async compute(ctx, record, lines) {
    await orderGst.compute!(ctx, record, lines);
    if (!record.warehouseId) record.warehouseId = await defaultWarehouseId(ctx.tx);
  },
  async beforeRemove({ tx, userId }, order) {
    // A draft order made from a quotation puts the quotation back to accepted.
    const q = tableFor('sales.quotation');
    const linked = await tx.update(q).set({ state: 'accepted', orderId: null }).where(eq(q.orderId, order.id as number)).returning({ id: q.id });
    for (const row of linked)
      await appendAudit(tx, { userId, model: 'sales.quotation', recordId: row.id as number, action: 'update', changes: { state: { from: 'ordered', to: 'accepted' } } });
  },
  actions: {
    async confirm({ tx }, record, lines) {
      if (!(lines.lines ?? []).length) throw new RecordError(422, 'Add at least one item before confirming.');
      return { state: 'confirmed', number: await nextDocumentNumber(tx, 'SO', String(record.date)) };
    },

    /** A draft challan for every stock item still to go out (less any draft challans). */
    async createDelivery(ctx, record, lines) {
      const items = sortLines(lines.lines ?? []);
      const goods = await goodsProductIds(ctx.tx, productIds(items));
      const stockLines = items.filter((l) => goods.has(l.productId as number));
      if (!stockLines.length) throw new RecordError(422, 'This order has no stock items to deliver. Create the invoice directly.');
      const drafts = await shippedQty(ctx.tx, F, ['draft'], stockLines.map((l) => l.id as number));
      const out = stockLines
        .map((l) => ({ l, left: milli(l.qty) - milli(l.qtyDelivered) - (drafts.get(l.id as number) ?? 0) }))
        .filter(({ left }) => left > 0)
        .map(({ l, left }) => ({ ...pick(l, ITEM_FIELDS), qty: qty(left), orderLineId: l.id }));
      if (!out.length) throw new RecordError(422, 'Everything on this order has been delivered or is on a draft challan.');
      const id = await createDraft(ctx, {
        model: 'sales.delivery',
        lineModel: 'sales.delivery_line',
        inverse: 'deliveryId',
        hooks: deliveryGst,
        header: {
          customerId: record.customerId,
          customerGstin: record.customerGstin,
          placeOfSupply: record.placeOfSupply,
          date: localToday(),
          purpose: 'supply',
          warehouseId: record.warehouseId,
          orderId: record.id,
        },
        lines: out,
        note: { orderId: String(record.number) },
      });
      return { $open: { model: 'sales.delivery', id } };
    },

    /**
     * A draft invoice for what is ready to bill. Once an order uses challans,
     * its stock items are invoiced as delivered (from posted challans not yet
     * invoiced); otherwise, and for services, whatever is left on the order.
     */
    async createInvoice(ctx, record, lines) {
      const { tx } = ctx;
      const items = sortLines(lines.lines ?? []);
      const ids = items.map((l) => l.id as number);
      const goods = await goodsProductIds(tx, productIds(items));
      const d = tableFor('sales.delivery');
      const dl = tableFor('sales.delivery_line');
      const usesChallans = !!(await tx.select({ id: d.id }).from(d).where(and(eq(d.orderId, record.id as number), ne(d.state, 'cancelled'))).limit(1)).length;
      const ready = usesChallans
        ? await tx
            .select({ line: dl, deliveryId: d.id })
            .from(dl)
            .innerJoin(d, eq(d.id, dl.deliveryId))
            .where(and(eq(d.orderId, record.id as number), eq(d.state, 'posted'), isNull(d.invoiceId)))
            .orderBy(asc(d.id), asc(dl.sequence))
        : [];
      const drafts = await billedQty(tx, F, ['draft'], ids);

      const out: Values[] = [];
      for (const l of items) {
        const id = l.id as number;
        if (usesChallans && goods.has(l.productId as number)) {
          for (const r of ready.filter((x) => x.line.orderLineId === id))
            out.push({ ...pick(r.line, ITEM_FIELDS), qty: r.line.qty, orderLineId: id, stockDone: true });
          continue;
        }
        const left = milli(l.qty) - milli(l.qtyInvoiced) - (drafts.get(id) ?? 0);
        if (left > 0) out.push({ ...pick(l, ITEM_FIELDS), qty: qty(left), orderLineId: id, stockDone: false });
      }
      if (!out.length)
        throw new RecordError(
          422,
          usesChallans
            ? 'Nothing delivered is waiting to be invoiced. Post a delivery challan first.'
            : 'Everything on this order has been invoiced or is on a draft invoice.',
        );
      const reference = record.reference ? String(record.reference) : `Order ${String(record.number)}`;
      const id = await draftInvoice(ctx, record, out, reference, record.id as number);
      const challans = [...new Set(ready.map((r) => r.deliveryId as number))];
      if (challans.length) await tx.update(d).set({ invoiceId: id }).where(inArray(d.id, challans));
      return { $open: { model: 'sales.invoice', id } };
    },

    async cancel({ tx }, record) {
      for (const [model, label] of [
        ['sales.delivery', 'delivery challan'],
        ['sales.invoice', 'invoice'],
      ] as const) {
        const t = tableFor(model);
        const open = await tx
          .select({ number: t.number, state: t.state })
          .from(t)
          .where(and(eq(t.orderId, record.id as number), ne(t.state, 'cancelled')));
        if (open.length)
          throw new RecordError(
            409,
            `This order has ${open.length === 1 ? `a ${label}` : `${open.length} ${label}s`} (${open.map((r) => (r.number ? String(r.number) : 'draft')).join(', ')}). Cancel or delete ${open.length === 1 ? 'it' : 'them'} first.`,
          );
      }
      return { state: 'cancelled' };
    },
  },
};

// ---------------------------------------------------------------- delivery challans

const challanSource = (record: Values, number = String(record.number)) => ({
  date: String(record.date),
  reference: number,
  refModel: 'sales.delivery',
  refId: record.id as number,
});

export const deliveryHooks: ModelHooks = {
  normalize: deliveryGst.normalize,
  validate: deliveryGst.validate,
  compute: deliveryGst.compute,
  actions: {
    async post({ tx }, record, lines) {
      const rows = sortLines(lines.lines ?? []);
      const goods = await goodsProductIds(tx, productIds(rows));
      const moving = rows.filter((l) => goods.has(l.productId as number));
      if (!moving.length) throw new RecordError(422, 'A delivery challan sends stock items. Add at least one product kept in stock.');

      // An order's challans together cannot send more than was ordered.
      const linked = rows.filter((l) => typeof l.orderLineId === 'number');
      if (linked.length) {
        const ol = tableFor('sales.order_line');
        const orderLines = await tx.select().from(ol).where(inArray(ol.id, linked.map((l) => l.orderLineId as number)));
        const sending = new Map<number, number>();
        for (const l of linked) sending.set(l.orderLineId as number, (sending.get(l.orderLineId as number) ?? 0) + milli(l.qty));
        const over = orderLines
          .filter((o) => milli(o.qtyDelivered) + (sending.get(o.id as number) ?? 0) > milli(o.qty))
          .map((o) => `${String(o.description)}: ordered ${showQty(milli(o.qty))}, delivered ${showQty(milli(o.qtyDelivered))}, this challan ${showQty(sending.get(o.id as number) ?? 0)}`);
        if (over.length) throw new RecordError(422, `More than ordered. ${over.join('; ')}.`);
      }

      const number = await nextDocumentNumber(tx, 'DC', String(record.date));
      const src = challanSource(record, number);
      const { value } = await postMoves(
        tx,
        src,
        moving.map((l) => ({ productId: l.productId as number, warehouseId: record.warehouseId as number, qty: String(-Number(l.qty)), kind: 'sale' as const })),
      );
      // The goods' cost leaves stock now; the invoice later books only the sale.
      const cost = money.sub(0, value);
      await postJournal(tx, { ...src, narration: `Delivery challan ${number}` }, [
        { account: 'cogs', amount: cost },
        { account: 'inventory', amount: money.sub(0, cost) },
      ]);
      const patch = { state: 'posted', number };
      const t = tableFor('sales.delivery');
      await tx.update(t).set(patch).where(eq(t.id, record.id as number));
      if (record.orderId) await refresh(tx, F, record.orderId as number);
      return patch;
    },

    async createInvoice(ctx, record, lines) {
      if (record.invoiceId) throw new RecordError(409, 'This challan is already on an invoice.');
      const rows = sortLines(lines.lines ?? []);
      const out = rows.map((l) => ({ ...pick(l, ITEM_FIELDS), qty: l.qty, orderLineId: l.orderLineId ?? null, stockDone: true }));
      const id = await draftInvoice(ctx, record, out, `Challan ${String(record.number)}`, (record.orderId as number | null) ?? null);
      return { invoiceId: id, $open: { model: 'sales.invoice', id } };
    },

    async cancel({ tx }, record) {
      if (record.invoiceId) {
        const inv = tableFor('sales.invoice');
        const [i] = await tx.select({ number: inv.number }).from(inv).where(eq(inv.id, record.invoiceId as number));
        throw new RecordError(409, `This challan is on invoice ${i?.number ? String(i.number) : '(draft)'}. Cancel or delete that invoice first.`);
      }
      const src = challanSource(record);
      await reverseMoves(tx, src);
      await reverseJournal(tx, src);
      const t = tableFor('sales.delivery');
      await tx.update(t).set({ state: 'cancelled' }).where(eq(t.id, record.id as number));
      if (record.orderId) await refresh(tx, F, record.orderId as number);
      return { state: 'cancelled' };
    },
  },
};

// ---------------------------------------------------------------- invoices

/** Challans on an invoice that is deleted or cancelled can be invoiced again. */
export const releaseChallans = releaseShipments(F);

/** Wraps an invoice action so the orders it touches are recounted once its new state is written. */
export const withOrderRefresh = (fn: NonNullable<ModelHooks['actions']>[string], after?: (ctx: HookCtx, record: Values) => Promise<void>) => withRefresh(F, fn, after);
