import { defineModel, defineModule } from '@osuite/kernel';
import { DOC_STATES } from '../gst-document.ts';

export const ACCOUNT_TYPES = [
  ['asset', 'Asset'],
  ['liability', 'Liability'],
  ['equity', 'Equity'],
  ['income', 'Income'],
  ['expense', 'Expense'],
] as const;

export const Account = defineModel({
  name: 'account.account',
  table: 'account_account',
  label: 'Account',
  labelPlural: 'Chart of accounts',
  recName: 'name',
  searchFields: ['code', 'name'],
  order: 'code asc',
  fields: {
    code: { type: 'char', label: 'Code', required: true, maxLength: 10, unique: true },
    name: { type: 'char', label: 'Name', required: true, maxLength: 120 },
    type: { type: 'selection', label: 'Type', required: true, options: ACCOUNT_TYPES, index: true },
    /** Fixed role used by automatic postings (receivable, sales, output_cgst...). */
    key: { type: 'char', label: 'System role', maxLength: 30, readonly: true, unique: true },
    notes: { type: 'text', label: 'Notes' },
  },
  list: { columns: ['code', 'name', 'type', 'key'] },
  form: { sections: [{ fields: ['code', 'name', 'type', 'key'] }, { title: 'Notes', columns: 1, fields: ['notes'] }] },
});

export const EntryLine = defineModel({
  name: 'account.entry_line',
  table: 'account_entry_line',
  label: 'Journal item',
  labelPlural: 'Journal items',
  recName: 'accountId',
  searchFields: ['accountId', 'partnerId'],
  order: 'id asc',
  readonly: true,
  fields: {
    entryId: { type: 'many2one', label: 'Entry', relation: 'account.entry', onDelete: 'cascade' },
    sequence: { type: 'int', label: 'No.', readonly: true },
    date: { type: 'date', label: 'Date', required: true, index: true },
    accountId: { type: 'many2one', label: 'Account', relation: 'account.account', required: true },
    partnerId: { type: 'many2one', label: 'Party', relation: 'base.contact' },
    debit: { type: 'decimal', label: 'Debit', scale: 2, required: true, default: '0' },
    credit: { type: 'decimal', label: 'Credit', scale: 2, required: true, default: '0' },
  },
  list: { columns: ['date', 'entryId', 'accountId', 'partnerId', 'debit', 'credit'] },
  form: { sections: [{ fields: ['date', 'entryId', 'accountId', 'partnerId', 'debit', 'credit'] }] },
});

/** Journal entry, posted automatically from documents. Never edited; cancellations reverse it. */
export const Entry = defineModel({
  name: 'account.entry',
  table: 'account_entry',
  label: 'Journal entry',
  labelPlural: 'Journal entries',
  recName: 'number',
  searchFields: ['number', 'reference', 'narration'],
  order: 'id desc',
  readonly: true,
  fields: {
    number: { type: 'char', label: 'Number', maxLength: 30, required: true, unique: true },
    date: { type: 'date', label: 'Date', required: true, index: true },
    reference: { type: 'char', label: 'Reference', maxLength: 60, required: true, index: true },
    narration: { type: 'char', label: 'Narration', maxLength: 200 },
    refModel: { type: 'char', label: 'Source model', maxLength: 60, required: true },
    refId: { type: 'int', label: 'Source id', required: true },
    amount: { type: 'decimal', label: 'Amount', scale: 2, required: true },
    reversedById: { type: 'many2one', label: 'Reversed by', relation: 'account.entry' },
    lines: { type: 'lines', label: 'Lines', model: 'account.entry_line', inverse: 'entryId' },
  },
  list: { columns: ['number', 'date', 'reference', 'narration', 'amount'] },
  form: {
    layout: 'page',
    sections: [{ columns: 3, fields: ['number', 'date', 'reference', 'narration', 'amount', 'reversedById'] }, { title: 'Lines', columns: 1, fields: ['lines'] }],
  },
});

