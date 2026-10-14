const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const date = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTime = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export const money = (v: string | number) => inr.format(Number(v));
export const formatDate = (iso: string) => date.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));

/** "in 5 days", "3 days ago", "today". */
export function relativeDays(iso: string): string {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${-days} days ago`;
}

export const cycleLabel = { monthly: 'Monthly', yearly: 'Yearly', trial: 'Trial' } as const;

const ACTIONS: Record<string, string> = {
  'license.created': 'Licence issued',
  'license.renewed': 'Renewed',
  'license.converted': 'Converted from trial',
  'license.plan_changed': 'Plan changed',
  'license.updated': 'Licence edited',
  'license.suspended': 'Suspended',
  'license.reactivated': 'Reactivated',
  'license.revoked': 'Revoked',
  'machine.removed': 'Computer removed',
  'customer.created': 'Customer added',
  'customer.updated': 'Customer edited',
  'plan.updated': 'Plan edited',
  'staff.created': 'Team member added',
  'staff.deactivated': 'Team member deactivated',
  'staff.reactivated': 'Team member reactivated',
  'subscription.charged': 'Payment received',
  'subscription.halted': 'Payment failed: subscription halted',
  'subscription.paused': 'Subscription paused',
  'subscription.resumed': 'Subscription resumed',
  'subscription.activated': 'Subscription started',
  'subscription.cancelled': 'Subscription cancelled',
};

export const actionLabel = (a: string) => ACTIONS[a] ?? a;

const FIELD: Record<string, string> = { seats: 'Users', maxActivations: 'Computers', deployment: 'Hosting' };

/** One-line summary of an event's details for timelines. */
export function describeDetails(action: string, d: Record<string, unknown>): string | null {
  if (action === 'license.renewed' && typeof d.to === 'string')
    return `+1 ${d.period === 'yearly' ? 'year' : 'month'}, now paid until ${formatDate(d.to)}`;
  if ((action === 'license.converted' || action === 'license.plan_changed') && d.toPlan)
    return `${String(d.fromPlan)} → ${String(d.toPlan)}, ${String(d.cycle)}`;
  if (action === 'license.created')
    return `${String(d.plan)}, ${String(d.cycle)}${d.deployment === 'cloud' ? ', cloud-hosted' : ''}`;
  if (action.startsWith('staff.') && d.email) return String(d.email);
  if (action === 'plan.updated' && d.plan) return String(d.plan);
  if (action === 'machine.removed' && d.hostname) return String(d.hostname);
  if (action === 'license.updated') {
    const parts = Object.entries(d)
      .filter(([, v]) => v && typeof v === 'object')
      .map(([k, v]) => `${FIELD[k] ?? k}: ${String((v as { from: unknown }).from)} → ${String((v as { to: unknown }).to)}`);
    return parts.join(', ') || null;
  }
  return null;
}
