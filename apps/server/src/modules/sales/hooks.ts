import type { HookMap } from '../../services/hooks.ts';
import { gstDocumentHooks } from '../gst-document.ts';
import { CreditNote, Invoice } from './index.ts';

export const hooks: HookMap = {
  'sales.invoice': gstDocumentHooks(Invoice, { prefix: 'INV', partnerField: 'customerId', gstinField: 'customerGstin', stock: 'out', journal: 'sale' }),
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
