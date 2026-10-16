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
  fields: {
    ...gstLineFields({ inverse: 'billId', parent: 'purchase.bill', parentLabel: 'Bill', price: 'costPrice' }),
    orderLineId: { type: 'many2one', label: 'Order line', relation: 'purchase.order_line', readonly: true, onDelete: 'set null' },
    // Goods already taken into stock on a goods receipt: the bill clears their value instead.
    stockDone: { type: 'bool', label: 'Received on receipt', readonly: true, default: false },
    receivedValue: { type: 'decimal', label: 'Received value', scale: 2, readonly: true, default: '0' },
  },
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
    orderId: { type: 'many2one', label: 'Purchase order', relation: 'purchase.order', readonly: true, onDelete: 'set null' },
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
      { columns: 3, fields: ['vendorId', 'vendorGstin', 'vendorState', 'vendorBillNo', 'date', 'dueDate', 'warehouseId', 'orderId'] },
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

export const ORDER_STATES = [
  ['draft', 'Draft'],
  ['confirmed', 'Confirmed'],
  ['done', 'Completed'],
  ['cancelled', 'Cancelled'],
] as const;

export const PROGRESS = [
  ['none', 'Not yet'],
  ['partial', 'Partly'],
  ['full', 'Fully'],
] as const;

export const OrderLine = defineModel({
  name: 'purchase.order_line',
  table: 'purchase_order_line',
  label: 'Order line',
  labelPlural: 'Order lines',
  recName: 'description',
  searchFields: ['description'],
  order: 'sequence asc',
  fields: {
    ...gstLineFields({ inverse: 'orderId', parent: 'purchase.order', parentLabel: 'Purchase order', price: 'costPrice' }),
    qtyDelivered: { type: 'decimal', label: 'Received', scale: 3, precision: 14, readonly: true, default: '0' },
    qtyInvoiced: { type: 'decimal', label: 'Billed', scale: 3, precision: 14, readonly: true, default: '0' },
  },
  list: { columns: [...GST_LINE_COLUMNS, 'qtyDelivered', 'qtyInvoiced'] },
  form: { sections: [{ fields: ['productId', 'description', 'hsnCode', 'qty', 'uom', 'unitPrice', 'discountPct', 'gstRate'] }] },
});

/**
 * What you ordered from a vendor. Goods arrive on goods receipts (or with the
 * bill) and are billed at once or in parts; the order tracks both. It never
 * touches the books itself.
 */
export const Order = defineModel({
  name: 'purchase.order',
  table: 'purchase_order',
  label: 'Purchase order',
  labelPlural: 'Purchase orders',
  recName: 'number',
  searchFields: ['number', 'reference', 'vendorId'],
  order: 'id desc',
  fields: {
    number: { type: 'char', label: 'Number', maxLength: 30, readonly: true, unique: true },
    state: { type: 'selection', label: 'Status', options: ORDER_STATES, default: 'draft', readonly: true, required: true, index: true },
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
    date: { type: 'date', label: 'Order date', required: true, default: 'today', index: true },
    deliverBy: { type: 'date', label: 'Expected by' },
    reference: { type: 'char', label: 'Vendor quotation / reference', maxLength: 60 },
    placeOfSupply: { type: 'selection', label: 'Place of supply', options: IN_STATES, help: 'Defaults to your state' },
    warehouseId: { type: 'many2one', label: 'Receive into', relation: 'stock.warehouse', help: 'Defaults to your main warehouse' },
    deliveryStatus: {
      type: 'selection',
      label: 'Received',
      options: PROGRESS,
      default: 'none',
      readonly: true,
      badge: true,
      visibleWhen: { state: ['confirmed', 'done'] },
    },
    invoiceStatus: {
      type: 'selection',
      label: 'Billed',
      options: PROGRESS,
      default: 'none',
      readonly: true,
      badge: true,
      visibleWhen: { state: ['confirmed', 'done'] },
    },
    lines: { type: 'lines', label: 'Items', model: 'purchase.order_line', inverse: 'orderId' },
    notes: { type: 'text', label: 'Notes printed on the order' },
    ...gstTotalFields,
  },
  list: { columns: ['number', 'date', 'vendorId', 'deliverBy', 'totalAmount', 'deliveryStatus', 'invoiceStatus', 'state'] },
  form: {
    layout: 'page',
    summary: 'gst',
    sections: [
      { columns: 3, fields: ['vendorId', 'vendorGstin', 'vendorState', 'date', 'deliverBy', 'reference', 'warehouseId'] },
      { title: 'Items', columns: 1, fields: ['lines'] },
      { title: 'Progress', columns: 3, fields: ['deliveryStatus', 'invoiceStatus'] },
      { title: 'Notes', columns: 1, fields: ['notes'] },
    ],
  },
  gst: { placeOfSupplyField: 'placeOfSupply', supplierStateField: 'vendorState' },
  states: { field: 'state', editable: ['draft'] },
  actions: [
    { name: 'confirm', label: 'Confirm order', states: ['draft'], primary: true, confirm: 'Confirm this purchase order? It gets the next order number and is locked.' },
    { name: 'createReceipt', label: 'Receive goods', states: ['confirmed'], primary: true },
    { name: 'createBill', label: 'Create bill', states: ['confirmed'] },
    {
      name: 'cancel',
      label: 'Cancel order',
      states: ['draft', 'confirmed'],
      danger: true,
      confirm: 'Cancel this order? Nothing may have been received or billed on it yet.',
    },
  ],
});

