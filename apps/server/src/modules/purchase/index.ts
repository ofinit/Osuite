import { defineModel, defineModule, IN_STATES } from '@osuite/kernel';
import { DOC_STATES, GST_LINE_COLUMNS, gstLineFields, gstTotalFields, NOTE_REASONS, noteSettlementFields, paymentFields } from '../gst-document.ts';

export const BillLine = defineModel({
  name: 'purchase.bill_line',
  table: 'purchase_bill_line',
  label: 'Bill line',
  labelPlural: 'Bill lines',
  recName: 'description',
  searchFields: ['description'],
  order: 'sequence asc',
  fields: gstLineFields({ inverse: 'billId', parent: 'purchase.bill', parentLabel: 'Bill', price: 'costPrice' }),
  list: { columns: GST_LINE_COLUMNS },
  form: { sections: [{ fields: ['productId', 'description', 'hsnCode', 'qty', 'uom', 'unitPrice', 'discountPct', 'gstRate'] }] },
});

export const Bill = defineModel({
  name: 'purchase.bill',
  table: 'purchase_bill',
  label: 'Bill',
  labelPlural: 'Bills',
  recName: 'number',
  searchFields: ['number', 'vendorBillNo', 'vendorGstin', 'vendorId'],
  order: 'id desc',
  fields: {
    number: { type: 'char', label: 'Number', maxLength: 30, readonly: true, unique: true },
    state: { type: 'selection', label: 'Status', options: DOC_STATES, default: 'draft', readonly: true, required: true, index: true },
    vendorId: {
      type: 'many2one',
      label: 'Vendor',
      relation: 'base.contact',
      required: true,
      filter: { isVendor: true },
      fill: { vendorState: 'stateCode', vendorGstin: 'gstin' },
    },
    vendorGstin: { type: 'char', label: 'Vendor GSTIN', maxLength: 15 },
    vendorState: { type: 'selection', label: 'Vendor state', options: IN_STATES, required: true },
    vendorBillNo: { type: 'char', label: 'Vendor bill no.', maxLength: 40, required: true, index: true },
    date: { type: 'date', label: 'Bill date', required: true, default: 'today', index: true },
    dueDate: { type: 'date', label: 'Due date' },
    placeOfSupply: { type: 'selection', label: 'Place of supply', options: IN_STATES, help: 'Defaults to your state' },
    warehouseId: { type: 'many2one', label: 'Receive into', relation: 'stock.warehouse', help: 'Defaults to your main warehouse' },
    lines: { type: 'lines', label: 'Items', model: 'purchase.bill_line', inverse: 'billId' },
    notes: { type: 'text', label: 'Internal notes' },
    ...gstTotalFields,
    ...paymentFields,
  },
  list: { columns: ['number', 'date', 'vendorId', 'vendorBillNo', 'totalAmount', 'amountDue', 'paymentState', 'state'] },
  form: {
    layout: 'page',
    summary: 'gst',
    sections: [
      { columns: 3, fields: ['vendorId', 'vendorGstin', 'vendorState', 'vendorBillNo', 'date', 'dueDate', 'warehouseId'] },
      { title: 'Items', columns: 1, fields: ['lines'] },
      { title: 'Payment', columns: 3, fields: ['paymentState', 'amountPaid', 'amountDue'] },
      { title: 'Notes', columns: 1, fields: ['notes'] },
    ],
  },
  gst: { placeOfSupplyField: 'placeOfSupply', supplierStateField: 'vendorState' },
  states: { field: 'state', editable: ['draft'] },
  actions: [
    {
      name: 'post',
      label: 'Post bill',
      states: ['draft'],
      primary: true,
      confirm: 'Post this bill? It gets the next bill number and can no longer be edited.',
    },
    {
      name: 'cancel',
      label: 'Cancel bill',
      states: ['posted'],
      danger: true,
      confirm: 'Cancel this bill? It stays on record as cancelled.',
    },
  ],
});

export const DebitNoteLine = defineModel({
  name: 'purchase.debit_note_line',
  table: 'purchase_debit_note_line',
  label: 'Debit note line',
  labelPlural: 'Debit note lines',
  recName: 'description',
  searchFields: ['description'],
  order: 'sequence asc',
  fields: gstLineFields({ inverse: 'debitNoteId', parent: 'purchase.debit_note', parentLabel: 'Debit note', price: 'costPrice' }),
  list: { columns: GST_LINE_COLUMNS },
  form: { sections: [{ fields: ['productId', 'description', 'hsnCode', 'qty', 'uom', 'unitPrice', 'discountPct', 'gstRate'] }] },
});

