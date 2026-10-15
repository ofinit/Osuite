// GST e-invoice (IRP schema INV-01, version 1.1) and e-way bill (by IRN)
// payloads, built from OSuite documents and checked against the IRP's field
// rules before anything is sent. Provider-neutral: every GSP and the IRP's own
// API take this JSON.
import { computeGst } from './gst.ts';
import { isValidGstin } from './india.ts';
import { money } from './money.ts';

export type EInvoiceDocType = 'INV' | 'CRN' | 'DBN';

export interface EInvoiceParty {
  gstin: string;
  legalName: string;
  street?: string | null;
  street2?: string | null;
  city?: string | null;
  pincode?: string | null;
  stateCode?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface EInvoiceLine {
  description: string;
  hsnCode?: string | null;
  qty: string;
  uom: string;
  unitPrice: string;
  discountPct?: string | null;
  gstRate: string;
}

export interface EInvoiceInput {
  docType: EInvoiceDocType;
  number: string;
  /** ISO date (yyyy-mm-dd). */
  date: string;
  seller: EInvoiceParty;
  buyer: EInvoiceParty;
  placeOfSupply: string;
  lines: EInvoiceLine[];
  /** The document's own totals; the payload's must agree with them. */
  totals: { taxable: string; cgst: string; sgst: string; igst: string; roundOff: string; total: string };
  /** For credit and debit notes: the invoice they adjust. */
  original?: { number: string; date: string } | null;
}

/** Unit quantity codes (UQC) the IRP accepts, from OSuite's units. */
const UQC: Record<string, string> = { NOS: 'NOS', KGS: 'KGS', LTR: 'LTR', MTR: 'MTR', BOX: 'BOX', HRS: 'OTH' };
const IRP_RATES = new Set(['0', '0.1', '0.25', '1', '1.5', '3', '5', '6', '7.5', '12', '18', '28']);

/** dd/mm/yyyy, as the IRP wants dates. */
export const irpDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const num = (v: string | number) => Number(Number(v).toFixed(2));
const qty3 = (v: string | number) => Number(Number(v).toFixed(3));
/** HSN codes starting 99 are services (SAC). */
export const isService = (hsn: string | null | undefined) => !!hsn && hsn.startsWith('99');

function party(p: EInvoiceParty) {
  return {
    Gstin: p.gstin,
    LglNm: p.legalName.trim(),
    Addr1: (p.street ?? '').trim(),
    ...(p.street2?.trim() ? { Addr2: p.street2.trim() } : {}),
    Loc: (p.city ?? '').trim(),
    Pin: Number(p.pincode),
    Stcd: p.stateCode ?? p.gstin.slice(0, 2),
    ...(p.phone?.replace(/\D/g, '').length && p.phone.replace(/\D/g, '').length >= 6 ? { Ph: p.phone.replace(/\D/g, '').slice(-12) } : {}),
    ...(p.email?.trim() ? { Em: p.email.trim() } : {}),
  };
}

/** The INV-01 JSON for a document. Throws nothing; run `validateEInvoice` on the result. */
export function buildEInvoice(input: EInvoiceInput) {
  const intraState = input.seller.stateCode === input.placeOfSupply && input.totals.igst === '0.00';
  const calc = computeGst(
    input.lines.map((l) => ({ qty: l.qty, unitPrice: l.unitPrice, discountPct: l.discountPct ?? '0', gstRate: l.gstRate })),
    { intraState },
  );
  const items = input.lines.map((l, i) => {
    const r = calc.lines[i]!;
    const gross = money.add(Number(l.qty) * Number(l.unitPrice));
    const service = isService(l.hsnCode);
    return {
      SlNo: String(i + 1),
      PrdDesc: l.description.trim(),
      IsServc: service ? 'Y' : 'N',
      HsnCd: (l.hsnCode ?? '').trim(),
      Qty: qty3(l.qty),
      Unit: UQC[l.uom] ?? 'OTH',
      UnitPrice: num(l.unitPrice),
      TotAmt: num(gross),
      Discount: num(money.sub(gross, r.taxable)),
      AssAmt: num(r.taxable),
      GstRt: Number(l.gstRate),
      IgstAmt: num(r.igst),
      CgstAmt: num(r.cgst),
      SgstAmt: num(r.sgst),
      TotItemVal: num(r.total),
    };
  });
  return {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: 'B2B', RegRev: 'N', IgstOnIntra: 'N' },
    DocDtls: { Typ: input.docType, No: input.number, Dt: irpDate(input.date) },
    SellerDtls: party(input.seller),
    BuyerDtls: { ...party(input.buyer), Pos: input.placeOfSupply },
    ItemList: items,
    ValDtls: {
      AssVal: num(input.totals.taxable),
      CgstVal: num(input.totals.cgst),
      SgstVal: num(input.totals.sgst),
      IgstVal: num(input.totals.igst),
      RndOffAmt: num(input.totals.roundOff),
      TotInvVal: num(input.totals.total),
    },
    ...(input.original ? { RefDtls: { PrecDocDtls: [{ InvNo: input.original.number, InvDt: irpDate(input.original.date) }] } } : {}),
  };
}

