// Who actually talks to the GST Invoice Registration Portal. OSuite builds and
// checks the payloads; a provider only transports them. Adding a GSP means
// implementing this interface and registering it in PROVIDERS.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { eWayBillValidUntil, financialYear, type EInvoicePayload } from '@osuite/kernel';
import type { buildEWayBill } from '@osuite/kernel';

export interface IrnResult {
  irn: string;
  ackNo: string;
  /** ISO timestamp. */
  ackDate: string;
  /** The IRP-signed QR code content (a JWT) to print on the invoice. */
  signedQr: string;
  simulated: boolean;
}

export interface EwbResult {
  ewbNo: string;
  /** ISO timestamp. */
  ewbDate: string;
  /** ISO date, last valid day. */
  validUntil: string;
}

/** A failure the IRP reported for the document (wrong data), as opposed to an outage. */
export class IrpRejection extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface EInvoiceProvider {
  readonly id: string;
  readonly label: string;
  /** Simulated providers never reach the government portal. */
  readonly simulated: boolean;
  generateIrn(payload: EInvoicePayload): Promise<IrnResult>;
  cancelIrn(irn: string, reason: CancelReason, remark: string): Promise<{ cancelDate: string }>;
  generateEwb(payload: ReturnType<typeof buildEWayBill>): Promise<EwbResult>;
  cancelEwb(ewbNo: string, reason: CancelReason, remark: string): Promise<{ cancelDate: string }>;
}

/** IRP cancellation reason codes. */
export const CANCEL_REASONS = [
  ['1', 'Duplicate'],
  ['2', 'Data entry mistake'],
  ['3', 'Order cancelled'],
  ['4', 'Other'],
] as const;
export type CancelReason = (typeof CANCEL_REASONS)[number][0];

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

/** The IRN as the IRP defines it: SHA-256 of supplier GSTIN, financial year, document type and number. */
export function irnFor(p: EInvoicePayload): string {
  const [d, m, y] = p.DocDtls.Dt.split('/');
  const fy = financialYear(`${y}-${m}-${d}`); // "26-27"
  const year = `20${fy.slice(0, 2)}-${fy.slice(3)}`; // "2026-27"
  return createHash('sha256').update(`${p.SellerDtls.Gstin}${year}${p.DocDtls.Typ}${p.DocDtls.No.toUpperCase()}`).digest('hex');
}

/**
 * Offline stand-in for the IRP, for trying e-invoicing before a GSP is
 * connected and for tests. Real IRN algorithm and QR contents; the signature
 * is local and the QR says so.
 */
export function createSimulator(secret: string): EInvoiceProvider {
  const sign = (data: object) => {
    const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'OSUITE-SIMULATOR' }));
    const body = b64url(JSON.stringify({ data: JSON.stringify(data), iss: 'OSuite e-invoice simulator (not registered with the IRP)' }));
    return `${head}.${body}.${createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url')}`;
  };
  const digits = (n: number) => Array.from(randomBytes(n), (b) => String(b % 10)).join('').replace(/^0/, '1');
  return {
    id: 'simulator',
    label: 'Simulator (testing only)',
    simulated: true,
    async generateIrn(p) {
      const irn = irnFor(p);
      const ackDate = new Date().toISOString();
      const hsn = [...p.ItemList].sort((a, b) => b.AssAmt - a.AssAmt)[0]?.HsnCd ?? '';
      // Fields the IRP puts in its signed QR code.
      const signedQr = sign({
        SellerGstin: p.SellerDtls.Gstin,
        BuyerGstin: p.BuyerDtls.Gstin,
        DocNo: p.DocDtls.No,
        DocTyp: p.DocDtls.Typ,
        DocDt: p.DocDtls.Dt,
        TotInvVal: p.ValDtls.TotInvVal,
        ItemCnt: p.ItemList.length,
        MainHsnCode: hsn,
        Irn: irn,
        IrnDt: ackDate.slice(0, 19).replace('T', ' '),
      });
      return { irn, ackNo: digits(15), ackDate, signedQr, simulated: true };
    },
    async cancelIrn() {
      return { cancelDate: new Date().toISOString() };
    },
    async generateEwb(payload) {
      const ewbDate = new Date().toISOString();
      return { ewbNo: digits(12), ewbDate, validUntil: eWayBillValidUntil(ewbDate, payload.Distance || 100) };
    },
    async cancelEwb() {
      return { cancelDate: new Date().toISOString() };
    },
  };
}