export const ManualJournalLine = defineModel({
  name: 'account.manual_line',
  table: 'account_manual_line',
  label: 'Journal line',
  labelPlural: 'Journal lines',
  recName: 'accountId',
  searchFields: [],
  order: 'sequence asc',
  fields: {
    journalId: { type: 'many2one', label: 'Journal', relation: 'account.manual', onDelete: 'cascade' },
    sequence: { type: 'int', label: 'No.', readonly: true },
    accountId: { type: 'many2one', label: 'Account', relation: 'account.account', required: true },
    partnerId: { type: 'many2one', label: 'Party', relation: 'base.contact' },
    label: { type: 'char', label: 'Description', maxLength: 200 },
    debit: { type: 'decimal', label: 'Debit', scale: 2, default: '0' },
    credit: { type: 'decimal', label: 'Credit', scale: 2, default: '0' },
  },
  list: { columns: ['accountId', 'partnerId', 'label', 'debit', 'credit'] },
  form: { sections: [{ fields: ['accountId', 'partnerId', 'label', 'debit', 'credit'] }] },
});

/** Journal entries entered by hand: salaries, rent, depreciation, corrections. */
export const ManualJournal = defineModel({
  name: 'account.manual',
  table: 'account_manual',
  label: 'Manual journal',
  labelPlural: 'Manual journals',
  recName: 'number',
  searchFields: ['number', 'narration', 'reference'],
  order: 'id desc',
  fields: {
    number: { type: 'char', label: 'Number', maxLength: 30, readonly: true, unique: true },
    state: { type: 'selection', label: 'Status', options: DOC_STATES, default: 'draft', readonly: true, required: true, index: true },
    date: { type: 'date', label: 'Date', required: true, default: 'today', index: true },
    reference: { type: 'char', label: 'Reference', maxLength: 60 },
    narration: { type: 'char', label: 'Narration', required: true, maxLength: 200 },
    lines: { type: 'lines', label: 'Lines', model: 'account.manual_line', inverse: 'journalId' },
    totalDebit: { type: 'decimal', label: 'Total debit', scale: 2, readonly: true, default: '0' },
    totalCredit: { type: 'decimal', label: 'Total credit', scale: 2, readonly: true, default: '0' },
  },
  list: { columns: ['number', 'date', 'narration', 'totalDebit', 'state'] },
  form: {
    layout: 'page',
    summary: 'balance',
    sections: [
      { columns: 3, fields: ['date', 'reference', 'narration'] },
      { title: 'Lines', columns: 1, fields: ['lines'] },
    ],
  },
  states: { field: 'state', editable: ['draft'] },
  actions: [
    { name: 'post', label: 'Post journal', states: ['draft'], primary: true, confirm: 'Post this journal to the books? It can no longer be edited.' },
    { name: 'cancel', label: 'Cancel journal', states: ['posted'], danger: true, confirm: 'Cancel this journal? A reversing entry is posted today.' },
  ],
});

/** A bank account you hold; its money moves through its own ledger account. */
export const BankAccount = defineModel({
  name: 'account.bank_account',
  table: 'account_bank_account',
  label: 'Bank account',
  labelPlural: 'Bank accounts',
  recName: 'name',
  searchFields: ['name', 'bankName', 'accountNumber'],
  order: 'id asc',
  fields: {
    name: { type: 'char', label: 'Name', required: true, maxLength: 120, help: 'e.g. HDFC current account' },
    bankName: { type: 'char', label: 'Bank', maxLength: 120 },
    accountNumber: { type: 'char', label: 'Account number', maxLength: 30 },
    ifsc: { type: 'char', label: 'IFSC', maxLength: 11 },
    ledgerAccountId: {
      type: 'many2one',
      label: 'Ledger account',
      relation: 'account.account',
      required: true,
      filter: { type: 'asset' },
      help: 'Where this bank’s money is booked',
    },
  },
  list: { columns: ['name', 'bankName', 'accountNumber', 'ledgerAccountId'] },
  form: { sections: [{ fields: ['name', 'bankName', 'accountNumber', 'ifsc', 'ledgerAccountId'] }] },
});