export type EInvoicePayload = ReturnType<typeof buildEInvoice>;

/** IRP field rules that commonly reject invoices, as plain-language problems keyed by where to fix them. */
export function validateEInvoice(p: EInvoicePayload, today: string): string[] {
  const problems: string[] = [];
  const doc = p.DocDtls;
  if (!/^[A-Za-z1-9][A-Za-z0-9/-]{0,15}$/.test(doc.No))
    problems.push(`Document number "${doc.No}" must be at most 16 characters of letters, digits, / and -, not starting with 0, / or -.`);
  const [d, m, y] = doc.Dt.split('/');
  if (`${y}-${m}-${d}` > today) problems.push('The document date is in the future.');

  const checkParty = (who: 'Your company' | 'The customer', x: EInvoicePayload['SellerDtls']) => {
    if (!isValidGstin(x.Gstin)) problems.push(`${who}: a valid GSTIN is required.`);
    if (x.LglNm.length < 3 || x.LglNm.length > 100) problems.push(`${who}: the legal name must be 3 to 100 characters.`);
    if (!x.Addr1 || x.Addr1.length > 100) problems.push(`${who}: the street address is required (up to 100 characters).`);
    if (x.Loc.length < 3 || x.Loc.length > 50) problems.push(`${who}: the city is required (3 to 50 characters).`);
    if (!(x.Pin >= 100000 && x.Pin <= 999999)) problems.push(`${who}: a 6-digit PIN code is required.`);
    if (!/^\d{2}$/.test(x.Stcd)) problems.push(`${who}: the state is required.`);
  };
  checkParty('Your company', p.SellerDtls);
  checkParty('The customer', p.BuyerDtls);
  if (p.SellerDtls.Gstin && p.SellerDtls.Gstin === p.BuyerDtls.Gstin) problems.push('The customer GSTIN is the same as your own.');

  if (!p.ItemList.length) problems.push('The document has no items.');
  if (p.ItemList.length > 1000) problems.push('The IRP accepts at most 1000 items per document.');
  for (const it of p.ItemList) {
    const at = `Item ${it.SlNo} (${it.PrdDesc || 'no description'})`;
    if (!/^\d{4}(\d{2})?(\d{2})?$/.test(it.HsnCd)) problems.push(`${at}: HSN/SAC must be 4, 6 or 8 digits.`);
    if (it.PrdDesc.length > 300) problems.push(`${at}: the description is longer than 300 characters.`);
    if (!IRP_RATES.has(String(it.GstRt))) problems.push(`${at}: GST rate ${it.GstRt}% is not a valid rate.`);
    if (it.Qty < 0 || it.UnitPrice < 0) problems.push(`${at}: quantity and rate cannot be negative.`);
  }

  // The values must add up: the IRP rejects totals that do not match the items.
  const sum = (k: 'AssAmt' | 'CgstAmt' | 'SgstAmt' | 'IgstAmt') => num(p.ItemList.reduce((s, it) => s + it[k], 0));
  const v = p.ValDtls;
  const pairs: [string, number, number][] = [
    ['taxable value', sum('AssAmt'), v.AssVal],
    ['CGST', sum('CgstAmt'), v.CgstVal],
    ['SGST', sum('SgstAmt'), v.SgstVal],
    ['IGST', sum('IgstAmt'), v.IgstVal],
  ];
  for (const [label, items, total] of pairs) if (Math.abs(items - total) > 1) problems.push(`The ${label} of the items (${items}) does not match the document (${total}).`);
  const expected = num(v.AssVal + v.CgstVal + v.SgstVal + v.IgstVal + v.RndOffAmt);
  if (Math.abs(expected - v.TotInvVal) > 1) problems.push(`The document total (${v.TotInvVal}) does not match its taxable value and tax (${expected}).`);
  if (v.CgstVal + v.SgstVal > 0 && v.IgstVal > 0) problems.push('A document cannot carry both CGST/SGST and IGST.');
  if (p.DocDtls.Typ !== 'INV' && !('RefDtls' in p)) problems.push('A credit or debit note must name the original invoice.');
  return problems;
}

