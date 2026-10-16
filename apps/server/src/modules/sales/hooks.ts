import { localToday } from '@osuite/kernel';
import { eq } from 'drizzle-orm';
import { tableFor } from '../../db/tables.ts';
import { appendAudit } from '../../services/audit.ts';
import { RecordError } from '../../services/errors.ts';
import type { HookCtx, HookMap, ModelHooks, Values } from '../../services/hooks.ts';
import { nextDocumentNumber } from '../../services/numbering.ts';
import { gstDocumentHooks } from '../gst-document.ts';
import { defaultWarehouseId } from '../stock/service.ts';
import { CreditNote, Invoice, Quotation } from './index.ts';
import { deliveryHooks, orderHooks, quotationToOrder, releaseChallans, withOrderRefresh } from './orders.ts';

const VALID_DAYS = 15;
const LINE_FIELDS = ['productId', 'description', 'hsnCode', 'qty', 'uom', 'unitPrice', 'discountPct', 'gstRate', 'taxableAmount', 'taxAmount', 'totalAmount'];
const TOTALS = ['taxableAmount', 'cgstAmount', 'sgstAmount', 'igstAmount', 'roundOff', 'totalAmount'];

const addDays = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Quotations share the GST arithmetic of invoices but never post, number only when sent, and convert to invoices. */
function quotationHooks(): ModelHooks {
  // Only the shared field handling; the posting actions do not apply.
  const gst = gstDocumentHooks(Quotation, { prefix: 'QT', partnerField: 'customerId', gstinField: 'customerGstin', journal: 'sale' });
  return {
    normalize: gst.normalize,
    validate(v, existing) {
      const errors = gst.validate?.(v, existing) ?? {};
      const get = (k: string) => (k in v ? v[k] : existing?.[k]);
      const date = get('date');
      const until = get('validUntil');
      if (typeof date === 'string' && typeof until === 'string' && until < date) errors.validUntil = 'Valid until is before the quotation date';
      return errors;
    },
    async compute(ctx, record, lines) {
      await gst.compute!(ctx, record, lines);
      if (!record.validUntil && typeof record.date === 'string') record.validUntil = addDays(record.date, VALID_DAYS);
    },
    actions: {
      async send({ tx }, record, lines) {
        if (!(lines.lines ?? []).length) throw new RecordError(422, 'Add at least one item before sending.');
        // A revised quotation keeps the number it was first sent with.
        return { state: 'sent', number: record.number ?? (await nextDocumentNumber(tx, 'QT', String(record.date))) };
      },
      accept: async () => ({ state: 'accepted' }),
      decline: async () => ({ state: 'declined' }),
      revise: async () => ({ state: 'draft' }),

      /** Copies the quotation into a new draft sales order. */
      async toOrder(ctx, record, lines) {
        const id = await quotationToOrder(ctx, record, lines.lines ?? []);
        return { state: 'ordered', orderId: id, $open: { model: 'sales.order', id } };
      },

      /** Copies the quotation into a new draft invoice dated today. */
      async toInvoice({ tx, userId }, record, lines) {
        const items = lines.lines ?? [];
        if (!items.length) throw new RecordError(422, 'This quotation has no items.');
        const today = localToday();
        if (typeof record.validUntil === 'string' && record.validUntil < today && record.state !== 'accepted')
          throw new RecordError(422, `This quotation expired on ${record.validUntil}. Mark it accepted first if the customer has agreed to it.`);
        const inv = tableFor('sales.invoice');
        const invLines = tableFor('sales.invoice_line');
        const [created] = await tx
          .insert(inv)
          .values({
            state: 'draft',
            customerId: record.customerId,
            customerGstin: record.customerGstin,
            placeOfSupply: record.placeOfSupply,
            date: today,
            reference: record.reference ? String(record.reference) : `Quotation ${String(record.number)}`,
            warehouseId: await defaultWarehouseId(tx),
            notes: record.notes,
            // Same lines and place of supply, so the quotation's totals carry over exactly.
            ...Object.fromEntries(TOTALS.map((k) => [k, record[k]])),
            amountPaid: '0',
            amountDue: record.totalAmount,
            createdBy: userId,
            updatedBy: userId,
          })
          .returning({ id: inv.id });
        const ordered = [...items].sort((a, b) => Number(a.sequence) - Number(b.sequence));
        await tx.insert(invLines).values(
          ordered.map((l, i) => ({ ...Object.fromEntries(LINE_FIELDS.map((k) => [k, l[k]])), sequence: i + 1, invoiceId: created!.id })),
        );
        await appendAudit(tx, {
          userId,
          model: 'sales.invoice',
          recordId: created!.id as number,
          action: 'create',
          changes: { quotationId: { from: null, to: String(record.number) } },
        });
        return { state: 'invoiced', invoiceId: created!.id, $open: { model: 'sales.invoice', id: created!.id } };
      },
    },
  };
}

/** Deleting a draft invoice made from a quotation puts the quotation back to accepted. */
async function releaseQuotation({ tx, userId }: HookCtx, invoice: Values) {
  const q = tableFor('sales.quotation');
  const linked = await tx.update(q).set({ state: 'accepted', invoiceId: null }).where(eq(q.invoiceId, invoice.id as number)).returning({ id: q.id });
  for (const row of linked)
    await appendAudit(tx, {
      userId,
      model: 'sales.quotation',
      recordId: row.id as number,
      action: 'update',
      changes: { state: { from: 'invoiced', to: 'accepted' }, invoiceId: { from: invoice.id, to: null } },
    });
}

const invoiceGst = gstDocumentHooks(Invoice, { prefix: 'INV', partnerField: 'customerId', gstinField: 'customerGstin', stock: 'out', journal: 'sale' });

export const hooks: HookMap = {
  'sales.quotation': quotationHooks(),
  'sales.order': orderHooks,
  'sales.delivery': deliveryHooks,
  'sales.invoice': {
    ...invoiceGst,
    async beforeRemove(ctx, invoice) {
      await releaseQuotation(ctx, invoice);
      await releaseChallans(ctx, invoice);
    },
    actions: {
      ...invoiceGst.actions,
      // Orders count posted invoices; a cancelled invoice's challans can be invoiced again.
      post: withOrderRefresh(invoiceGst.actions!.post!),
      cancel: withOrderRefresh(invoiceGst.actions!.cancel!, releaseChallans),
    },
  },
  'sales.credit_note': gstDocumentHooks(CreditNote, {
    prefix: 'CN',
    partnerField: 'customerId',
    gstinField: 'customerGstin',
    stock: 'in',
    journal: 'sale_return',
    appliesTo: {
      field: 'invoiceId',
      model: 'sales.invoice',
      lineModel: 'sales.invoice_line',
      lineInverse: 'invoiceId',
      ownLineModel: 'sales.credit_note_line',
      ownLineInverse: 'creditNoteId',
      direction: 'inbound',
      label: 'invoice',
    },
  }),
};