export const StatementLine = defineModel({
  name: 'account.statement_line',
  table: 'account_statement_line',
  label: 'Statement line',
  labelPlural: 'Statement lines',
  recName: 'description',
  searchFields: ['description', 'reference'],
  order: 'sequence asc',
  readonly: true,
  fields: {
    statementId: { type: 'many2one', label: 'Statement', relation: 'account.statement', onDelete: 'cascade' },
    sequence: { type: 'int', label: 'No.', readonly: true },
    bankAccountId: { type: 'many2one', label: 'Bank account', relation: 'account.bank_account', required: true },
    date: { type: 'date', label: 'Date', required: true, index: true },
    description: { type: 'char', label: 'Description', required: true, maxLength: 300 },
    reference: { type: 'char', label: 'Reference', maxLength: 80 },
    amount: { type: 'decimal', label: 'Amount', scale: 2, required: true },
    balance: { type: 'decimal', label: 'Balance', scale: 2 },
    /** Identifies the line across imports so overlapping statements are not doubled. */
    fingerprint: { type: 'char', label: 'Fingerprint', maxLength: 64, required: true },
    entryLineId: { type: 'many2one', label: 'Matched entry', relation: 'account.entry_line', unique: true, onDelete: 'set null' },
  },
  uniqueTogether: [['bankAccountId', 'fingerprint']],
  list: { columns: ['date', 'description', 'reference', 'amount', 'balance'] },
  form: { sections: [{ fields: ['date', 'description', 'reference', 'amount', 'balance'] }] },
});

/** An imported bank statement; reconciled line by line against the books. */
export const Statement = defineModel({
  name: 'account.statement',
  table: 'account_statement',
  label: 'Bank statement',
  labelPlural: 'Bank statements',
  recName: 'name',
  searchFields: ['name'],
  order: 'id desc',
  readonly: true,
  fields: {
    name: { type: 'char', label: 'Statement', required: true, maxLength: 160 },
    bankAccountId: { type: 'many2one', label: 'Bank account', relation: 'account.bank_account', required: true },
    dateFrom: { type: 'date', label: 'From', required: true },
    dateTo: { type: 'date', label: 'To', required: true },
    closingBalance: { type: 'decimal', label: 'Closing balance (bank)', scale: 2 },
    lineCount: { type: 'int', label: 'Lines', required: true, default: 0 },
    lines: { type: 'lines', label: 'Lines', model: 'account.statement_line', inverse: 'statementId' },
  },
  list: { columns: ['name', 'bankAccountId', 'dateFrom', 'dateTo', 'lineCount', 'closingBalance'] },
  form: { layout: 'page', sections: [{ columns: 3, fields: ['bankAccountId', 'dateFrom', 'dateTo', 'closingBalance', 'lineCount'] }, { title: 'Lines', columns: 1, fields: ['lines'] }] },
});

/** Credit (advance or note) applied to an invoice or bill after both were posted. */
export const Settlement = defineModel({
  name: 'account.settlement',
  table: 'account_settlement',
  label: 'Credit application',
  labelPlural: 'Credit applications',
  recName: 'docNumber',
  searchFields: ['sourceNumber', 'docNumber', 'partnerId'],
  order: 'id desc',
  readonly: true,
  fields: {
    date: { type: 'date', label: 'Date', required: true },
    direction: { type: 'selection', label: 'Side', required: true, options: [['inbound', 'Customer'], ['outbound', 'Vendor']] },
    partnerId: { type: 'many2one', label: 'Party', relation: 'base.contact', required: true },
    sourceModel: { type: 'char', label: 'Credit from', maxLength: 60, required: true },
    sourceId: { type: 'int', label: 'Credit id', required: true },
    sourceNumber: { type: 'char', label: 'Credit', maxLength: 30, required: true },
    docModel: { type: 'char', label: 'Applied to', maxLength: 60, required: true },
    docId: { type: 'int', label: 'Document id', required: true },
    docNumber: { type: 'char', label: 'Document', maxLength: 30, required: true },
    amount: { type: 'decimal', label: 'Amount', scale: 2, required: true },
    state: { type: 'selection', label: 'Status', required: true, badge: true, options: [['active', 'Applied'], ['reversed', 'Reversed']] },
  },
  list: { columns: ['date', 'partnerId', 'sourceNumber', 'docNumber', 'amount', 'state'] },
  form: { sections: [{ fields: ['date', 'partnerId', 'sourceNumber', 'docNumber', 'amount', 'state'] }] },
});