export const ReceiptLine = defineModel({
  name: 'purchase.receipt_line',
  table: 'purchase_receipt_line',
  label: 'Receipt line',
  labelPlural: 'Receipt lines',
  recName: 'description',
  searchFields: ['description'],
  order: 'sequence asc',
  fields: {
    ...gstLineFields({ inverse: 'receiptId', parent: 'purchase.receipt', parentLabel: 'Goods receipt', price: 'costPrice' }),
    orderLineId: { type: 'many2one', label: 'Order line', relation: 'purchase.order_line', readonly: true, onDelete: 'set null' },
    // What the goods added to stock, cleared when they are billed.
    stockValue: { type: 'decimal', label: 'Stock value', scale: 2, readonly: true, default: '0' },
  },
  list: { columns: GST_LINE_COLUMNS },
  form: { sections: [{ fields: ['productId', 'description', 'hsnCode', 'qty', 'uom', 'unitPrice', 'discountPct', 'gstRate'] }] },
});

/**
 * Goods receipt note: goods come into stock before the vendor's bill. Posting
 * adds the stock at the order's net rate against "Goods received, not
 * billed"; the bill made from it clears that account instead of adding stock.
 */
export const Receipt = defineModel({
  name: 'purchase.receipt',
  table: 'purchase_receipt',
  label: 'Goods receipt',
  labelPlural: 'Goods receipts',
  recName: 'number',
  searchFields: ['number', 'vendorChallanNo', 'vendorId'],
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
    placeOfSupply: { type: 'selection', label: 'Place of supply', options: IN_STATES, help: 'Defaults to your state' },
    date: { type: 'date', label: 'Received on', required: true, default: 'today', index: true },
    vendorChallanNo: { type: 'char', label: 'Vendor challan no.', maxLength: 40 },
    warehouseId: { type: 'many2one', label: 'Receive into', relation: 'stock.warehouse', help: 'Defaults to your main warehouse' },
    orderId: { type: 'many2one', label: 'Purchase order', relation: 'purchase.order', readonly: true, onDelete: 'set null' },
    billId: { type: 'many2one', label: 'Bill', relation: 'purchase.bill', readonly: true, onDelete: 'set null' },
    lines: { type: 'lines', label: 'Items', model: 'purchase.receipt_line', inverse: 'receiptId' },
    notes: { type: 'text', label: 'Notes' },
    ...gstTotalFields,
  },
  list: { columns: ['number', 'date', 'vendorId', 'vendorChallanNo', 'orderId', 'billId', 'state'] },
  form: {
    layout: 'page',
    summary: 'gst',
    sections: [
      { columns: 3, fields: ['vendorId', 'vendorGstin', 'vendorState', 'date', 'vendorChallanNo', 'warehouseId', 'orderId', 'billId'] },
      { title: 'Items', columns: 1, fields: ['lines'] },
      { title: 'Notes', columns: 1, fields: ['notes'] },
    ],
  },
  gst: { placeOfSupplyField: 'placeOfSupply', supplierStateField: 'vendorState' },
  states: { field: 'state', editable: ['draft'] },
  actions: [
    { name: 'post', label: 'Post receipt', states: ['draft'], primary: true, confirm: 'Post this receipt? The goods come into stock and the receipt can no longer be edited.' },
    { name: 'createBill', label: 'Create bill', states: ['posted'], primary: true },
    { name: 'cancel', label: 'Cancel receipt', states: ['posted'], danger: true, confirm: 'Cancel this receipt? The goods go back out of stock.' },
  ],
});

export default defineModule({
  name: 'purchase',
  label: 'Purchases',
  depends: ['base', 'stock'],
  models: [Order, OrderLine, Receipt, ReceiptLine, Bill, BillLine, DebitNote, DebitNoteLine],
  menus: [
    {
      id: 'purchase',
      label: 'Purchases',
      icon: 'cart',
      children: [
        { id: 'purchase.orders', label: 'Purchase orders', model: 'purchase.order' },
        { id: 'purchase.receipts', label: 'Goods receipts', model: 'purchase.receipt' },
        { id: 'purchase.bills', label: 'Bills', model: 'purchase.bill' },
        { id: 'purchase.debit_notes', label: 'Debit notes', model: 'purchase.debit_note' },
        { id: 'purchase.payments', label: 'Payments made', model: 'account.payment', filter: { direction: 'outbound' } },
        { id: 'purchase.payables', label: 'Payables', path: '/reports/payables' },
      ],
    },
  ],
});
