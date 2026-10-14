import { randomBytes } from 'node:crypto';
import { generateLicenseKey, signLicense, verifyLicense, LicenseError, type LicensePayload } from '@osuite/license';
import { and, count, eq, isNull } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { activations, customers, licenses, plans, trialClaims } from './schema.ts';

export type Db = NodePgDatabase;
export type License = typeof licenses.$inferSelect;
export type Cycle = 'monthly' | 'yearly' | 'trial';

/** How long an install may stay offline before its token needs refreshing. */
const REFRESH_DAYS = 14;
const TRIAL_DAYS = 14;

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Machine {
  fingerprint: string;
  hostname?: string;
  platform?: string;
  appVersion?: string;
}

export function addCycle(from: Date, cycle: Cycle): Date {
  const d = new Date(from);
  if (cycle === 'trial') d.setUTCDate(d.getUTCDate() + TRIAL_DAYS);
  else if (cycle === 'monthly') d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCFullYear(d.getUTCFullYear() + 1);
  return d;
}

const newLicenseId = () => `lic_${randomBytes(9).toString('base64url')}`;

function checkMachine(m: Partial<Machine>): Machine {
  if (typeof m.fingerprint !== 'string' || !/^[a-f0-9]{16,64}$/.test(m.fingerprint))
    throw new HttpError(400, 'Invalid machine fingerprint');
  return {
    fingerprint: m.fingerprint,
    hostname: String(m.hostname ?? '').slice(0, 200) || undefined,
    platform: String(m.platform ?? '').slice(0, 20) || undefined,
    appVersion: String(m.appVersion ?? '').slice(0, 20) || undefined,
  };
}

