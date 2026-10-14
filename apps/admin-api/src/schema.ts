import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const plans = pgTable('plans', {
  id: varchar('id', { length: 40 }).primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  seats: integer('seats').notNull(),
  modules: jsonb('modules').$type<string[]>().notNull(),
  priceMonthly: numeric('price_monthly', { precision: 12, scale: 2 }).notNull(),
  priceYearly: numeric('price_yearly', { precision: 12, scale: 2 }).notNull(),
  /** Extra monthly charge when the customer's data is hosted by us. */
  cloudAddonMonthly: numeric('cloud_addon_monthly', { precision: 12, scale: 2 }).notNull().default('0'),
  active: boolean('active').notNull().default(true),
});

export const customers = pgTable('customers', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  name: varchar('name', { length: 200 }).notNull(),
  email: varchar('email', { length: 200 }).notNull().unique(),
  phone: varchar('phone', { length: 30 }),
  company: varchar('company', { length: 200 }),
  gstin: varchar('gstin', { length: 15 }),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const licenses = pgTable(
  'licenses',
  {
    id: varchar('id', { length: 40 }).primaryKey(),
    key: varchar('key', { length: 40 }).notNull().unique(),
    customerId: bigint('customer_id', { mode: 'number' })
      .notNull()
      .references(() => customers.id),
    planId: varchar('plan_id', { length: 40 })
      .notNull()
      .references(() => plans.id),
    seats: integer('seats').notNull(),
    modules: jsonb('modules').$type<string[]>().notNull(),
    billingCycle: varchar('billing_cycle', { length: 10 }).$type<'monthly' | 'yearly' | 'trial'>().notNull(),
    status: varchar('status', { length: 12 }).$type<'active' | 'suspended' | 'revoked'>().notNull().default('active'),
    deployment: varchar('deployment', { length: 10 }).$type<'desktop' | 'cloud'>().notNull().default('desktop'),
    currentPeriodEnd: ts('current_period_end').notNull(),
    maxActivations: integer('max_activations').notNull().default(1),
    razorpaySubscriptionId: varchar('razorpay_subscription_id', { length: 60 }).unique(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('licenses_customer_idx').on(t.customerId)],
);

export const activations = pgTable(
  'activations',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    licenseId: varchar('license_id', { length: 40 })
      .notNull()
      .references(() => licenses.id),
    fingerprint: varchar('fingerprint', { length: 64 }).notNull(),
    hostname: varchar('hostname', { length: 200 }),
    platform: varchar('platform', { length: 20 }),
    appVersion: varchar('app_version', { length: 20 }),
    activatedAt: ts('activated_at').notNull().defaultNow(),
    lastCheckinAt: ts('last_checkin_at'),
    deactivatedAt: ts('deactivated_at'),
  },
  (t) => [index('activations_license_idx').on(t.licenseId), index('activations_fp_idx').on(t.fingerprint)],
);

/** One free trial per machine. */
export const trialClaims = pgTable('trial_claims', {
  fingerprint: varchar('fingerprint', { length: 64 }).primaryKey(),
  licenseId: varchar('license_id', { length: 40 })
    .notNull()
    .references(() => licenses.id),
  claimedAt: ts('claimed_at').notNull().defaultNow(),
});

export const billingEvents = pgTable(
  'billing_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    provider: varchar('provider', { length: 20 }).notNull(),
    /** Provider event id; makes webhook processing idempotent. */
    eventId: varchar('event_id', { length: 100 }).notNull(),
    type: varchar('type', { length: 60 }).notNull(),
    licenseId: varchar('license_id', { length: 40 }),
    payload: jsonb('payload').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('billing_events_provider_event_idx').on(t.provider, t.eventId)],
);


/** People who operate the admin panel. */
export const staff = pgTable('staff', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  email: varchar('email', { length: 200 }).notNull().unique(),
  name: varchar('name', { length: 120 }).notNull(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  role: varchar('role', { length: 10 }).$type<'owner' | 'staff'>().notNull().default('staff'),
  active: boolean('active').notNull().default(true),
  lastLoginAt: ts('last_login_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const staffSessions = pgTable(
  'staff_sessions',
  {
    tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
    staffId: bigint('staff_id', { mode: 'number' })
      .notNull()
      .references(() => staff.id, { onDelete: 'cascade' }),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [index('staff_sessions_staff_idx').on(t.staffId)],
);

/** What staff did in the admin panel (renewals, revocations, edits...). */
export const adminEvents = pgTable(
  'admin_events',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    at: ts('at').notNull().defaultNow(),
    staffId: bigint('staff_id', { mode: 'number' }).references(() => staff.id),
    action: varchar('action', { length: 40 }).notNull(),
    licenseId: varchar('license_id', { length: 40 }),
    customerId: bigint('customer_id', { mode: 'number' }),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index('admin_events_license_idx').on(t.licenseId), index('admin_events_customer_idx').on(t.customerId)],
);
