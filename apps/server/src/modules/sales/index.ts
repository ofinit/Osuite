import { defineModel, defineModule, IN_STATES } from '@osuite/kernel';
import { DOC_STATES, GST_LINE_COLUMNS, gstLineFields, gstTotalFields, NOTE_REASONS, noteSettlementFields, paymentFields } from '../gst-document.ts';

export const InvoiceLine = defineModel({
  name: 'sales.invoice_line',
  table: 'sales_invoice_line',
  label: 'Invoice line',
  labelPlural: 'Invoice lines',
  recName: 'description',
  searchFields: ['description'],
  order: 'sequence asc',
  fields: gstLineFields({ inverse: 'invoiceId', parent: 'sales.invoice', parentLabel: 'Invoice', price: 'salePrice' }),
  list: { columns: GST_LINE_COLUMNS },
  form: { sections: [{ fields: ['productId', 'description', 'hsnCode', 'qty', 'uom', 'unitPrice', 'discountPct', 'gstRate'] }] },
});

export const Invoice = defineModel({
  name: 'sales.invoice',
  table: 'sales_invoice',
  label: 'Invoice',
  labelPlural: 'Invoices',
  recName: 'number',
  searchFields: ['number', 'reference', 'customerGstin', 'customerId'],
  order: 'id desc',
  fields: {
    number: { type: 'char', label: 'Number', maxLength: 30, readonly: true, unique: true },
    state: { type: 'selection', label: 'Status', options: DOC_STATES, default: 'draft', readonly: true, required: true, index: true },
    customerId: {
      type: 'many2one',
      label: 'Customer',
      relation: 'base.contact',
      required: true,
      filter: { isCustomer: true },
      fill: { placeOfSupply: 'stateCode', customerGstin: 'gstin' },
    },
    customerGstin: { type: 'char', label: 'Customer GSTIN', maxLength: 15, help: 'Leave empty for unregistered (B2C) customers' },
    placeOfSupply: { type: 'selection', label: 'Place of supply', options: IN_STATES, required: true },
    date: { type: 'date', label: 'Invoice date', required: true, default: 'today', index: true },
    dueDate: { type: 'date', label: 'Due date' },
    reference: { type: 'char', label: 'Customer PO / reference', maxLength: 60 },
    warehouseId: { type: 'many2one', label: 'Ship from', relation: 'stock.warehouse', help: 'Defaults to your main warehouse' },
    lines: { type: 'lines', label: 'Items', model: 'sales.invoice_line', inverse: 'invoiceId' },
    notes: { type: 'text', label: 'Notes printed on the invoice' },
    ...gstTotalFields,
    ...paymentFields,
  },
  list: { columns: ['number', 'date', 'customerId', 'totalAmount', 'amountDue', 'paymentState', 'state'] },
  form: {
    layout: 'page',
    summary: 'gst',
    sections: [
      { columns: 3, fields: ['customerId', 'customerGstin', 'placeOfSupply', 'date', 'dueDate', 'reference', 'warehouseId'] },
      { title: 'Items', columns: 1, fields: ['lines'] },
      { title: 'Payment', columns: 3, fields: ['paymentState', 'amountPaid', 'amountDue'] },
      { title: 'Notes', columns: 1, fields: ['notes'] },
    ],
  },
  gst: { placeOfSupplyField: 'placeOfSupply' },
  states: { field: 'state', editable: ['draft'] },
  actions: [
    {
      name: 'post',
      label: 'Post invoice',
      states: ['draft'],
      primary: true,
      confirm: 'Post this invoice? It gets the next invoice number and can no longer be edited.',
    },
    {
      name: 'cancel',
      label: 'Cancel invoice',
      states: ['posted'],
      danger: true,
      confirm: 'Cancel this invoice? It keeps its number and stays on record as cancelled.',
    },
  ],
});

export const CreditNoteLine = defineModel({
  name: 'sales.credit_note_line',
  table: 'sales_credit_note_line',
  label: 'Credit note line',
  labelPlural: 'Credit note lines',
  recName: 'description',
  searchFields: ['description'],
  order: 'sequence asc',
  fields: gstLineFields({ inverse: 'creditNoteId', parent: 'sales.credit_note', parentLabel: 'Credit note', price: 'salePrice' }),
  list: { columns: GST_LINE_COLUMNS },
  form: { sections: [{ fields: ['productId', 'description', 'hsnCode', 'qty', 'uom', 'unitPrice', 'discountPct', 'gstRate'] }] },
});

