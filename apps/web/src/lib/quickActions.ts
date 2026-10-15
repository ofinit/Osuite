import type { ModelDef, RecordData } from '@osuite/kernel';

export interface QuickAction {
  label: string;
  href: string;
}

const prefill = (values: Record<string, unknown>) => encodeURIComponent(JSON.stringify(values));

/** Shortcuts from a record to related work, e.g. paying or crediting an invoice. */
export function quickActions(model: ModelDef, rec: RecordData | undefined): QuickAction[] {
  if (model.name === 'sales.quotation') {
    const inv = rec?.invoiceId as { id: number } | null | undefined;
    if (inv) return [{ label: 'Open invoice', href: `/m/sales.invoice?id=${inv.id}` }];
    if (rec && rec.state !== 'draft') return [{ label: 'Print as proforma invoice', href: `/print/sales.quotation/${String(rec.id)}?as=proforma` }];
    return [];
  }
  if (!rec || rec.state !== 'posted') return [];
  const doc = { id: rec.id, display: String(rec.number) };
  const due = Number(rec.amountDue) > 0;
  if (model.name === 'sales.invoice') {
    return [
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
