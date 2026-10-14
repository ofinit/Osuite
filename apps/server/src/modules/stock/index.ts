import { defineModel, defineModule, IN_STATES } from '@osuite/kernel';
import { DOC_STATES } from '../gst-document.ts';

export const Warehouse = defineModel({
  name: 'stock.warehouse',
  table: 'stock_warehouse',
  label: 'Warehouse',
  labelPlural: 'Warehouses',
  recName: 'name',
  searchFields: ['name', 'code', 'city'],
  order: 'id asc',
  fields: {
    name: { type: 'char', label: 'Name', required: true, maxLength: 120 },
    code: { type: 'char', label: 'Code', required: true, maxLength: 10, unique: true, help: 'Short code, e.g. MAIN' },
    street: { type: 'char', label: 'Street' },
    city: { type: 'char', label: 'City', maxLength: 100 },
    stateCode: { type: 'selection', label: 'State', options: IN_STATES },
  },
  list: { columns: ['name', 'code', 'city', 'stateCode'] },
  form: { sections: [{ fields: ['name', 'code'] }, { title: 'Address', fields: ['street', 'city', 'stateCode'] }] },
});

/** Current stock per product and warehouse, maintained by stock movements. */
export const Quant = defineModel({
  name: 'stock.quant',
  table: 'stock_quant',
  label: 'Stock on hand',
  labelPlural: 'Stock on hand',
  recName: 'productId',
  searchFields: ['productId', 'warehouseId'],
  readonly: true,
  fields: {
    productId: { type: 'many2one', label: 'Product', relation: 'base.product', required: true },
    warehouseId: { type: 'many2one', label: 'Warehouse', relation: 'stock.warehouse', required: true },
    qty: { type: 'decimal', label: 'On hand', scale: 3, precision: 16, required: true, default: '0' },
    avgCost: { type: 'decimal', label: 'Average cost', scale: 4, precision: 18, required: true, default: '0' },
    value: { type: 'decimal', label: 'Stock value', scale: 2, required: true, default: '0' },
  },
  uniqueTogether: [['productId', 'warehouseId']],
  list: { columns: ['productId', 'warehouseId', 'qty', 'avgCost', 'value'] },
  form: { sections: [{ fields: ['productId', 'warehouseId', 'qty', 'avgCost', 'value'] }] },
});

/** Immutable stock ledger. Cancellations add reversing movements. */
export const Move = defineModel({
  name: 'stock.move',
  table: 'stock_move',
  label: 'Stock movement',
  labelPlural: 'Stock movements',
  recName: 'reference',
  searchFields: ['reference', 'productId'],
  order: 'id desc',
  readonly: true,
  fields: {
    date: { type: 'date', label: 'Date', required: true, index: true },
    reference: { type: 'char', label: 'Reference', maxLength: 60, required: true, index: true },
    kind: {
      type: 'selection',
      label: 'Type',
      required: true,
      options: [
        ['purchase', 'Purchase'],
        ['sale', 'Sale'],
        ['opening', 'Opening stock'],
        ['adjustment', 'Adjustment'],
        ['return', 'Return'],
        ['reversal', 'Reversal'],
      ],
    },
    productId: { type: 'many2one', label: 'Product', relation: 'base.product', required: true },
    warehouseId: { type: 'many2one', label: 'Warehouse', relation: 'stock.warehouse', required: true },
    qty: { type: 'decimal', label: 'Qty', scale: 3, precision: 16, required: true },
    unitCost: { type: 'decimal', label: 'Unit cost', scale: 4, precision: 18, required: true },
    value: { type: 'decimal', label: 'Value', scale: 2, required: true },
    balanceQty: { type: 'decimal', label: 'Balance', scale: 3, precision: 16, required: true },
    refModel: { type: 'char', label: 'Source model', maxLength: 60, required: true },
    refId: { type: 'int', label: 'Source id', required: true },
    reversedById: { type: 'many2one', label: 'Reversed by', relation: 'stock.move' },
  },
  list: { columns: ['date', 'reference', 'kind', 'productId', 'warehouseId', 'qty', 'unitCost', 'value', 'balanceQty'] },
  form: { sections: [{ fields: ['date', 'reference', 'kind', 'productId', 'warehouseId', 'qty', 'unitCost', 'value', 'balanceQty'] }] },
});