/** Reduces what you owe a vendor for a posted bill (returns to vendor, rate corrections). */
export const DebitNote = defineModel({
  name: 'purchase.debit_note',
  table: 'purchase_debit_note',
  label: 'Debit note',
  labelPlural: 'Debit notes',
  recName: 'number',
  searchFields: ['number', 'vendorGstin', 'vendorId'],
  order: 'id desc',
  fields: {
    number: { type: 'char', label: 'Number', maxLength: 30, readonly: true, unique: true },
    state: { type: 'selection', label: 'Status', options: DOC_STATES, default: 'draft', readonly: true, required: true, index: true },
    billId: {
      type: 'many2one',
      label: 'Against bill',
      relation: 'purchase.bill',
      required: true,
      filter: { state: 'posted' },
      fill: { vendorId: 'vendorId', vendorGstin: 'vendorGstin', vendorState: 'vendorState', placeOfSupply: 'placeOfSupply', warehouseId: 'warehouseId' },
    },
    vendorId: { type: 'many2one', label: 'Vendor', relation: 'base.contact', required: true, filter: { isVendor: true } },
    vendorGstin: { type: 'char', label: 'Vendor GSTIN', maxLength: 15 },
    vendorState: { type: 'selection', label: 'Vendor state', options: IN_STATES, required: true },
    placeOfSupply: { type: 'selection', label: 'Place of supply', options: IN_STATES, help: 'Defaults to your state' },
    date: { type: 'date', label: 'Date', required: true, default: 'today', index: true },
    reason: { type: 'selection', label: 'Reason', options: NOTE_REASONS, required: true, default: 'return' },
    warehouseId: { type: 'many2one', label: 'Return from', relation: 'stock.warehouse', help: 'Used when goods go back' },
    lines: { type: 'lines', label: 'Items', model: 'purchase.debit_note_line', inverse: 'debitNoteId' },
    notes: { type: 'text', label: 'Notes' },
    ...gstTotalFields,
    ...noteSettlementFields,
  },
  list: { columns: ['number', 'date', 'vendorId', 'billId', 'reason', 'totalAmount', 'state'] },
  form: {
    layout: 'page',
    summary: 'gst',
    sections: [
      { columns: 3, fields: ['billId', 'vendorId', 'vendorGstin', 'vendorState', 'date', 'reason', 'warehouseId'] },
      { title: 'Items', columns: 1, fields: ['lines'] },
      { title: 'Settlement', columns: 3, fields: ['amountApplied', 'unappliedAmount'] },
      { title: 'Notes', columns: 1, fields: ['notes'] },
    ],
  },
  gst: { placeOfSupplyField: 'placeOfSupply', supplierStateField: 'vendorState' },
  states: { field: 'state', editable: ['draft'] },
  actions: [
    { name: 'copyLines', label: 'Copy items from bill', states: ['draft'] },
    {
      name: 'post',
      label: 'Post debit note',
      states: ['draft'],
      primary: true,
      confirm: 'Post this debit note? It reduces what you owe the vendor and can no longer be edited.',
    },
    {
      name: 'cancel',
      label: 'Cancel debit note',
      states: ['posted'],
      danger: true,
      confirm: 'Cancel this debit note? The bill becomes due again and any returned stock comes back.',
    },
  ],
});

export default defineModule({
  name: 'purchase',
  label: 'Purchases',
  depends: ['base', 'stock'],
  models: [Bill, BillLine, DebitNote, DebitNoteLine],
  menus: [
    {
      id: 'purchase',
      label: 'Purchases',
      icon: 'cart',
      children: [
        { id: 'purchase.bills', label: 'Bills', model: 'purchase.bill' },
        { id: 'purchase.debit_notes', label: 'Debit notes', model: 'purchase.debit_note' },
        { id: 'purchase.payments', label: 'Payments made', model: 'account.payment', filter: { direction: 'outbound' } },
        { id: 'purchase.payables', label: 'Payables', path: '/reports/payables' },
      ],
    },
  ],
});
