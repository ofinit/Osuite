// Razorpay subscription webhooks -> licence renewals.
// https://razorpay.com/docs/webhooks/validate-test/
import { createHmac, timingSafeEqual } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { HttpError, type Db, type Licensing } from './licensing.ts';
import { billingEvents, licenses } from './schema.ts';

interface RazorpayEvent {
  event: string;
  payload?: {
    subscription?: { entity?: { id?: string; notes?: Record<string, string>; plan_id?: string } };
    payment?: { entity?: { id?: string } };
  };
}

export function verifyRazorpaySignature(rawBody: string, signature: string | undefined, secret: string): boolean {
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function createBilling(db: Db, licensing: Licensing, webhookSecret: string | undefined) {
  return {
    async razorpayWebhook(rawBody: string, signature: string | undefined, eventId: string | undefined) {
      if (!webhookSecret) throw new HttpError(503, 'Razorpay webhook secret not configured');
      if (!verifyRazorpaySignature(rawBody, signature, webhookSecret)) throw new HttpError(401, 'Bad signature');
      const evt = JSON.parse(rawBody) as RazorpayEvent;
      const sub = evt.payload?.subscription?.entity;
      if (!sub?.id) return { ignored: true };

      // Subscriptions are created with notes.license_id set by the checkout flow.
      let [lic] = await db.select().from(licenses).where(eq(licenses.razorpaySubscriptionId, sub.id));
      if (!lic && sub.notes?.license_id) {
        [lic] = await db
          .update(licenses)
          .set({ razorpaySubscriptionId: sub.id })
          .where(eq(licenses.id, sub.notes.license_id))
          .returning();
      }
      if (!lic) return { ignored: true };

      const id = eventId ?? `${evt.event}:${evt.payload?.payment?.entity?.id ?? sub.id}`;
      const inserted = await db
        .insert(billingEvents)
        .values({ provider: 'razorpay', eventId: id, type: evt.event, licenseId: lic.id, payload: evt })
        .onConflictDoNothing()
        .returning({ id: billingEvents.id });
      if (!inserted.length) return { duplicate: true };

      // Revoked licences stay revoked whatever the payment provider reports;
      // the event is still stored above for the record.
      if (lic.status === 'revoked') return { ok: true, ignored: 'revoked' };

      switch (evt.event) {
        case 'subscription.charged':
          if (lic.billingCycle === 'trial') {
            // First payment for a trial: checkout puts the chosen plan in the notes.
            const planId = sub.notes?.plan_id;
            if (!planId) return { ok: true, ignored: 'trial without plan_id note' };
            await licensing.changePlan(lic.id, planId, sub.notes?.cycle === 'yearly' ? 'yearly' : 'monthly');
          } else {
            await licensing.renew(lic.id, lic.billingCycle === 'yearly' ? 'yearly' : 'monthly');
          }
          break;
        case 'subscription.halted':
        case 'subscription.paused':
          await db.update(licenses).set({ status: 'suspended' }).where(eq(licenses.id, lic.id));
          break;
        case 'subscription.resumed':
        case 'subscription.activated':
          await db.update(licenses).set({ status: 'active' }).where(eq(licenses.id, lic.id));
          break;
        // subscription.cancelled: leave as-is; the paid period simply runs out.
      }
      return { ok: true };
    },
  };
}
