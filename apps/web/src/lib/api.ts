import type {
  AuditEntry,
  Company,
  StatementRow,
  LicenseStatus,
  Many2oneValue,
  Metadata,
  RecordData,
  SearchParams,
  SearchResult,
  SessionUser,
} from '@osuite/kernel';

const TOKEN_KEY = 'osuite.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // storage unavailable: session lasts for this page only
  }
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fieldErrors: Record<string, string> = {},
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown, file?: Blob): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  if (file) headers['content-type'] = 'application/octet-stream';
  else if (body !== undefined) headers['content-type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: file ?? (body === undefined ? undefined : JSON.stringify(body)) });
  } catch {
    throw new ApiError(0, 'Cannot reach the OSuite server. Check that it is running.');
  }
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token && path !== '/auth/login') {
      setToken(null);
      window.location.assign('/');
    }
    throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.fieldErrors ?? {});
  }
  return data as T;
}

function qs(p: SearchParams): string {
  const u = new URLSearchParams();
  if (p.q) u.set('q', p.q);
  if (p.sort) u.set('sort', p.sort);
  if (p.limit) u.set('limit', String(p.limit));
  if (p.offset) u.set('offset', String(p.offset));
  if (p.includeArchived) u.set('archived', 'true');
  for (const [k, v] of Object.entries(p.filters ?? {})) u.set(`f.${k}`, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

export type { Company };

export interface Dashboard {
  asOf: string;
  fy: string;
  sales: { today: string; month: string; lastMonthToDate: string; fy: string };
  purchasesMonth: string;
  profitFy: string;
  cash: { accounts: { accountId: number; name: string; balance: string }[]; total: string };
  receivable: {
    total: string;
    overdue: string;
    advance: string;
    overdueInvoices: { id: number; number: string; partner: string; amountDue: string; daysOverdue: number }[];
  };
  payable: { total: string; overdue: string; advance: string };
  gst: { month: string; output: string; input: string; net: string };
  trend: { month: string; sales: string; purchases: string }[];
  topCustomers: { partnerId: number; name: string; sales: string }[];
  lowStock: { productId: number; name: string; uom: string; onHand: string; reorderLevel: string }[];
  drafts: { model: string; count: number }[];
}

export interface EInvoiceSettings {
  enabled: boolean;
  provider: string;
  providers: { id: string; label: string; simulated: boolean }[];
}

export interface EInvoicePreview {
  enabled: boolean;
  skipReason: string | null;
  problems: string[];
  payload: Record<string, unknown>;
}

export interface EWayBillRequest {
  distanceKm: number;
  transMode?: string;
  vehicleNo?: string;
  transporterGstin?: string;
  transporterName?: string;
  transDocNo?: string;
  transDocDate?: string;
}

export interface BackupInfo {
  name: string;
  kind: 'auto' | 'manual' | 'before-restore' | 'uploaded';
  createdAt: string;
  size: number;
  company: string | null;
  schema: number | null;
}

export interface BackupSettings {
  auto: boolean;
  keep: number;
  copyTo: string | null;
}

export interface BackupStatus {
  available: boolean;
  folder: string;
  busy: string | null;
  settings: BackupSettings;
  backups: BackupInfo[];
}

/** Saves a backup file through the browser (the download needs the session header). */
export async function downloadBackup(name: string) {
  const token = getToken();
  const res = await fetch(`/api/backups/${encodeURIComponent(name)}/download`, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new ApiError(res.status, 'Download failed');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface Bootstrap {
  needsSetup: boolean;
  user: SessionUser | null;
  company: Company | null;
  license: LicenseStatus;
}

type Buckets = Record<'notDue' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90plus', string>;

export interface AgeingReport {
  asOf: string;
  direction: 'inbound' | 'outbound';
  rows: (Buckets & {
    partnerId: number;
    partner: string;
    total: string;
    advance: string;
    net: string;
    items: {
      id: number;
      number: string;
      date: string;
      dueDate: string | null;
      amountDue: string;
      daysOverdue: number;
      bucket: keyof Buckets;
    }[];
  })[];
  totals: Buckets & { total: string; advance: string; net: string };
}

type Heads = { taxable: string; igst: string; cgst: string; sgst: string };
type Balance = { accountId: number; code: string; name: string; type: string; debit: string; credit: string; balance: string };
type GstRow = Record<string, string | null>;

export interface LedgerReport {
  from: string;
  to: string;
  account: { id: number; code: string; name: string; type: string } | null;
  partner: { id: number; name: string; gstin: string | null } | null;
  /** Balances are debit-positive. */
  opening: string;
  rows: {
    lineId: number;
    date: string;
    entryId: number;
    entryNumber: string;
    reference: string;
    narration: string | null;
    refModel: string;
    refId: number;
    against: string;
    debit: string;
    credit: string;
    balance: string;
  }[];
  totalDebit: string;
  totalCredit: string;
  closing: string;
}

export interface DayBook {
  from: string;
  to: string;
  entries: {
    id: number;
    date: string;
    number: string;
    reference: string;
    narration: string | null;
    refModel: string;
    refId: number;
    amount: string;
    lines: { account: string; partner: string | null; debit: string; credit: string }[];
  }[];
  total: string;
}

/** Accounting and GST reports by name, with their query parameters and results. */
export interface Reports {
  'trial-balance': {
    params: { asOf: string };
    result: { asOf: string; rows: (Balance & { closingDebit: string; closingCredit: string })[]; totalDebit: string; totalCredit: string; balanced: boolean };
  };
  'profit-loss': {
    params: { from: string; to: string };
    result: { from: string; to: string; income: Balance[]; expense: Balance[]; totalIncome: string; totalExpense: string; netProfit: string };
  };
  'balance-sheet': {
    params: { asOf: string };
    result: {
      asOf: string;
      assets: Balance[];
      liabilities: Balance[];
      equity: Balance[];
      profit: string;
      totalAssets: string;
      totalLiabilities: string;
      totalEquity: string;
      balanced: boolean;
    };
  };
  ledger: {
    params: { accountId?: string; partnerId?: string; from: string; to: string };
    result: LedgerReport;
  };
  'day-book': {
    params: { from: string; to: string };
    result: DayBook;
  };
  'gstr-3b': {
    params: { month: string };
    result: { month: string; outward: { taxable: Heads; nilRated: string }; itc: Heads; netPayable: { igst: string; cgst: string; sgst: string } };
  };
  'gstr-1': {
    params: { month: string };
    result: {
      month: string;
      b2b: GstRow[];
      b2cl: GstRow[];
      b2cs: GstRow[];
      cdnr: GstRow[];
      cdnur: GstRow[];
      hsn: GstRow[];
      documents: { from: string | null; to: string | null; issued: number; cancelled: number };
      totals: Heads;
    };
  };
}

export interface ReconcileCandidate {
  entryLineId: number;
  date: string;
  entryNumber: string;
  reference: string;
  narration: string | null;
  partner: string | null;
  paymentReference: string | null;
  amount: string;
  referenceMatch: boolean;
  daysApart: number;
}

export interface ReconcileView {
  statement: { id: number; name: string; bankAccount: string; dateFrom: string; dateTo: string; closingBalance: string | null };
  lines: {
    id: number;
    date: string;
    description: string;
    reference: string | null;
    amount: string;
    balance: string | null;
    matched: { entryLineId: number; entryNumber: string; reference: string; narration: string | null } | null;
    suggestions?: ReconcileCandidate[];
  }[];
  summary: {
    matched: number;
    total: number;
    bookBalance: string;
    unreconciledBookItems: number;
    unreconciledBookTotal: string;
    difference: string | null;
  };
}

export interface CreditSource {
  model: string;
  id: number;
  number: string;
  date: string;
  remaining: string;
}

export interface FinancialYear {
  fy: string;
  label: string;
  from: string;
  to: string;
  profit: string;
  closed: boolean;
  ended: boolean;
  blockers: string[];
}

export interface UserRow extends SessionUser {
  active: boolean;
  createdAt: string;
}

const m = encodeURIComponent;

export const api = {
  bootstrap: () => request<Bootstrap>('GET', '/bootstrap'),
  setup: (input: Record<string, string>) => request<{ ok: true }>('POST', '/setup', input),
  login: (login: string, password: string) =>
    request<{ token: string; user: SessionUser }>('POST', '/auth/login', { login, password }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),
  meta: () => request<Metadata>('GET', '/meta'),

  search: (model: string, p: SearchParams) => request<SearchResult>('GET', `/records/${m(model)}${qs(p)}`),
  nameSearch: (model: string, q: string, limit = 8, filters: Record<string, string | number | boolean> = {}) =>
    request<Many2oneValue[]>(
      'GET',
      `/records/${m(model)}/name-search?q=${m(q)}&limit=${limit}${Object.entries(filters)
        .map(([k, v]) => `&f.${m(k)}=${m(String(v))}`)
        .join('')}`,
    ),
  read: (model: string, id: number) => request<RecordData>('GET', `/records/${m(model)}/${id}`),
  history: (model: string, id: number) => request<AuditEntry[]>('GET', `/records/${m(model)}/${id}/history`),
  create: (model: string, values: Record<string, unknown>) =>
    request<RecordData>('POST', `/records/${m(model)}`, values),
  update: (model: string, id: number, values: Record<string, unknown>) =>
    request<RecordData>('PATCH', `/records/${m(model)}/${id}`, values),
  setActive: (model: string, ids: number[], active: boolean) =>
    request<{ changed: number }>('POST', `/records/${m(model)}/set-active`, { ids, active }),
  remove: (model: string, id: number) => request<void>('DELETE', `/records/${m(model)}/${id}`),
  action: (model: string, id: number, action: string) =>
    request<RecordData>('POST', `/records/${m(model)}/${id}/actions/${m(action)}`),

  users: () => request<{ users: UserRow[]; seats: number | null }>('GET', '/users'),
  createUser: (u: { name: string; login: string; password: string; isAdmin: boolean }) =>
    request<SessionUser>('POST', '/users', u),
  setUserActive: (id: number, active: boolean) => request<{ ok: true }>('POST', `/users/${id}/set-active`, { active }),

  ageing: (direction: 'inbound' | 'outbound') => request<AgeingReport>('GET', `/reports/ageing?direction=${direction}`),
  report: <K extends keyof Reports>(name: K, params: Reports[K]['params']) =>
    request<Reports[K]['result']>('GET', `/reports/${name}?${new URLSearchParams(params as Record<string, string>).toString()}`),
  importStatement: (b: { bankAccountId: number; rows: StatementRow[]; closingBalance: string | null }) =>
    request<{ statementId: number; imported: number; duplicates: number }>('POST', '/bank/statements', b),
  reconcile: (statementId: number) => request<ReconcileView>('GET', `/bank/statements/${statementId}`),
  autoMatch: (statementId: number) => request<{ matched: number }>('POST', `/bank/statements/${statementId}/auto-match`),
  matchLine: (lineId: number, entryLineId: number) => request<{ ok: true }>('POST', `/bank/lines/${lineId}/match`, { entryLineId }),
  unmatchLine: (lineId: number) => request<{ ok: true }>('POST', `/bank/lines/${lineId}/unmatch`),
  bookLine: (lineId: number, b: { accountId: number; narration?: string }) => request<{ entryId: number }>('POST', `/bank/lines/${lineId}/book`, b),
  credits: (direction: 'inbound' | 'outbound', partnerId: number) =>
    request<CreditSource[]>('GET', `/credits?direction=${direction}&partnerId=${partnerId}`),
  applyCredit: (b: { direction: 'inbound' | 'outbound'; partnerId: number; docId?: number }) =>
    request<{ applied: string; settlements: { source: string; document: string; amount: string }[] }>('POST', '/credits/apply', b),
  years: () => request<FinancialYear[]>('GET', '/closing/years'),
  closeYear: (fy: string) => request<{ fy: string; profit: string }>('POST', `/closing/years/${fy}/close`),
  reopenYear: (fy: string) => request<{ fy: string }>('POST', `/closing/years/${fy}/reopen`),
  dashboard: () => request<Dashboard>('GET', '/dashboard'),
  einvoiceSettings: () => request<EInvoiceSettings>('GET', '/einvoice/settings'),
  saveEinvoiceSettings: (v: { enabled: boolean; provider: string }) => request<EInvoiceSettings>('PUT', '/einvoice/settings', v),
  einvoicePreview: (model: string, id: number) => request<EInvoicePreview>('GET', `/einvoice/${m(model)}/${id}`),
  einvoiceGenerate: (model: string, id: number) =>
    request<{ irn: string; ackNo: string; ackDate: string; simulated: boolean }>('POST', `/einvoice/${m(model)}/${id}/generate`, {}),
  einvoiceCancel: (model: string, id: number, b: { reason: string; remark: string }) => request<{ cancelled: true }>('POST', `/einvoice/${m(model)}/${id}/cancel`, b),
  ewayBill: (model: string, id: number, b: EWayBillRequest) =>
    request<{ ewbNo: string; ewbDate: string; validUntil: string }>('POST', `/einvoice/${m(model)}/${id}/ewaybill`, b),
  ewayBillCancel: (model: string, id: number, b: { reason: string; remark: string }) =>
    request<{ cancelled: true }>('POST', `/einvoice/${m(model)}/${id}/ewaybill/cancel`, b),
  backups: () => request<BackupStatus>('GET', '/backups'),
  backupNow: () => request<BackupInfo>('POST', '/backups'),
  saveBackupSettings: (s: Partial<BackupSettings>) => request<BackupSettings>('PUT', '/backups/settings', s),
  uploadBackup: (file: Blob) => request<BackupInfo>('POST', '/backups/upload', undefined, file),
  restoreBackup: (name: string) =>
    request<{ restored: string; company: string | null; safetyBackup: string }>('POST', `/backups/${encodeURIComponent(name)}/restore`),
  deleteBackup: (name: string) => request<void>('DELETE', `/backups/${encodeURIComponent(name)}`),

  company: () => request<Company | null>('GET', '/company'),
  updateCompany: (c: Partial<Company>) => request<Company>('PUT', '/company', c),

  license: () => request<LicenseStatus & { fingerprint: string }>('GET', '/license'),
  activate: (key: string) => request<LicenseStatus>('POST', '/license/activate', { key }),
  startTrial: (c: { name: string; email: string; phone?: string; company: string }) =>
    request<LicenseStatus>('POST', '/license/trial', c),
  checkin: () => request<LicenseStatus>('POST', '/license/checkin'),
};
