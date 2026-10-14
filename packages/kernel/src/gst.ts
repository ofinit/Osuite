// GST computation shared by server (stored totals) and client (live preview),
// so both always agree to the paisa. Prices are tax-exclusive.
import Decimal from 'decimal.js';

const D = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
type Num = string | number | null | undefined;

const dec = (v: Num) => {
  if (v === null || v === undefined || v === '') return new D(0);
  try {
    return new D(v);
  } catch {
    return new D(0);
  }
};
const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const out = (d: Decimal) => d.toFixed(2);

export interface GstLineInput {
  qty: Num;
  unitPrice: Num;
  discountPct?: Num;
  /** Percent, e.g. "18". */
  gstRate?: Num;
}

export interface GstLineResult {
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  tax: string;
  total: string;
}

export interface GstRateSummary {
  rate: string;
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
}

export interface GstResult {
  lines: GstLineResult[];
  taxable: string;
  cgst: string;
  sgst: string;
  igst: string;
  tax: string;
  /** Adjustment to reach a whole-rupee total (may be negative). */
  roundOff: string;
  total: string;
  byRate: GstRateSummary[];
}

/**
 * Intra-state supplies split the rate into CGST + SGST (each computed on half
 * the rate); inter-state supplies charge IGST. Each line is rounded to paise.
 */
export function computeGst(lines: GstLineInput[], opts: { intraState: boolean; roundToRupee?: boolean }): GstResult {
  const zero = new D(0);
  const totals = { taxable: zero, cgst: zero, sgst: zero, igst: zero };
  const byRate = new Map<string, { taxable: Decimal; cgst: Decimal; sgst: Decimal; igst: Decimal }>();

  const results = lines.map((l) => {
    const gross = dec(l.qty).mul(dec(l.unitPrice));
    const taxable = r2(gross.sub(gross.mul(dec(l.discountPct)).div(100)));
    const rate = dec(l.gstRate);
    let cgst = zero;
    let sgst = zero;
    let igst = zero;
    if (opts.intraState) {
      cgst = r2(taxable.mul(rate).div(200));
      sgst = cgst;
    } else {
      igst = r2(taxable.mul(rate).div(100));
    }
    const tax = cgst.add(sgst).add(igst);
    totals.taxable = totals.taxable.add(taxable);
    totals.cgst = totals.cgst.add(cgst);
    totals.sgst = totals.sgst.add(sgst);
    totals.igst = totals.igst.add(igst);
    const key = rate.toString();
    const g = byRate.get(key) ?? { taxable: zero, cgst: zero, sgst: zero, igst: zero };
    byRate.set(key, { taxable: g.taxable.add(taxable), cgst: g.cgst.add(cgst), sgst: g.sgst.add(sgst), igst: g.igst.add(igst) });
    return { taxable: out(taxable), cgst: out(cgst), sgst: out(sgst), igst: out(igst), tax: out(tax), total: out(taxable.add(tax)) };
  });

  const tax = totals.cgst.add(totals.sgst).add(totals.igst);
  const exact = totals.taxable.add(tax);
  const total = opts.roundToRupee === false ? exact : exact.toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  return {
    lines: results,
    taxable: out(totals.taxable),
    cgst: out(totals.cgst),
    sgst: out(totals.sgst),
    igst: out(totals.igst),
    tax: out(tax),
    roundOff: out(total.sub(exact)),
    total: out(total),
    byRate: [...byRate.entries()]
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([rate, v]) => ({ rate, taxable: out(v.taxable), cgst: out(v.cgst), sgst: out(v.sgst), igst: out(v.igst) })),
  };
}

/**
 * Intra-state when the supplier's state matches the place of supply. If either
 * is unknown we assume intra-state (the common case for a local business).
 */
export function isIntraState(
  model: { gst?: { placeOfSupplyField: string; supplierStateField?: string } },
  record: Record<string, unknown>,
  companyState: string | null | undefined,
): boolean {
  if (!model.gst) return true;
  const supplier = model.gst.supplierStateField ? record[model.gst.supplierStateField] : companyState;
  const pos = record[model.gst.placeOfSupplyField] ?? companyState;
  if (!supplier || !pos) return true;
  return supplier === pos;
}

/** Indian financial year label for a date, e.g. 2026-10-14 -> "26-27". */
export function financialYear(isoDate: string): string {
  const [y, m] = isoDate.split('-').map(Number) as [number, number];
  const start = m >= 4 ? y : y - 1;
  return `${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
  'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below100(n: number): string {
  return n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`;
}

function below1000(n: number): string {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  return [h ? `${ONES[h]} Hundred` : '', rest ? below100(rest) : ''].filter(Boolean).join(' ');
}

/** Indian-system words: 1,23,45,678 -> "One Crore Twenty Three Lakh ..." */
function integerWords(n: number): string {
  if (n === 0) return 'Zero';
  const parts: string[] = [];
  const crore = Math.floor(n / 10_000_000);
  if (crore) parts.push(`${integerWords(crore)} Crore`);
  n %= 10_000_000;
  const lakh = Math.floor(n / 100_000);
  if (lakh) parts.push(`${below100(lakh)} Lakh`);
  n %= 100_000;
  const thousand = Math.floor(n / 1000);
  if (thousand) parts.push(`${below100(thousand)} Thousand`);
  n %= 1000;
  if (n) parts.push(below1000(n));
  return parts.join(' ');
}

/** "Rupees Twelve Thousand Three Hundred Forty and Fifty Paise Only" */
export function amountInWords(amount: Num): string {
  const a = r2(dec(amount).abs());
  const rupees = a.floor().toNumber();
  const paise = a.sub(a.floor()).mul(100).toNumber();
  const words = `Rupees ${integerWords(rupees)}${paise ? ` and ${below100(paise)} Paise` : ''} Only`;
  return dec(amount).isNegative() ? `Minus ${words}` : words;
}

/**
 * UPI payment link (NPCI deep-link format) for a QR code. The payee address
 * keeps its literal "@" and spaces become %20, which UPI apps read reliably.
 */
export function upiPayLink(p: { upiId: string; payee: string; amount: Num; note?: string }): string {
  const enc = (v: string) => encodeURIComponent(v);
  const parts = [`pa=${p.upiId.split('@').map(enc).join('@')}`, `pn=${enc(p.payee)}`, `am=${r2(dec(p.amount)).toFixed(2)}`, 'cu=INR'];
  if (p.note) parts.push(`tn=${enc(p.note)}`);
  return `upi://pay?${parts.join('&')}`;
}
