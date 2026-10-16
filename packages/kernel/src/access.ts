// User roles: what each role may do in each area of the product. Administrators
// may do everything; the server enforces these levels and the UI follows them.

export const AREAS = [
  ['sales', 'Sales', 'Quotations, sales orders, delivery challans, invoices and credit notes'],
  ['purchase', 'Purchases', 'Purchase orders, goods receipts, bills and debit notes'],
  ['inventory', 'Inventory', 'Stock on hand, the stock ledger, adjustments and warehouses'],
  ['masters', 'Contacts & products', 'Customers, vendors, products and categories (everyone can look them up)'],
  ['payments', 'Payments & banking', 'Payments received and made, receivables, payables, credit, bank accounts and reconciliation'],
  ['accounts', 'Accounts & reports', 'Ledger, day book, trial balance, profit & loss, balance sheet, journals and the chart of accounts'],
  ['gst', 'GST', 'GSTR-1, GSTR-3B, e-invoices and e-way bills'],
] as const;

export type Area = (typeof AREAS)[number][0];

export const ACCESS_LEVELS = [
  ['none', 'No access'],
  ['view', 'View only'],
  ['edit', 'Create and post'],
  ['full', 'Full, including cancel'],
] as const;

export type AccessLevel = (typeof ACCESS_LEVELS)[number][0];
export type Access = Record<Area, AccessLevel>;

const RANK: Record<AccessLevel, number> = { none: 0, view: 1, edit: 2, full: 3 };

/** Whether `have` is at least `need`. */
export const allows = (have: AccessLevel | undefined, need: AccessLevel) => RANK[have ?? 'none'] >= RANK[need];

export const FULL_ACCESS: Access = Object.fromEntries(AREAS.map(([a]) => [a, 'full'])) as Access;
export const NO_ACCESS: Access = Object.fromEntries(AREAS.map(([a]) => [a, 'none'])) as Access;

/** The role field holding an area's level, e.g. salesAccess. */
export const accessField = (area: Area) => `${area}Access`;

const PAYMENT_MODELS = new Set([
  'account.payment',
  'account.payment_line',
  'account.settlement',
  'account.bank_account',
  'account.statement',
  'account.statement_line',
]);
const MASTER_MODELS = new Set(['base.contact', 'base.product', 'base.product_category']);

/** The area a model belongs to; null for administrator-only models such as roles. */
export function areaOfModel(model: string): Area | null {
  if (model.startsWith('sales.')) return 'sales';
  if (model.startsWith('purchase.')) return 'purchase';
  if (model.startsWith('stock.')) return 'inventory';
  if (MASTER_MODELS.has(model)) return 'masters';
  if (PAYMENT_MODELS.has(model)) return 'payments';
  if (model.startsWith('account.')) return 'accounts';
  return null;
}

/** Areas of the app's own pages that are not model lists. */
export const PATH_AREAS: Record<string, Area> = {
  '/reports/receivables': 'payments',
  '/reports/payables': 'payments',
  '/bank': 'payments',
  '/reports/ledger': 'accounts',
  '/reports/day-book': 'accounts',
  '/reports/trial-balance': 'accounts',
  '/reports/profit-loss': 'accounts',
  '/reports/balance-sheet': 'accounts',
  '/closing': 'accounts',
  '/reports/gstr-1': 'gst',
  '/reports/gstr-3b': 'gst',
};

/**
 * A user's level for a model. Contacts and products can always be looked up,
 * because every document form picks from them.
 */
export function modelAccess(user: { isAdmin: boolean; access: Access }, model: string): AccessLevel {
  if (user.isAdmin) return 'full';
  const area = areaOfModel(model);
  if (!area) return 'none';
  const level = user.access[area];
  return area === 'masters' && level === 'none' ? 'view' : level;
}

/** Cancelling posted documents (danger actions) needs full access; other actions need edit. */
export const actionLevel = (action: { danger?: boolean }): AccessLevel => (action.danger ? 'full' : 'edit');