export const AdjustmentLine = defineModel({
  name: 'stock.adjustment_line',
  table: 'stock_adjustment_line',
  label: 'Adjustment line',
  labelPlural: 'Adjustment lines',
  recName: 'productId',
  searchFields: [],
  order: 'sequence asc',
  fields: {
    adjustmentId: { type: 'many2one', label: 'Adjustment', relation: 'stock.adjustment', onDelete: 'cascade' },
    sequence: { type: 'int', label: 'No.', readonly: true },
    productId: {
      type: 'many2one',
      label: 'Product',
      relation: 'base.product',
      required: true,
      filter: { kind: 'goods' },
      fill: { unitCost: 'costPrice' },
    },
    qty: { type: 'decimal', label: 'Qty change (+/−)', scale: 3, precision: 14, required: true },
    unitCost: { type: 'decimal', label: 'Unit cost', scale: 2, help: 'Used when adding stock' },
    note: { type: 'char', label: 'Note', maxLength: 200 },
  },
  list: { columns: ['productId', 'qty', 'unitCost', 'note'] },
  form: { sections: [{ fields: ['productId', 'qty', 'unitCost', 'note'] }] },
});

export const Adjustment = defineModel({
  name: 'stock.adjustment',
  table: 'stock_adjustment',
  label: 'Stock adjustment',
  labelPlural: 'Stock adjustments',
  recName: 'number',
  searchFields: ['number', 'notes'],
  order: 'id desc',
  fields: {
    number: { type: 'char', label: 'Number', maxLength: 30, readonly: true, unique: true },
    state: { type: 'selection', label: 'Status', options: DOC_STATES, default: 'draft', readonly: true, required: true, index: true },
    warehouseId: { type: 'many2one', label: 'Warehouse', relation: 'stock.warehouse', help: 'Defaults to your main warehouse' },
    date: { type: 'date', label: 'Date', required: true, default: 'today' },
    reason: {
      type: 'selection',
      label: 'Reason',
      required: true,
      default: 'count',
      options: [
        ['opening', 'Opening stock'],
        ['count', 'Physical count'],
        ['damage', 'Damage or loss'],
        ['other', 'Other'],
      ],
    },
    lines: { type: 'lines', label: 'Products', model: 'stock.adjustment_line', inverse: 'adjustmentId' },
    notes: { type: 'text', label: 'Notes' },
  },
  list: { columns: ['number', 'date', 'reason', 'warehouseId', 'state'] },
  form: {
    layout: 'page',
    sections: [
      { columns: 3, fields: ['warehouseId', 'date', 'reason'] },
      { title: 'Products', columns: 1, fields: ['lines'] },
      { title: 'Notes', columns: 1, fields: ['notes'] },
    ],
  },
  states: { field: 'state', editable: ['draft'] },
  actions: [
    {
      name: 'post',
      label: 'Post adjustment',
      states: ['draft'],
      primary: true,
      confirm: 'Post this adjustment? Stock is updated and the adjustment can no longer be edited.',
    },
    {
      name: 'cancel',
      label: 'Cancel adjustment',
      states: ['posted'],
      danger: true,
      confirm: 'Cancel this adjustment? Its stock changes are reversed.',
    },
  ],
});

export default defineModule({
  name: 'stock',
  label: 'Inventory',
  depends: ['base'],
  models: [Warehouse, Quant, Move, Adjustment, AdjustmentLine],
  menus: [
    {
      id: 'stock',
      label: 'Inventory',
      icon: 'warehouse',
      children: [
        { id: 'stock.quants', label: 'Stock on hand', model: 'stock.quant' },
        { id: 'stock.moves', label: 'Stock ledger', model: 'stock.move' },
        { id: 'stock.adjustments', label: 'Adjustments', model: 'stock.adjustment' },
        { id: 'stock.warehouses', label: 'Warehouses', model: 'stock.warehouse' },
      ],
    },
  ],
});