export function createLicensing(db: Db, privateKeyPem: string, publicKeyPem: string) {
  /** `q` lets callers sign inside a transaction that has uncommitted rows. */
  async function issueToken(lic: License, fingerprint: string, q: Pick<Db, 'select'> = db): Promise<string> {
    const [cust] = await q.select().from(customers).where(eq(customers.id, lic.customerId));
    const now = new Date();
    const payload: LicensePayload = {
      v: 1,
      lid: lic.id,
      customer: cust?.company || cust?.name || 'Customer',
      plan: lic.planId,
      seats: lic.seats,
      modules: lic.modules,
      fp: fingerprint,
      iat: now.toISOString(),
      exp: lic.currentPeriodEnd.toISOString(),
      rby: new Date(now.getTime() + REFRESH_DAYS * 86_400_000).toISOString(),
    };
    return signLicense(payload, privateKeyPem);
  }

  async function bindMachine(lic: License, m: Machine) {
    const [existing] = await db
      .select()
      .from(activations)
      .where(and(eq(activations.licenseId, lic.id), eq(activations.fingerprint, m.fingerprint), isNull(activations.deactivatedAt)));
    if (existing) {
      await db
        .update(activations)
        .set({ lastCheckinAt: new Date(), hostname: m.hostname, appVersion: m.appVersion })
        .where(eq(activations.id, existing.id));
      return;
    }
    const [{ n }] = (await db
      .select({ n: count() })
      .from(activations)
      .where(and(eq(activations.licenseId, lic.id), isNull(activations.deactivatedAt)))) as [{ n: number }];
    if (n >= lic.maxActivations)
      throw new HttpError(
        409,
        'This licence is already active on another computer. Deactivate it there (or from your account) to move it.',
      );
    await db.insert(activations).values({ licenseId: lic.id, ...m, lastCheckinAt: new Date() });
  }

  return {
    issueToken,

    async createLicense(input: {
      customerId: number;
      planId: string;
      billingCycle: Cycle;
      seats?: number;
      deployment?: 'desktop' | 'cloud';
      maxActivations?: number;
    }): Promise<License> {
      const [plan] = await db.select().from(plans).where(eq(plans.id, input.planId));
      if (!plan) throw new HttpError(404, `Unknown plan ${input.planId}`);
      const [lic] = await db
        .insert(licenses)
        .values({
          id: newLicenseId(),
          key: generateLicenseKey(),
          customerId: input.customerId,
          planId: plan.id,
          seats: input.seats ?? plan.seats,
          modules: plan.modules,
          billingCycle: input.billingCycle,
          deployment: input.deployment ?? 'desktop',
          maxActivations: input.maxActivations ?? 1,
          currentPeriodEnd: addCycle(new Date(), input.billingCycle),
        })
        .returning();
      return lic!;
    },

    /**
     * Moves a licence (typically a trial) onto a paid plan. The key and machine
     * binding stay the same, so the customer's install upgrades on its next check-in.
     */
    async changePlan(licenseId: string, planId: string, cycle: Exclude<Cycle, 'trial'>): Promise<License> {
      const [plan] = await db.select().from(plans).where(eq(plans.id, planId));
      if (!plan || plan.id === 'trial') throw new HttpError(400, 'Choose a paid plan');
      const [lic] = await db.select().from(licenses).where(eq(licenses.id, licenseId));
      if (!lic) throw new HttpError(404, 'Licence not found');
      // A trial's remaining days are not carried over; a paid period starts now.
      const from = lic.billingCycle !== 'trial' && lic.currentPeriodEnd > new Date() ? lic.currentPeriodEnd : new Date();
      const [updated] = await db
        .update(licenses)
        .set({
          planId: plan.id,
          seats: Math.max(plan.seats, lic.billingCycle === 'trial' ? 0 : lic.seats),
          modules: plan.modules,
          billingCycle: cycle,
          status: 'active',
          currentPeriodEnd: addCycle(from, cycle),
        })
        .where(eq(licenses.id, licenseId))
        .returning();
      return updated!;
    },

    async update(licenseId: string, input: { seats?: unknown; maxActivations?: unknown; deployment?: unknown }) {
      const set: Partial<typeof licenses.$inferInsert> = {};
      const int = (v: unknown, label: string, max: number) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1 || n > max) throw new HttpError(400, `${label} must be between 1 and ${max}`);
        return n;
      };
      if (input.seats !== undefined) set.seats = int(input.seats, 'Users', 1000);
      if (input.maxActivations !== undefined) set.maxActivations = int(input.maxActivations, 'Computers', 100);
      if (input.deployment !== undefined) {
        if (input.deployment !== 'desktop' && input.deployment !== 'cloud') throw new HttpError(400, 'Invalid deployment');
        set.deployment = input.deployment;
      }
      if (!Object.keys(set).length) throw new HttpError(400, 'Nothing to update');
      const [updated] = await db.update(licenses).set(set).where(eq(licenses.id, licenseId)).returning();
      if (!updated) throw new HttpError(404, 'Licence not found');
      return updated;
    },

    /**
     * Extends the paid period by `period`, from whichever is later: now or the
     * current end. The billing cycle is unchanged (use changePlan for that), and
     * a suspended licence becomes active again since it has now been paid.
     */
    async renew(licenseId: string, period: Exclude<Cycle, 'trial'>): Promise<License> {
      const [lic] = await db.select().from(licenses).where(eq(licenses.id, licenseId));
      if (!lic) throw new HttpError(404, 'Licence not found');
      if (lic.status === 'revoked') throw new HttpError(400, 'A revoked licence cannot be renewed. Issue a new one.');
      if (lic.billingCycle === 'trial') throw new HttpError(400, 'Convert the trial to a paid plan instead of renewing it.');
      const from = lic.currentPeriodEnd > new Date() ? lic.currentPeriodEnd : new Date();
      const [updated] = await db
        .update(licenses)
        .set({ currentPeriodEnd: addCycle(from, period), status: 'active' })
        .where(eq(licenses.id, licenseId))
        .returning();
      return updated!;
    },

    async activate(body: { key?: string } & Partial<Machine>): Promise<string> {
      const m = checkMachine(body);
      const [lic] = await db.select().from(licenses).where(eq(licenses.key, String(body.key ?? '').trim().toUpperCase()));
      if (!lic) throw new HttpError(404, 'Licence key not found. Check for typos.');
      if (lic.status === 'revoked') throw new HttpError(403, 'This licence has been revoked.');
      await bindMachine(lic, m);
      return issueToken(lic, m.fingerprint);
    },

    async startTrial(body: { name?: string; email?: string; phone?: string; company?: string } & Partial<Machine>) {
      const m = checkMachine(body);
      const email = String(body.email ?? '').trim().toLowerCase();
      const name = String(body.name ?? '').trim();
      if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new HttpError(400, 'Name and a valid email are required');
      const [claimed] = await db.select().from(trialClaims).where(eq(trialClaims.fingerprint, m.fingerprint));
      if (claimed) throw new HttpError(409, 'A free trial has already been used on this computer.');

      return db.transaction(async (tx) => {
        const [cust] = await tx
          .insert(customers)
          .values({ name, email, phone: body.phone?.trim() || null, company: body.company?.trim() || null })
          .onConflictDoUpdate({ target: customers.email, set: { name } })
          .returning();
        const [plan] = await tx.select().from(plans).where(eq(plans.id, 'trial'));
        const [lic] = await tx
          .insert(licenses)
          .values({
            id: newLicenseId(),
            key: generateLicenseKey(),
            customerId: cust!.id,
            planId: 'trial',
            seats: plan!.seats,
            modules: plan!.modules,
            billingCycle: 'trial',
            currentPeriodEnd: addCycle(new Date(), 'trial'),
          })
          .returning();
        await tx.insert(trialClaims).values({ fingerprint: m.fingerprint, licenseId: lic!.id });
        await tx.insert(activations).values({ licenseId: lic!.id, ...m, lastCheckinAt: new Date() });
        return issueToken(lic!, m.fingerprint, tx);
      });
    },

    /** Refreshes a token. Returns { revoked } when the install must stop. */
    async checkin(body: { token?: string } & Partial<Machine>): Promise<{ token?: string; revoked?: boolean }> {
      const m = checkMachine(body);
      let p: LicensePayload;
      try {
        p = verifyLicense(String(body.token ?? ''), publicKeyPem);
      } catch (err) {
        throw new HttpError(400, err instanceof LicenseError ? err.message : 'Invalid token');
      }
      if (p.fp !== m.fingerprint) throw new HttpError(403, 'Token does not belong to this machine');
      const [lic] = await db.select().from(licenses).where(eq(licenses.id, p.lid));
      if (!lic || lic.status === 'revoked') return { revoked: true };
      const [act] = await db
        .select()
        .from(activations)
        .where(and(eq(activations.licenseId, lic.id), eq(activations.fingerprint, m.fingerprint), isNull(activations.deactivatedAt)));
      if (!act) return { revoked: true };
      await db
        .update(activations)
        .set({ lastCheckinAt: new Date(), appVersion: m.appVersion, hostname: m.hostname })
        .where(eq(activations.id, act.id));
      return { token: await issueToken(lic, m.fingerprint) };
    },

    async deactivate(activationId: number) {
      await db.update(activations).set({ deactivatedAt: new Date() }).where(eq(activations.id, activationId));
    },
  };
}

export type Licensing = ReturnType<typeof createLicensing>;