/** Why a document cannot be e-invoiced at all (rather than what to fix). */
export function eInvoiceSkipReason(o: { buyerGstin: string | null | undefined; state: string }): string | null {
  if (o.state !== 'posted') return 'Only posted documents can be e-invoiced.';
  if (!o.buyerGstin) return 'E-invoices are only for registered (B2B) customers; this customer has no GSTIN.';
  return null;
}

// ---------------------------------------------------------------- e-way bill

export const TRANSPORT_MODES = [
  ['1', 'Road'],
  ['2', 'Rail'],
  ['3', 'Air'],
  ['4', 'Ship'],
] as const;

export interface EWayBillInput {
  irn: string;
  /** Approximate distance in km; 0 lets the portal work it out from the PIN codes. */
  distanceKm: number;
  transMode?: '1' | '2' | '3' | '4' | null;
  transporterGstin?: string | null;
  transporterName?: string | null;
  vehicleNo?: string | null;
  /** Transport document (LR/RR/airway bill) number and ISO date. */
  transDocNo?: string | null;
  transDocDate?: string | null;
}

/** The IRP's "generate e-way bill by IRN" payload. */
export function buildEWayBill(e: EWayBillInput) {
  return {
    Irn: e.irn,
    Distance: Math.max(0, Math.round(e.distanceKm)),
    ...(e.transporterGstin ? { TransId: e.transporterGstin.toUpperCase() } : {}),
    ...(e.transporterName ? { TransName: e.transporterName } : {}),
    ...(e.transMode ? { TransMode: e.transMode } : {}),
    ...(e.transDocNo ? { TrnDocNo: e.transDocNo } : {}),
    ...(e.transDocDate ? { TrnDocDt: irpDate(e.transDocDate) } : {}),
    ...(e.vehicleNo ? { VehNo: e.vehicleNo.replace(/\s|-/g, '').toUpperCase(), VehType: 'R' } : {}),
  };
}

export function validateEWayBill(e: EWayBillInput): string[] {
  const problems: string[] = [];
  if (!(e.distanceKm >= 0 && e.distanceKm <= 4000)) problems.push('Distance must be between 0 and 4000 km.');
  if (e.transporterGstin && !isValidGstin(e.transporterGstin.toUpperCase())) problems.push('Transporter ID must be a valid GSTIN.');
  if (!e.transporterGstin && !e.vehicleNo) problems.push('Give the vehicle number, or the transporter ID if the transporter will add the vehicle later.');
  if (e.vehicleNo && !/^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$|^TR[A-Z0-9]{6,}$/.test(e.vehicleNo.replace(/\s|-/g, '').toUpperCase()))
    problems.push('Vehicle number should look like MH12AB1234.');
  if (e.vehicleNo && e.transMode && e.transMode !== '1') problems.push('A vehicle number goes with road transport.');
  if (e.transMode && e.transMode !== '1' && !e.transDocNo) problems.push('Rail, air and ship need the transport document number.');
  return problems;
}

/**
 * Last day an e-way bill is valid for ordinary cargo: one day for up to 200 km
 * and one more for every further 200 km or part, each day ending at midnight
 * of the day after generation.
 */
export function eWayBillValidUntil(generatedIso: string, distanceKm: number): string {
  const days = Math.max(1, Math.ceil(Math.max(distanceKm, 1) / 200));
  const d = new Date(`${generatedIso.slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
