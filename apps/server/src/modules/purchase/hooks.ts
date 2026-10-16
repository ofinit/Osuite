import type { HookMap } from '../../services/hooks.ts';
import { gstDocumentHooks } from '../gst-document.ts';
import { DebitNote } from './index.ts';
import { billHooks, orderHooks, receiptHooks } from './orders.ts';

export const hooks: HookMap = {
  'purchase.order': orderHooks,
  'purchase.receipt': receiptHooks,
  'purchase.bill': billHooks,
  'purchase.debit_note': gstDocumentHooks(DebitNote, {
    prefix: 'DN',
    partnerField: 'vendorId',
    gstinField: 'vendorGstin',
    partnerStateField: 'vendorState',
    stock: 'out',
    journal: 'purchase_return',
    appliesTo: {
      field: 'billId',
      model: 'purchase.bill',
      lineModel: 'purchase.bill_line',
      lineInverse: 'billId',
      ownLineModel: 'purchase.debit_note_line',
      ownLineInverse: 'debitNoteId',
      direction: 'outbound',
      label: 'bill',
    },
  }),
};