/** A financial year's closing (see closing.ts). */
export const YearClose = defineModel({
  name: 'account.year_close',
  table: 'account_year_close',
  label: 'Year-end closing',
  labelPlural: 'Year-end closings',
  recName: 'fy',
  searchFields: ['fy'],
  order: 'id desc',
  readonly: true,
  fields: {
    fy: { type: 'char', label: 'Financial year', maxLength: 5, required: true, index: true },
    dateFrom: { type: 'date', label: 'From', required: true },
    dateTo: { type: 'date', label: 'To', required: true },
    profit: { type: 'decimal', label: 'Profit', scale: 2, required: true },
    entryId: { type: 'many2one', label: 'Closing entry', relation: 'account.entry' },
    state: { type: 'selection', label: 'Status', required: true, options: [['closing', 'Closing'], ['closed', 'Closed'], ['reopened', 'Reopened']] },
  },
  list: { columns: ['fy', 'dateFrom', 'dateTo', 'profit', 'state'] },
  form: { sections: [{ fields: ['fy', 'dateFrom', 'dateTo', 'profit', 'entryId', 'state'] }] },
});

export const PaymentLine = defineModel({
  name: 'account.payment_line',
  table: 'account_payment_line',
  label: 'Allocation',
  labelPlural: 'Allocations',
  recName: 'amount',
  searchFields: [],
  order: 'sequence asc',
  fields: {
    paymentId: { type: 'many2one', label: 'Payment', relation: 'account.payment', onDelete: 'cascade' },
    sequence: { type: 'int', label: 'No.', readonly: true },
    invoiceId: {
      type: 'many2one',
      label: 'Invoice',
      relation: 'sales.invoice',
      filter: { state: 'posted' },
      visibleWhen: { direction: 'inbound' },
    },
    billId: {
      type: 'many2one',
      label: 'Bill',
      relation: 'purchase.bill',
      filter: { state: 'posted' },
      visibleWhen: { direction: 'outbound' },
    },
    amount: { type: 'decimal', label: 'Amount', scale: 2, required: true },
  },
  list: { columns: ['invoiceId', 'billId', 'amount'] },
  form: { sections: [{ fields: ['invoiceId', 'billId', 'amount'] }] },
});

