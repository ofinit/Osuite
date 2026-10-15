// Admin API client. Auth is an HttpOnly session cookie set by /admin/auth/login.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public fieldErrors: Record<string, string> = {},
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/admin${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the admin server.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error ?? `Request failed (${res.status})`, data.fieldErrors ?? {});
  return data as T;
}

export type Standing = 'active' | 'trial' | 'expired' | 'suspended' | 'revoked';
export type Cycle = 'monthly' | 'yearly' | 'trial';
export type Deployment = 'desktop' | 'cloud';

export interface StaffUser {
  id: number;
  email: string;
  name: string;
  role: 'owner' | 'staff';
}

export interface LicenseRow {
  id: string;
  key: string;
  customerId: number;
  customer: string;
  email: string;
  planName: string;
  billingCycle: Cycle;
  deployment: Deployment;
  seats: number;
  currentPeriodEnd: string;
  createdAt: string;
  standing: Standing;
  machines: number;
}

export interface Plan {
  id: string;
  name: string;
  seats: number;
  modules: string[];
  priceMonthly: string;
  priceYearly: string;
  cloudAddonMonthly: string;
  active: boolean;
  tagline: string;
  includes: string;
  sortOrder: number;
}

export interface BusinessForm {
  fields: Record<string, { label: string; max: number; required?: boolean }>;
  values: Record<string, string>;
}

export interface Customer {
  id: number;
  name: string;
  email: string;
  phone: string | null;
  company: string | null;
  gstin: string | null;
  createdAt: string;
}

export interface CustomerRow extends Customer {
  licenses: number;
  paying: boolean;
}

export interface Machine {
  id: number;
  fingerprint: string;
  hostname: string | null;
  platform: string | null;
  appVersion: string | null;
  activatedAt: string;
  lastCheckinAt: string | null;
  deactivatedAt: string | null;
}

export interface HistoryEntry {
  kind: 'staff' | 'billing';
  id: number;
  at: string;
  action: string;
  staffName: string | null;
  details: Record<string, unknown>;
}

export interface LicenseDetail {
  license: {
    id: string;
    key: string;
    customerId: number;
    planId: string;
    seats: number;
    billingCycle: Cycle;
    status: 'active' | 'suspended' | 'revoked';
    deployment: Deployment;
    currentPeriodEnd: string;
    maxActivations: number;
    razorpaySubscriptionId: string | null;
    createdAt: string;
  };
  customer: Customer;
  plan: Plan;
  standing: Standing;
  machines: Machine[];
  history: HistoryEntry[];
}

export interface Dashboard {
  totals: { mrr: string; paying: number; trials: number; cloud: number; newTrials30d: number };
  dueSoon: Pick<LicenseRow, 'id' | 'customer' | 'email' | 'planName' | 'billingCycle' | 'currentPeriodEnd' | 'standing'>[];
  activity: { id: number; at: string; action: string; staffName: string | null; licenseId: string | null; customer: string | null; details: Record<string, unknown> }[];
}

export interface StaffRow extends StaffUser {
  active: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

const qs = (p: Record<string, string | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : '';
};

export const api = {
  me: () => request<StaffUser | null>('GET', '/auth/me'),
  login: (email: string, password: string) => request<StaffUser>('POST', '/auth/login', { email, password }),
  logout: () => request<{ ok: true }>('POST', '/auth/logout'),
  changePassword: (current: string, next: string) => request<{ ok: true }>('POST', '/auth/password', { current, next }),

  dashboard: () => request<Dashboard>('GET', '/dashboard'),

  licenses: (p: { q?: string; standing?: string; customerId?: string } = {}) => request<LicenseRow[]>('GET', `/licenses${qs(p)}`),
  license: (id: string) => request<LicenseDetail>('GET', `/licenses/${id}`),
  createLicense: (b: { customerId: number; planId: string; billingCycle: Cycle; deployment: Deployment }) =>
    request<{ id: string }>('POST', '/licenses', b),
  /** Extends the paid period; the billing cycle is unchanged. */
  renew: (id: string, period: 'monthly' | 'yearly') => request('POST', `/licenses/${id}/renew`, { period }),
  changePlan: (id: string, planId: string, cycle: 'monthly' | 'yearly') => request('POST', `/licenses/${id}/plan`, { planId, cycle }),
  updateLicense: (id: string, b: { seats?: number; maxActivations?: number; deployment?: Deployment }) =>
    request('PATCH', `/licenses/${id}`, b),
  setStatus: (id: string, status: 'active' | 'suspended' | 'revoked') => request('POST', `/licenses/${id}/status`, { status }),
  removeMachine: (id: number) => request('POST', `/activations/${id}/deactivate`),

  customers: (q?: string) => request<CustomerRow[]>('GET', `/customers${qs({ q })}`),
  customer: (id: number) => request<Customer>('GET', `/customers/${id}`),
  customerLicenses: (id: number) =>
    request<Pick<LicenseRow, 'id' | 'key' | 'planName' | 'billingCycle' | 'deployment' | 'currentPeriodEnd' | 'standing'>[]>(
      'GET',
      `/customers/${id}/licenses`,
    ),
  createCustomer: (b: Partial<Customer>) => request<Customer>('POST', '/customers', b),
  updateCustomer: (id: number, b: Partial<Customer>) => request<Customer>('PATCH', `/customers/${id}`, b),

  plans: () => request<Plan[]>('GET', '/plans'),
  updatePlan: (id: string, b: Partial<Plan>) => request<Plan>('PATCH', `/plans/${id}`, b),
  business: () => request<BusinessForm>('GET', '/business'),
  saveBusiness: (v: Record<string, string>) => request<Record<string, string>>('PUT', '/business', v),

  staff: () => request<StaffRow[]>('GET', '/staff'),
  createStaff: (b: { name: string; email: string; password: string; role: 'owner' | 'staff' }) => request('POST', '/staff', b),
  setStaffActive: (id: number, active: boolean) => request('POST', `/staff/${id}/set-active`, { active }),
};
