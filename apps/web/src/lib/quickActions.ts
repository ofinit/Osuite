import type { ModelDef, RecordData } from '@osuite/kernel';

export interface QuickAction {
  label: string;
  href: string;
}

const prefill = (values: Record<string, unknown>) => encodeURIComponent(JSON.stringify(values));

/** Shortcuts from a record to related work, e.g. paying or crediting an invoice. */
export function quickActions(model: ModelDef, rec: RecordData | undefined): QuickAction[] {
  // Follow the chain quotation → order → challan → invoice.
  const linked: QuickAction[] = [];
  for (const [field, target, label] of [
    ['quotationId', 'sales.quotation', 'Open quotation'],
    ['orderId', model.name.startsWith('purchase.') ? 'purchase.order' : 'sales.order', 'Open order'],
    ['invoiceId', 'sales.invoice', 'Open invoice'],
    ['billId', 'purchase.bill', 'Open bill'],
  ] as const) {
    const ref = model.fields[field]?.type === 'many2one' ? (rec?.[field] as { id: number } | null | undefined) : null;
    if (ref && model.name !== target) linked.push({ label, href: `/m/${target}?id=${ref.id}` });
  }
  if (['sales.order', 'sales.delivery', 'purchase.order', 'purchase.receipt'].includes(model.name)) return linked;
  if (model.name === 'sales.quotation') {
    if (linked.length) return linked;
    if (rec && rec.state !== 'draft') return [{ label: 'Print as proforma invoice', href: `/print/sales.quotation/${String(rec.id)}?as=proforma` }];
    return [];
  }
  if (!rec || rec.state !== 'posted') return linked;
  const doc = { id: rec.id, display: String(rec.number) };
  const due = Number(rec.amountDue) > 0;
  if (model.name === 'sales.invoice') {
    return [
      ...linked,
      ...(due
        ? [
            {
              label: 'Record payment',
              href: `/m/account.payment?f.direction=inbound&id=new&with=${prefill({
                partnerId: rec.customerId,
                amount: rec.amountDue,
                lines: [{ invoiceId: doc, amount: rec.amountDue }],
              })}`,
            },
          ]
        : []),
      {
        label: 'Issue credit note',
        href: `/m/sales.credit_note?id=new&with=${prefill({
          invoiceId: doc,
          customerId: rec.customerId,
          customerGstin: rec.customerGstin,
          placeOfSupply: rec.placeOfSupply,
          warehouseId: rec.warehouseId,
        })}`,
      },
    ];
  }
  if (model.name === 'purchase.bill') {
    return [
      ...linked,
      ...(due
        ? [
            {
              label: 'Record payment',
              href: `/m/account.payment?f.direction=outbound&id=new&with=${prefill({
                partnerId: rec.vendorId,
                amount: rec.amountDue,
                lines: [{ billId: doc, amount: rec.amountDue }],
              })}`,
            },
          ]
        : []),
      {
        label: 'Issue debit note',
        href: `/m/purchase.debit_note?id=new&with=${prefill({
          billId: doc,
          vendorId: rec.vendorId,
          vendorGstin: rec.vendorGstin,
          vendorState: rec.vendorState,
          placeOfSupply: rec.placeOfSupply,
          warehouseId: rec.warehouseId,
        })}`,
      },
    ];
  }
  return [];
}
