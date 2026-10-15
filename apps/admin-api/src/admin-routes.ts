// Staff-facing API used by the admin web app. All routes need a staff session.
import { BUSINESS_FIELDS, getBusiness, saveBusiness } from './business.ts';
import { pgError } from '@osuite/server-kit';
import { and, desc, eq, gt, ilike, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { HttpError, type Cycle, type Db, type Licensing } from './licensing.ts';
import { activations, adminEvents, billingEvents, customers, licenses, plans, staff } from './schema.ts';
import type { StaffService, StaffUser } from './staff.ts';

declare module 'fastify' {
  interface FastifyRequest {
    staff: StaffUser | null;
  }
}

export const SESSION_COOKIE = 'osuite_admin';

type Params = { id: string };
type Body = Record<string, unknown>;

/** Derived standing shown in the UI; status alone does not capture expiry. */
const standing = sql<'revoked' | 'suspended' | 'expired' | 'trial' | 'active'>`case
  when ${licenses.status} = 'revoked' then 'revoked'
  when ${licenses.status} = 'suspended' then 'suspended'
  when ${licenses.currentPeriodEnd} < now() then 'expired'
  when ${licenses.billingCycle} = 'trial' then 'trial'
  else 'active' end`;

/** Monthly recurring revenue contributed by a licence, in rupees. */
const monthlyValue = sql<string>`(case
  when ${licenses.billingCycle} = 'monthly' then ${plans.priceMonthly}
  when ${licenses.billingCycle} = 'yearly' then ${plans.priceYearly} / 12
  else 0 end
  + case when ${licenses.deployment} = 'cloud' then ${plans.cloudAddonMonthly} else 0 end)`;

const paying = and(
  eq(licenses.status, 'active'),
  sql`${licenses.billingCycle} <> 'trial'`,
  gt(licenses.currentPeriodEnd, sql`now()`),
);

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function requireOwner(req: FastifyRequest) {
  if (req.staff?.role !== 'owner') throw new HttpError(403, 'Only the owner can do this');
}

export async function adminRoutes(app: FastifyInstance, deps: { db: Db; licensing: Licensing; staffService: StaffService }) {
  const { db, licensing, staffService } = deps;

  app.decorateRequest('staff', null);
  app.addHook('onRequest', async (req) => {
    req.staff = await staffService.authenticate(req.cookies[SESSION_COOKIE]);
    const open = req.url === '/admin/auth/login' && req.method === 'POST';
    if (!open && !req.staff) throw new HttpError(401, 'Please sign in');
  });

  const record = (req: FastifyRequest, action: string, ref: { licenseId?: string; customerId?: number }, details: Body = {}) =>
    db.insert(adminEvents).values({ staffId: req.staff?.id ?? null, action, ...ref, details });

  const planName = async (id: string) => (await db.select({ name: plans.name }).from(plans).where(eq(plans.id, id)))[0]?.name ?? id;

  const loadLicense = async (id: string) => {
    const [lic] = await db.select().from(licenses).where(eq(licenses.id, id));
    if (!lic) throw new HttpError(404, 'Licence not found');
    return lic;
  };

  // ------------------------------------------------------------- session
  app.post('/admin/auth/login', async (req, reply) => {
    const { email, password } = (req.body ?? {}) as Body;
    const { token, user } = await staffService.login(email, password);
    reply.setCookie(SESSION_COOKIE, token, {
      path: '/admin',
      httpOnly: true,
      sameSite: 'strict',
      secure: req.protocol === 'https',
      maxAge: staffService.sessionHours * 3600,
    });
    return user;
  });

  app.post('/admin/auth/logout', async (req, reply) => {
    await staffService.logout(req.cookies[SESSION_COOKIE]);
    reply.clearCookie(SESSION_COOKIE, { path: '/admin' });
    return { ok: true };
  });

  app.get('/admin/auth/me', async (req) => req.staff);

  app.post('/admin/auth/password', async (req) => {
    const { current, next } = (req.body ?? {}) as Body;
    await staffService.changePassword(req.staff!.id, current, next);
    return { ok: true };
  });

  // ------------------------------------------------------------- dashboard
  app.get('/admin/dashboard', async () => {
    const [totals] = await db
      .select({
        mrr: sql<string>`coalesce(sum(${monthlyValue}) filter (where ${paying}), 0)`,
        paying: sql<number>`count(*) filter (where ${paying})::int`,
        trials: sql<number>`count(*) filter (where ${licenses.billingCycle} = 'trial' and ${licenses.status} = 'active' and ${licenses.currentPeriodEnd} > now())::int`,
        cloud: sql<number>`count(*) filter (where ${paying} and ${licenses.deployment} = 'cloud')::int`,
        newTrials30d: sql<number>`count(*) filter (where ${licenses.billingCycle} = 'trial' and ${licenses.createdAt} > now() - interval '30 days')::int`,
      })
      .from(licenses)
      .innerJoin(plans, eq(plans.id, licenses.planId));

    const listCols = {
      id: licenses.id,
      customer: sql<string>`coalesce(${customers.company}, ${customers.name})`,
      email: customers.email,
      planName: plans.name,
      billingCycle: licenses.billingCycle,
      currentPeriodEnd: licenses.currentPeriodEnd,
      standing,
    };
    const dueSoon = await db
      .select(listCols)
      .from(licenses)
      .innerJoin(customers, eq(customers.id, licenses.customerId))
      .innerJoin(plans, eq(plans.id, licenses.planId))
      .where(
        and(
          eq(licenses.status, 'active'),
          gt(licenses.currentPeriodEnd, sql`now() - interval '7 days'`),
          lt(licenses.currentPeriodEnd, sql`now() + interval '14 days'`),
        ),
      )
      .orderBy(licenses.currentPeriodEnd)
      .limit(20);

    const activity = await db
      .select({
        id: adminEvents.id,
        at: adminEvents.at,
        action: adminEvents.action,
        staffName: staff.name,
        licenseId: adminEvents.licenseId,
        customer: sql<string | null>`coalesce(${customers.company}, ${customers.name})`,
        details: adminEvents.details,
      })
      .from(adminEvents)
      .leftJoin(staff, eq(staff.id, adminEvents.staffId))
      .leftJoin(customers, eq(customers.id, adminEvents.customerId))
      .orderBy(desc(adminEvents.id))
      .limit(15);

    return { totals, dueSoon, activity };
  });

  // ------------------------------------------------------------- licences
  app.get('/admin/licenses', async (req) => {
    const { q, standing: filter, customerId } = req.query as Record<string, string | undefined>;
    const conds: (SQL | undefined)[] = [];
    if (q?.trim()) {
      const p = `%${escapeLike(q.trim())}%`;
      conds.push(or(ilike(licenses.key, p), ilike(licenses.id, p), ilike(customers.name, p), ilike(customers.company, p), ilike(customers.email, p)));
    }
    if (filter) conds.push(sql`${standing} = ${filter}`);
    if (customerId) conds.push(eq(licenses.customerId, Number(customerId)));
    return db
      .select({
        id: licenses.id,
        key: licenses.key,
        customerId: licenses.customerId,
        customer: sql<string>`coalesce(${customers.company}, ${customers.name})`,
        email: customers.email,
        planName: plans.name,
        billingCycle: licenses.billingCycle,
        deployment: licenses.deployment,
        seats: licenses.seats,
        currentPeriodEnd: licenses.currentPeriodEnd,
        createdAt: licenses.createdAt,
        standing,
        machines: sql<number>`(select count(*)::int from ${activations} a where a.license_id = ${licenses.id} and a.deactivated_at is null)`,
      })
      .from(licenses)
      .innerJoin(customers, eq(customers.id, licenses.customerId))
      .innerJoin(plans, eq(plans.id, licenses.planId))
      .where(and(...conds))
      .orderBy(desc(licenses.createdAt))
      .limit(300);
  });

  app.get('/admin/licenses/:id', async (req) => {
    const { id } = req.params as Params;
    const [row] = await db
      .select({ license: licenses, customer: customers, plan: plans, standing })
      .from(licenses)
      .innerJoin(customers, eq(customers.id, licenses.customerId))
      .innerJoin(plans, eq(plans.id, licenses.planId))
      .where(eq(licenses.id, id));
    if (!row) throw new HttpError(404, 'Licence not found');
    const machines = await db
      .select()
      .from(activations)
      .where(eq(activations.licenseId, id))
      .orderBy(sql`${activations.deactivatedAt} is not null`, desc(activations.activatedAt));
    const staffEvents = await db
      .select({ id: adminEvents.id, at: adminEvents.at, action: adminEvents.action, staffName: staff.name, details: adminEvents.details })
      .from(adminEvents)
      .leftJoin(staff, eq(staff.id, adminEvents.staffId))
      .where(eq(adminEvents.licenseId, id));
    const payments = await db
      .select({ id: billingEvents.id, at: billingEvents.receivedAt, type: billingEvents.type })
      .from(billingEvents)
      .where(eq(billingEvents.licenseId, id));
    const history = [
      ...staffEvents.map((e) => ({ kind: 'staff' as const, ...e })),
      ...payments.map((p) => ({ kind: 'billing' as const, id: p.id, at: p.at, action: p.type, staffName: null, details: {} })),
    ].sort((a, b) => b.at.getTime() - a.at.getTime());
    return { ...row, machines, history };
  });

  app.post('/admin/licenses', async (req, reply) => {
    const b = (req.body ?? {}) as { customerId?: number; planId?: string; billingCycle?: Cycle; deployment?: 'desktop' | 'cloud'; seats?: number };
    if (!b.customerId || !b.planId) throw new HttpError(400, 'Customer and plan are required');
    if (b.billingCycle !== 'monthly' && b.billingCycle !== 'yearly') throw new HttpError(400, 'Choose monthly or yearly billing');
    const lic = await licensing.createLicense({ ...b, customerId: b.customerId, planId: b.planId, billingCycle: b.billingCycle });
    await record(req, 'license.created', { licenseId: lic.id, customerId: lic.customerId }, {
      plan: await planName(lic.planId),
      cycle: lic.billingCycle,
      deployment: lic.deployment,
    });
    return reply.status(201).send(lic);
  });

  app.post('/admin/licenses/:id/renew', async (req) => {
    const { id } = req.params as Params;
    const { period } = (req.body ?? {}) as { period?: string };
    if (period !== 'monthly' && period !== 'yearly') throw new HttpError(400, 'Choose one month or one year');
    const before = await loadLicense(id);
    const lic = await licensing.renew(id, period);
    await record(req, 'license.renewed', { licenseId: id, customerId: lic.customerId }, {
      period,
      from: before.currentPeriodEnd,
      to: lic.currentPeriodEnd,
    });
    return lic;
  });

  app.post('/admin/licenses/:id/plan', async (req) => {
    const { id } = req.params as Params;
    const { planId, cycle } = (req.body ?? {}) as { planId?: string; cycle?: string };
    if (!planId || (cycle !== 'monthly' && cycle !== 'yearly')) throw new HttpError(400, 'Choose a plan and billing cycle');
    const before = await loadLicense(id);
    const lic = await licensing.changePlan(id, planId, cycle);
    await record(req, before.billingCycle === 'trial' ? 'license.converted' : 'license.plan_changed', { licenseId: id, customerId: lic.customerId }, {
      fromPlan: await planName(before.planId),
      toPlan: await planName(planId),
      cycle,
    });
    return lic;
  });

  app.patch('/admin/licenses/:id', async (req) => {
    const { id } = req.params as Params;
    const before = await loadLicense(id);
    const lic = await licensing.update(id, (req.body ?? {}) as Body);
    const changes: Body = {};
    for (const k of ['seats', 'maxActivations', 'deployment'] as const)
      if (before[k] !== lic[k]) changes[k] = { from: before[k], to: lic[k] };
    await record(req, 'license.updated', { licenseId: id, customerId: lic.customerId }, changes);
    return lic;
  });

  app.post('/admin/licenses/:id/status', async (req) => {
    const { id } = req.params as Params;
    const { status } = (req.body ?? {}) as { status?: string };
    if (status !== 'active' && status !== 'suspended' && status !== 'revoked') throw new HttpError(400, 'Invalid status');
    const before = await loadLicense(id);
    if (before.status === 'revoked') throw new HttpError(400, 'A revoked licence cannot be changed. Issue a new one.');
    const [lic] = await db.update(licenses).set({ status }).where(eq(licenses.id, id)).returning();
    await record(req, `license.${status === 'active' ? 'reactivated' : status}`, { licenseId: id, customerId: lic!.customerId });
    return lic;
  });

  app.post('/admin/activations/:id/deactivate', async (req) => {
    const id = Number((req.params as Params).id);
    const [act] = await db
      .update(activations)
      .set({ deactivatedAt: new Date() })
      .where(and(eq(activations.id, id), isNull(activations.deactivatedAt)))
      .returning();
    if (!act) throw new HttpError(404, 'Computer not found or already removed');
    const lic = await loadLicense(act.licenseId);
    await record(req, 'machine.removed', { licenseId: act.licenseId, customerId: lic.customerId }, { hostname: act.hostname });
    return { ok: true };
  });

  // ------------------------------------------------------------- customers
  app.get('/admin/customers', async (req) => {
    const { q } = req.query as { q?: string };
    const p = q?.trim() ? `%${escapeLike(q.trim())}%` : null;
    return db
      .select({
        id: customers.id,
        name: customers.name,
        company: customers.company,
        email: customers.email,
        phone: customers.phone,
        createdAt: customers.createdAt,
        licenses: sql<number>`(select count(*)::int from ${licenses} l where l.customer_id = ${customers.id})`,
        paying: sql<boolean>`exists (select 1 from ${licenses} l where l.customer_id = ${customers.id}
          and l.status = 'active' and l.billing_cycle <> 'trial' and l.current_period_end > now())`,
      })
      .from(customers)
      .where(p ? or(ilike(customers.name, p), ilike(customers.company, p), ilike(customers.email, p), ilike(customers.phone, p)) : undefined)
      .orderBy(desc(customers.id))
      .limit(300);
  });

  app.get('/admin/customers/:id', async (req) => {
    const id = Number((req.params as Params).id);
    const [customer] = await db.select().from(customers).where(eq(customers.id, id));
    if (!customer) throw new HttpError(404, 'Customer not found');
    return customer;
  });

  const customerFields = (b: Body) => {
    const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
    return {
      name: str(b.name, 200),
      email: str(b.email, 200)?.toLowerCase() ?? null,
      phone: str(b.phone, 30),
      company: str(b.company, 200),
      gstin: str(b.gstin, 15)?.toUpperCase() ?? null,
    };
  };

  app.post('/admin/customers', async (req, reply) => {
    const v = customerFields((req.body ?? {}) as Body);
    if (!v.name || !v.email) throw new HttpError(400, 'Name and email are required');
    const existing = await db.select({ id: customers.id }).from(customers).where(eq(customers.email, v.email));
    if (existing.length) throw new HttpError(409, 'A customer with that email already exists');
    const [c] = await db.insert(customers).values({ ...v, name: v.name, email: v.email }).returning();
    await record(req, 'customer.created', { customerId: c!.id }, { name: c!.name });
    return reply.status(201).send(c);
  });

  app.patch('/admin/customers/:id', async (req) => {
    const id = Number((req.params as Params).id);
    const v = customerFields((req.body ?? {}) as Body);
    if (!v.name || !v.email) throw new HttpError(400, 'Name and email are required');
    const [c] = await db
      .update(customers)
      .set({ ...v, name: v.name, email: v.email })
      .where(eq(customers.id, id))
      .returning()
      .catch((err) => {
        if (pgError(err).code === '23505') throw new HttpError(409, 'Another customer uses that email');
        throw err;
      });
    if (!c) throw new HttpError(404, 'Customer not found');
    await record(req, 'customer.updated', { customerId: id });
    return c;
  });

  // ------------------------------------------------------------- plans
  app.get('/admin/plans', async () => db.select().from(plans).orderBy(plans.sortOrder, plans.priceMonthly));

  app.patch('/admin/plans/:id', async (req) => {
    requireOwner(req);
    const { id } = req.params as Params;
    const b = (req.body ?? {}) as Body;
    const money = (v: unknown, label: string) => {
      const s = String(v ?? '').trim();
      if (!/^\d{1,9}(\.\d{1,2})?$/.test(s)) throw new HttpError(400, `${label} must be an amount in rupees`);
      return s;
    };
    const set: Partial<typeof plans.$inferInsert> = {};
    if (b.name !== undefined) set.name = String(b.name).trim().slice(0, 100) || undefined;
    if (b.seats !== undefined) {
      const n = Number(b.seats);
      if (!Number.isInteger(n) || n < 1) throw new HttpError(400, 'Users must be a whole number');
      set.seats = n;
    }
    if (b.priceMonthly !== undefined) set.priceMonthly = money(b.priceMonthly, 'Monthly price');
    if (b.priceYearly !== undefined) set.priceYearly = money(b.priceYearly, 'Yearly price');
    if (b.cloudAddonMonthly !== undefined) set.cloudAddonMonthly = money(b.cloudAddonMonthly, 'Cloud add-on');
    if (b.active !== undefined) set.active = !!b.active;
    if (b.tagline !== undefined) set.tagline = String(b.tagline).trim().slice(0, 200);
    if (b.includes !== undefined) set.includes = String(b.includes).trim().slice(0, 1000);
    if (b.sortOrder !== undefined) {
      const n = Number(b.sortOrder);
      if (!Number.isInteger(n) || n < 0 || n > 99) throw new HttpError(400, 'Order must be a whole number from 0 to 99');
      set.sortOrder = n;
    }
    const [p] = await db.update(plans).set(set).where(eq(plans.id, id)).returning();
    if (!p) throw new HttpError(404, 'Plan not found');
    await record(req, 'plan.updated', {}, { plan: p.name, ...set });
    return p;
  });

  // ------------------------------------------------------------- business profile
  // Shown on the website, the legal pages and in the apps (via GET /v1/site).
  app.get('/admin/business', async () => ({ fields: BUSINESS_FIELDS, values: await getBusiness(db) }));

  app.put('/admin/business', async (req) => {
    requireOwner(req);
    const before = await getBusiness(db);
    const saved = await saveBusiness(db, (req.body ?? {}) as Body);
    const changed = Object.fromEntries(Object.entries(saved).filter(([k, v]) => before[k as keyof typeof before] !== v));
    await record(req, 'business.updated', {}, changed);
    return saved;
  });

  // ------------------------------------------------------------- staff
  app.get('/admin/staff', async (req) => {
    requireOwner(req);
    return staffService.list();
  });

  app.post('/admin/staff', async (req, reply) => {
    requireOwner(req);
    const s = await staffService.create((req.body ?? {}) as Record<string, string>);
    await record(req, 'staff.created', {}, { email: s.email, role: s.role });
    return reply.status(201).send(s);
  });

  app.post('/admin/staff/:id/set-active', async (req) => {
    requireOwner(req);
    const id = Number((req.params as Params).id);
    const { active } = (req.body ?? {}) as { active?: boolean };
    await staffService.setActive(id, !!active, req.staff!.id);
    const [who] = await db.select({ email: staff.email }).from(staff).where(eq(staff.id, id));
    await record(req, active ? 'staff.reactivated' : 'staff.deactivated', {}, { staffId: id, email: who?.email });
    return { ok: true };
  });

  // Customers' licences for the detail page.
  app.get('/admin/customers/:id/licenses', async (req) => {
    const id = Number((req.params as Params).id);
    return db
      .select({
        id: licenses.id,
        key: licenses.key,
        planName: plans.name,
        billingCycle: licenses.billingCycle,
        deployment: licenses.deployment,
        currentPeriodEnd: licenses.currentPeriodEnd,
        standing,
      })
      .from(licenses)
      .innerJoin(plans, eq(plans.id, licenses.planId))
      .where(eq(licenses.customerId, id))
      .orderBy(desc(licenses.createdAt));
  });
}
