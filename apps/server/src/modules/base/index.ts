import { ACCESS_LEVELS, accessField, AREAS, defineModel, defineModule, type FieldDef } from '@osuite/kernel';
import { IN_STATES } from '@osuite/kernel';

export const UOMS = [
  ['NOS', 'Numbers'],
  ['KGS', 'Kilograms'],
  ['LTR', 'Litres'],
  ['MTR', 'Metres'],
  ['BOX', 'Box'],
  ['HRS', 'Hours'],
] as const;

export const GST_RATES = [
  ['0', '0%'],
  ['0.25', '0.25%'],
  ['3', '3%'],
  ['5', '5%'],
  ['12', '12%'],
  ['18', '18%'],
  ['28', '28%'],
] as const;

export const Contact = defineModel({
  name: 'base.contact',
  table: 'contact',
  label: 'Contact',
  labelPlural: 'Contacts',
  recName: 'name',
  searchFields: ['name', 'email', 'phone', 'gstin', 'city'],
  order: 'name asc',
  fields: {
    name: { type: 'char', label: 'Name', required: true, maxLength: 200, index: true },
    kind: {
      type: 'selection',
      label: 'Type',
      options: [['company', 'Company'], ['person', 'Individual']],
      default: 'company',
      required: true,
    },
    parentId: { type: 'many2one', label: 'Company', relation: 'base.contact', onDelete: 'set null' },
    isCustomer: { type: 'bool', label: 'Customer', default: true },
    isVendor: { type: 'bool', label: 'Vendor' },
    email: { type: 'email', label: 'Email' },
    phone: { type: 'phone', label: 'Phone' },
    gstin: { type: 'char', label: 'GSTIN', maxLength: 15, index: true, help: '15-character GST number' },
    pan: { type: 'char', label: 'PAN', maxLength: 10 },
    street: { type: 'char', label: 'Street' },
    street2: { type: 'char', label: 'Street 2' },
    city: { type: 'char', label: 'City', maxLength: 100 },
    stateCode: { type: 'selection', label: 'State', options: IN_STATES },
    pincode: { type: 'char', label: 'PIN code', maxLength: 10 },
    creditLimit: { type: 'decimal', label: 'Credit limit', scale: 2 },
    paymentTermDays: { type: 'int', label: 'Payment terms (days)', min: 0 },
    notes: { type: 'text', label: 'Notes' },
  },
  list: { columns: ['name', 'kind', 'phone', 'email', 'city', 'stateCode', 'gstin'] },
  form: {
    sections: [
      { fields: ['name', 'kind', 'parentId', 'isCustomer', 'isVendor'] },
      { title: 'Contact', fields: ['email', 'phone'] },
      { title: 'Address', fields: ['street', 'street2', 'city', 'stateCode', 'pincode'] },
      { title: 'Tax & credit', fields: ['gstin', 'pan', 'creditLimit', 'paymentTermDays'] },
      { title: 'Notes', columns: 1, fields: ['notes'] },
    ],
  },
});

export const ProductCategory = defineModel({
  name: 'base.product_category',
  table: 'product_category',
  label: 'Product category',
  labelPlural: 'Product categories',
  recName: 'name',
  searchFields: ['name'],
  order: 'name asc',
  fields: {
    name: { type: 'char', label: 'Name', required: true, maxLength: 120, unique: true },
    parentId: { type: 'many2one', label: 'Parent category', relation: 'base.product_category' },
  },
  list: { columns: ['name', 'parentId'] },
  form: { sections: [{ fields: ['name', 'parentId'] }] },
});

export const Product = defineModel({
  name: 'base.product',
  table: 'product',
  label: 'Product',
  labelPlural: 'Products',
  recName: 'name',
  searchFields: ['name', 'sku', 'barcode', 'hsnCode'],
  order: 'name asc',
  fields: {
    name: { type: 'char', label: 'Name', required: true, maxLength: 200, index: true },
    sku: { type: 'char', label: 'SKU', maxLength: 64, unique: true },
    barcode: { type: 'char', label: 'Barcode', maxLength: 64, index: true },
    kind: {
      type: 'selection',
      label: 'Type',
      options: [['goods', 'Goods (stockable)'], ['consumable', 'Consumable'], ['service', 'Service']],
      default: 'goods',
      required: true,
    },
    categoryId: { type: 'many2one', label: 'Category', relation: 'base.product_category' },
    uom: {
      type: 'selection',
      label: 'Unit',
      options: UOMS,
      default: 'NOS',
      required: true,
    },
    hsnCode: { type: 'char', label: 'HSN / SAC', maxLength: 8 },
    gstRate: {
      type: 'selection',
      label: 'GST rate',
      options: GST_RATES,
      default: '18',
    },
    salePrice: { type: 'decimal', label: 'Sale price', scale: 2, default: '0' },
    costPrice: { type: 'decimal', label: 'Cost price', scale: 2, default: '0' },
    reorderLevel: {
      type: 'decimal',
      label: 'Reorder level',
      scale: 3,
      precision: 16,
      default: '0',
      visibleWhen: { kind: 'goods' },
      help: 'Flag on the dashboard when stock falls to this quantity',
    },
    canSell: { type: 'bool', label: 'Can be sold', default: true },
    canPurchase: { type: 'bool', label: 'Can be purchased', default: true },
    description: { type: 'text', label: 'Description' },
  },
  list: { columns: ['name', 'sku', 'kind', 'categoryId', 'hsnCode', 'gstRate', 'salePrice'] },
  form: {
    sections: [
      { fields: ['name', 'kind', 'sku', 'barcode', 'categoryId', 'uom'] },
      { title: 'Pricing & tax', fields: ['salePrice', 'costPrice', 'hsnCode', 'gstRate'] },
      { title: 'Usage', fields: ['canSell', 'canPurchase', 'reorderLevel'] },
      { title: 'Description', columns: 1, fields: ['description'] },
    ],
  },
});

/** What a group of users may do in each area. Managed by administrators. */
export const Role = defineModel({
  name: 'base.role',
  table: 'base_role',
  label: 'Role',
  labelPlural: 'Roles',
  recName: 'name',
  searchFields: ['name'],
  order: 'name asc',
  fields: {
    name: { type: 'char', label: 'Name', required: true, maxLength: 80, unique: true },
    notes: { type: 'text', label: 'Who it is for' },
    ...Object.fromEntries(
      AREAS.map(([area, label, help]) => [
        accessField(area),
        { type: 'selection', label, options: ACCESS_LEVELS, default: 'view', required: true, help } satisfies FieldDef,
      ]),
    ),
  },
  list: { columns: ['name', ...AREAS.map(([a]) => accessField(a))] },
  form: {
    sections: [
      { fields: ['name', 'notes'] },
      { title: 'What this role may do', columns: 2, fields: AREAS.map(([a]) => accessField(a)) },
    ],
  },
});

export default defineModule({
  name: 'base',
  label: 'Base',
  depends: [],
  models: [Contact, ProductCategory, Product, Role],
  menus: [
    { id: 'contacts', label: 'Contacts', icon: 'users', model: 'base.contact' },
    {
      id: 'products',
      label: 'Products',
      icon: 'package',
      children: [
        { id: 'products.all', label: 'Products', model: 'base.product' },
        { id: 'products.categories', label: 'Categories', model: 'base.product_category' },
      ],
    },
  ],
});
