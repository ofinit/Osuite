import type { HookMap } from '../../services/hooks.ts';
import { gstDocumentHooks, noDuplicate } from '../gst-document.ts';
import { Bill, DebitNote } from './index.ts';

export const hooks: HookMap = {
  'purchase.bill': gstDocumentHooks(Bill, {
    prefix: 'BILL',
    partnerField: 'vendorId',
    gstinField: 'vendorGstin',
    partnerStateField: 'vendorState',
    beforePost: noDuplicate('purchase.bill', 'vendorId', 'vendorBillNo', 'Bill'),
    stock: 'in',
    journal: 'purchase',
  }),
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
