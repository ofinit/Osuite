// Wire types shared by server and client.

export interface Many2oneValue {
  id: number;
  display: string;
}

/** A record as returned by the API: many2one fields are expanded. */
export type RecordData = { id: number; active: boolean; createdAt: string; updatedAt: string } & Record<
  string,
  unknown
>;

export interface SearchParams {
  q?: string;
  /** Field name, prefix with "-" for descending. */
  sort?: string;
  limit?: number;
  offset?: number;
  /** Exact-match filters on scalar fields. */
  filters?: Record<string, string | number | boolean | null>;
  includeArchived?: boolean;
}

export interface SearchResult {
  records: RecordData[];
  total: number;
}

export interface AuditEntry {
  id: number;
  at: string;
  userName: string | null;
  /** Built-in actions, or a workflow action name such as 'post'. */
  action: 'create' | 'update' | 'archive' | 'restore' | 'delete' | (string & {});
  changes: Record<string, { from: unknown; to: unknown }>;
}

export type LicenseState = 'active' | 'grace' | 'readonly' | 'unlicensed' | 'dev';

export interface LicenseStatus {
  state: LicenseState;
  /** Whether writes are permitted. */
  writable: boolean;
  plan?: string;
  customer?: string;
  seats?: number;
  modules?: string[];
  expiresAt?: string;
  refreshBy?: string;
  message?: string;
}

export interface SessionUser {
  id: number;
  login: string;
  name: string;
  isAdmin: boolean;
}

export interface ApiError {
  error: string;
  fieldErrors?: Record<string, string>;
}