export const Payment = defineModel({
  name: 'account.payment',
  table: 'account_payment',
  label: 'Payment',
  labelPlural: 'Payments',
  recName: 'number',
  searchFields: ['number', 'reference', 'partnerId'],
  order: 'id desc',
  fields: {
    number: { type: 'char', label: 'Number', maxLength: 30, readonly: true, unique: true },
    state: { type: 'selection', label: 'Status', options: DOC_STATES, default: 'draft', readonly: true, required: true, index: true },
    direction: {
      type: 'selection',
      label: 'Type',
      required: true,
      default: 'inbound',
      index: true,
      options: [
        ['inbound', 'Received from customer'],
        ['outbound', 'Paid to vendor'],
      ],
    },
    partnerId: { type: 'many2one', label: 'Party', relation: 'base.contact', required: true },
    date: { type: 'date', label: 'Date', required: true, default: 'today', index: true },
    amount: { type: 'decimal', label: 'Amount', scale: 2, required: true },
    mode: {
      type: 'selection',
      label: 'Mode',
      required: true,
      default: 'bank',
      options: [
        ['bank', 'Bank transfer (NEFT/RTGS/IMPS)'],
        ['upi', 'UPI'],
        ['cash', 'Cash'],
        ['cheque', 'Cheque'],
        ['card', 'Card'],
      ],
    },
    reference: { type: 'char', label: 'UTR / cheque no.', maxLength: 60 },
    bankAccountId: {
      type: 'many2one',
      label: 'Bank account',
      relation: 'account.bank_account',
      help: 'Defaults to your first bank account',
      visibleWhen: { mode: ['bank', 'upi', 'cheque', 'card'] },
    },
    lines: { type: 'lines', label: 'Allocations', model: 'account.payment_line', inverse: 'paymentId' },
    allocatedAmount: { type: 'decimal', label: 'Allocated', scale: 2, readonly: true, default: '0' },
    unallocatedAmount: { type: 'decimal', label: 'Advance (not allocated)', scale: 2, readonly: true, default: '0' },
    notes: { type: 'text', label: 'Notes' },
  },
  list: { columns: ['number', 'date', 'partnerId', 'mode', 'amount', 'unallocatedAmount', 'state'] },
  form: {
    layout: 'page',
    sections: [
      { columns: 3, fields: ['direction', 'partnerId', 'date', 'amount', 'mode', 'reference', 'bankAccountId'] },
      { title: 'Allocations', columns: 1, fields: ['lines'] },
      { columns: 3, fields: ['allocatedAmount', 'unallocatedAmount'] },
      { title: 'Notes', columns: 1, fields: ['notes'] },
    ],
  },
  states: { field: 'state', editable: ['draft'] },
  actions: [
    { name: 'allocate', label: 'Allocate to oldest dues', states: ['draft'] },
    {
      name: 'post',
      label: 'Post payment',
      states: ['draft'],
      primary: true,
      confirm: 'Post this payment? Allocated invoices or bills are marked as paid and the payment can no longer be edited.',
    },
    {
      name: 'cancel',
      label: 'Cancel payment',
      states: ['posted'],
      danger: true,
      confirm: 'Cancel this payment? Its allocations are reversed and the documents become due again.',
    },
  ],
});

export default defineModule({
  name: 'account',
  label: 'Accounting',
  depends: ['sales', 'purchase'],
  models: [Payment, PaymentLine, Account, Entry, EntryLine, ManualJournal, ManualJournalLine, BankAccount, Statement, StatementLine, Settlement, YearClose],
  // Payment menus live under Sales and Purchases, filtered by direction.
  menus: [
    {
      id: 'accounting',
      label: 'Accounting',
      icon: 'book',
      children: [
        { id: 'accounting.ledger', label: 'Ledger', path: '/reports/ledger' },
        { id: 'accounting.daybook', label: 'Day book', path: '/reports/day-book' },
        { id: 'accounting.tb', label: 'Trial balance', path: '/reports/trial-balance' },
        { id: 'accounting.pl', label: 'Profit & loss', path: '/reports/profit-loss' },
        { id: 'accounting.bs', label: 'Balance sheet', path: '/reports/balance-sheet' },
        { id: 'accounting.gstr3b', label: 'GSTR-3B', path: '/reports/gstr-3b' },
        { id: 'accounting.gstr1', label: 'GSTR-1', path: '/reports/gstr-1' },
        { id: 'accounting.bank', label: 'Bank reconciliation', path: '/bank' },
        { id: 'accounting.closing', label: 'Year-end closing', path: '/closing' },
        { id: 'accounting.settlements', label: 'Credit applications', model: 'account.settlement' },
        { id: 'accounting.manual', label: 'Manual journals', model: 'account.manual' },
        { id: 'accounting.entries', label: 'Journal entries', model: 'account.entry' },
        { id: 'accounting.accounts', label: 'Chart of accounts', model: 'account.account' },
        { id: 'accounting.bank_accounts', label: 'Bank accounts', model: 'account.bank_account' },
      ],
    },
  ],
});