/** Reduces what a customer owes for a posted invoice (returns, rate corrections, discounts). */
export const CreditNote = defineModel({
  name: 'sales.credit_note',
  table: 'sales_credit_note',
  label: 'Credit note',
  labelPlural: 'Credit notes',
  recName: 'number',
  searchFields: ['number', 'customerGstin', 'customerId'],
  order: 'id desc',
  fields: {
    number: { type: 'char', label: 'Number', maxLength: 30, readonly: true, unique: true },
    state: { type: 'selection', label: 'Status', options: DOC_STATES, default: 'draft', readonly: true, required: true, index: true },
    invoiceId: {
      type: 'many2one',
      label: 'Against invoice',
      relation: 'sales.invoice',
      required: true,
      filter: { state: 'posted' },
      fill: { customerId: 'customerId', customerGstin: 'customerGstin', placeOfSupply: 'placeOfSupply', warehouseId: 'warehouseId' },
    },
    customerId: { type: 'many2one', label: 'Customer', relation: 'base.contact', required: true, filter: { isCustomer: true } },
    customerGstin: { type: 'char', label: 'Customer GSTIN', maxLength: 15 },
    placeOfSupply: { type: 'selection', label: 'Place of supply', options: IN_STATES, required: true },
    date: { type: 'date', label: 'Date', required: true, default: 'today', index: true },
    reason: { type: 'selection', label: 'Reason', options: NOTE_REASONS, required: true, default: 'return' },
    warehouseId: { type: 'many2one', label: 'Return into', relation: 'stock.warehouse', help: 'Used when goods come back' },
    lines: { type: 'lines', label: 'Items', model: 'sales.credit_note_line', inverse: 'creditNoteId' },
    notes: { type: 'text', label: 'Notes printed on the credit note' },
    ...gstTotalFields,
    ...noteSettlementFields,
  },
  list: { columns: ['number', 'date', 'customerId', 'invoiceId', 'reason', 'totalAmount', 'state'] },
  form: {
    layout: 'page',
    summary: 'gst',
    sections: [
      { columns: 3, fields: ['invoiceId', 'customerId', 'customerGstin', 'placeOfSupply', 'date', 'reason', 'warehouseId'] },
      { title: 'Items', columns: 1, fields: ['lines'] },
      { title: 'Settlement', columns: 3, fields: ['amountApplied', 'unappliedAmount'] },
      { title: 'Notes', columns: 1, fields: ['notes'] },
    ],
  },
  gst: { placeOfSupplyField: 'placeOfSupply' },
  states: { field: 'state', editable: ['draft'] },
  actions: [
    { name: 'copyLines', label: 'Copy items from invoice', states: ['draft'] },
    {
      name: 'post',
      label: 'Post credit note',
      states: ['draft'],
      primary: true,
      confirm: 'Post this credit note? It reduces what the customer owes and can no longer be edited.',
    },
    {
      name: 'cancel',
      label: 'Cancel credit note',
      states: ['posted'],
      danger: true,
      confirm: 'Cancel this credit note? The invoice becomes due again and any returned stock goes back out.',
    },
  ],
});

export default defineModule({
  name: 'sales',
  label: 'Sales',
  depends: ['base', 'stock'],
  models: [Invoice, InvoiceLine, CreditNote, CreditNoteLine],
  menus: [
    {
      id: 'sales',
      label: 'Sales',
      icon: 'receipt',
      children: [
        { id: 'sales.invoices', label: 'Invoices', model: 'sales.invoice' },
        { id: 'sales.credit_notes', label: 'Credit notes', model: 'sales.credit_note' },
        { id: 'sales.payments', label: 'Payments received', model: 'account.payment', filter: { direction: 'inbound' } },
        { id: 'sales.receivables', label: 'Receivables', path: '/reports/receivables' },
      ],
    },
  ],
});
