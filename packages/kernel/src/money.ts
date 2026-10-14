// Exact rupee arithmetic for balances (paid, due, outstanding).
import Decimal from 'decimal.js';

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
type Num = string | number | null | undefined;
const dec = (v: Num) => new D(v === null || v === undefined || v === '' ? 0 : v);

export const money = {
  add: (...xs: Num[]) => xs.reduce<Decimal>((a, x) => a.add(dec(x)), new D(0)).toFixed(2),
  sub: (a: Num, b: Num) => dec(a).sub(dec(b)).toFixed(2),
  /** -1, 0 or 1 */
  cmp: (a: Num, b: Num) => dec(a).cmp(dec(b)),
  min: (a: Num, b: Num) => (dec(a).lte(dec(b)) ? dec(a) : dec(b)).toFixed(2),
  isPositive: (a: Num) => dec(a).gt(0),
  /** Exact half, e.g. CGST and SGST shares of an intra-state tax amount. */
  half: (a: Num) => dec(a).div(2).toFixed(2),
};

export type PaymentState = 'unpaid' | 'partial' | 'paid';

/** Status of a document from its total and amount paid. */
export function paymentStateOf(total: Num, paid: Num): PaymentState {
  if (!dec(paid).gt(0)) return 'unpaid';
  return dec(paid).gte(dec(total)) ? 'paid' : 'partial';
}

/** Ageing bucket for an amount due, by days past the due date. */
export type AgeBucket = 'notDue' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90plus';

export function ageBucket(dueDate: string, asOf: string): { bucket: AgeBucket; daysOverdue: number } {
  const days = Math.round((Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${dueDate}T00:00:00Z`)) / 86_400_000);
  const bucket: AgeBucket = days <= 0 ? 'notDue' : days <= 30 ? 'd1_30' : days <= 60 ? 'd31_60' : days <= 90 ? 'd61_90' : 'd90plus';
  return { bucket, daysOverdue: Math.max(days, 0) };
}
