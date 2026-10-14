// Perpetual weighted-average stock valuation. The stock value is the running
// sum of movement values; the average cost is value / quantity. Tracking value
// (not qty x avg) means rounding never drifts.
import Decimal from 'decimal.js';

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
type Num = string | number | null | undefined;
const dec = (v: Num) => new D(v === null || v === undefined || v === '' ? 0 : v);

export interface StockPosition {
  qty: string;
  value: string;
  avgCost: string;
}

export interface MoveResult {
  position: StockPosition;
  /** Signed value of the movement (negative when stock goes out). */
  moveValue: string;
  unitCost: string;
}

/**
 * Applies a movement of `qty` (negative = out). Incoming stock is valued at
 * `unitCost` when given; outgoing stock (or incoming without a cost, such as a
 * return) at the current average. `atCost` forces `unitCost` for outgoing
 * stock too, so reversing a purchase removes exactly the value it added.
 */
export function applyMove(pos: StockPosition, qty: Num, unitCost?: Num, opts: { atCost?: boolean } = {}): MoveResult {
  const q = dec(qty);
  const oldQty = dec(pos.qty);
  const oldValue = dec(pos.value);
  const avg = dec(pos.avgCost);
  const hasCost = unitCost !== undefined && unitCost !== null && unitCost !== '';
  const cost = hasCost && (q.isPositive() || opts.atCost) ? dec(unitCost) : avg;
  const moveValue = q.mul(cost).toDecimalPlaces(2);
  const newQty = oldQty.add(q);
  const newValue = oldValue.add(moveValue);
  // Average only means something while stock is positive; otherwise keep the
  // last known cost (or the incoming cost when restarting from nothing).
  const newAvg = newQty.isPositive() ? newValue.div(newQty) : q.isPositive() ? cost : avg;
  return {
    position: { qty: newQty.toFixed(3), value: newValue.toFixed(2), avgCost: newAvg.toDecimalPlaces(4).toFixed(4) },
    moveValue: moveValue.toFixed(2),
    unitCost: cost.toDecimalPlaces(4).toFixed(4),
  };
}

/** Net unit cost of a purchase line (after discount, before GST). */
export function netUnitCost(qty: Num, taxable: Num): string {
  const q = dec(qty);
  return q.isZero() ? '0.0000' : dec(taxable).div(q).toDecimalPlaces(4).toFixed(4);
}
