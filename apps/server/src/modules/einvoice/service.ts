// E-invoicing: builds the IRP payload from a posted sales document, checks it,
// sends it through the configured provider and records the IRN, the signed QR
// and any e-way bill on the document, with an audit entry for each step.
import { randomBytes } from 'node:crypto';
import {
  buildEInvoice,
  buildEWayBill,
  eInvoiceSkipReason,
  isService,
  localToday,
  validateEInvoice,
  validateEWayBill,
  type EInvoiceDocType,
  type EWayBillInput,
} from '@osuite/kernel';
import { asc, eq } from 'drizzle-orm';
import type { Db, Tx } from '../../db/client.ts';
import { settings, tableFor } from '../../db/tables.ts';
import { appendAudit } from '../../services/audit.ts';
import { getCompany } from '../../services/company.ts';
import { RecordError } from '../../services/errors.ts';
import { CANCEL_REASONS, createSimulator, IrpRejection, type CancelReason, type EInvoiceProvider } from './providers.ts';

export interface EInvoiceSettings {
  enabled: boolean;
  provider: string;
}

const DEFAULTS: EInvoiceSettings = { enabled: false, provider: 'simulator' };
const DAY_MS = 24 * 60 * 60 * 1000;

/** Sales documents that are e-invoiced, with how to read them. */
const DOCS: Record<string, { type: EInvoiceDocType; lineModel: string; inverse: string; original?: { field: string; model: string } }> = {
  'sales.invoice': { type: 'INV', lineModel: 'sales.invoice_line', inverse: 'invoiceId' },
  'sales.credit_note': { type: 'CRN', lineModel: 'sales.credit_note_line', inverse: 'creditNoteId', original: { field: 'invoiceId', model: 'sales.invoice' } },
};

async function readSetting<T>(tx: Tx, key: string): Promise<T | null> {
  const [row] = await tx.select().from(settings).where(eq(settings.key, key));
  return (row?.value as T) ?? null;
}
async function writeSetting(tx: Tx, key: string, value: unknown) {
  await tx.insert(settings).values({ key, value }).onConflictDoUpdate({ target: settings.key, set: { value } });
}

export function createEInvoiceService(db: Db) {
  let simulator: EInvoiceProvider | undefined;

  async function getSettings(tx: Tx = db): Promise<EInvoiceSettings> {
    return { ...DEFAULTS, ...((await readSetting<EInvoiceSettings>(tx, 'einvoice')) ?? {}) };
  }

  async function providers(): Promise<EInvoiceProvider[]> {
    if (!simulator) {
      // The simulator's signing key lives with the data, so its QR codes verify across restarts.
      let key = await readSetting<string>(db, 'einvoice.simulatorKey');
      if (!key) {
        key = randomBytes(32).toString('base64url');
        await writeSetting(db, 'einvoice.simulatorKey', key);
      }
      simulator = createSimulator(key);
    }
    return [simulator];
  }

  async function provider(tx: Tx): Promise<EInvoiceProvider> {
    const s = await getSettings(tx);
    if (!s.enabled) throw new RecordError(409, 'E-invoicing is turned off. An administrator can turn it on under Settings → E-invoicing.');
    const p = (await providers()).find((x) => x.id === s.provider);
    if (!p) throw new RecordError(409, `The e-invoicing provider "${s.provider}" is not available in this version.`);
    return p;
  }

  function docOf(model: string) {
    const d = DOCS[model];
    if (!d) throw new RecordError(404, 'This document type is not e-invoiced');
    return d;
  }

  /** The document, its lines and the parties, as the payload needs them. */
  async function load(tx: Tx, model: string, id: number, lock = false) {
    const d = docOf(model);
    const t = tableFor(model);
    const q = tx.select().from(t).where(eq(t.id, id));
    const [record] = lock ? await q.for('update') : await q;
    if (!record) throw new RecordError(404, 'Document not found');
    const lt = tableFor(d.lineModel);
    const lines = await tx.select().from(lt).where(eq(lt[d.inverse], id)).orderBy(asc(lt.sequence));
    const contacts = tableFor('base.contact');
    const [customer] = await tx.select().from(contacts).where(eq(contacts.id, record.customerId as number));
    const company = await getCompany(tx);
    let original: { number: string; date: string } | null = null;
    if (d.original) {
      const ot = tableFor(d.original.model);
      const [o] = await tx.select({ number: ot.number, date: ot.date }).from(ot).where(eq(ot.id, record[d.original.field] as number));
      if (o) original = { number: String(o.number), date: String(o.date) };
    }
    const payload = buildEInvoice({
      docType: d.type,
      number: String(record.number ?? ''),
      date: String(record.date),
      seller: {
        gstin: company?.gstin ?? '',
        legalName: company?.name ?? '',
        street: company?.street,
        street2: company?.street2,
        city: company?.city,
        pincode: company?.pincode,
        stateCode: company?.stateCode,
        phone: company?.phone,
        email: company?.email,
      },
      buyer: {
        gstin: String(record.customerGstin ?? customer?.gstin ?? ''),
        legalName: String(customer?.name ?? ''),
        street: customer?.street as string | null,
        street2: customer?.street2 as string | null,
        city: customer?.city as string | null,
        pincode: customer?.pincode as string | null,
        stateCode: (customer?.stateCode as string | null) ?? String(record.customerGstin ?? '').slice(0, 2),
        phone: customer?.phone as string | null,
        email: customer?.email as string | null,
      },
      placeOfSupply: String(record.placeOfSupply),
      lines: lines.map((l) => ({
        description: String(l.description),
        hsnCode: l.hsnCode as string | null,
        qty: String(l.qty),
        uom: String(l.uom),
        unitPrice: String(l.unitPrice),
        discountPct: l.discountPct as string | null,
        gstRate: String(l.gstRate),
      })),
      totals: {
        taxable: String(record.taxableAmount),
        cgst: String(record.cgstAmount),
        sgst: String(record.sgstAmount),
        igst: String(record.igstAmount),
        roundOff: String(record.roundOff),
        total: String(record.totalAmount),
      },
      original,
    });
    return { record, lines, payload };
  }

  /** Turns a provider failure into something the user can act on. */
  async function call<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof IrpRejection) throw new RecordError(422, `The portal rejected the ${what}: ${e.message} (code ${e.code})`);
      throw new RecordError(502, `Could not reach the e-invoicing portal (${(e as Error).message}). Nothing was changed; try again.`);
    }
  }

  return {
    getSettings: () => getSettings(),
    async saveSettings(input: Partial<EInvoiceSettings>) {
      const next = { ...(await getSettings()), ...input };
      if (typeof next.enabled !== 'boolean') throw new RecordError(400, 'Invalid setting');
      if (!(await providers()).some((p) => p.id === next.provider)) throw new RecordError(400, `Unknown provider "${next.provider}"`);
      await writeSetting(db, 'einvoice', { enabled: next.enabled, provider: next.provider });
      return next;
    },
    async providerList() {
      return (await providers()).map((p) => ({ id: p.id, label: p.label, simulated: p.simulated }));
    },

    /** The payload and everything wrong with it, without sending anything. */
    async preview(model: string, id: number) {
      const { record, payload } = await load(db, model, id);
      const s = await getSettings();
      return {
        enabled: s.enabled,
        skipReason: eInvoiceSkipReason({ buyerGstin: payload.BuyerDtls.Gstin, state: String(record.state) }),
        problems: validateEInvoice(payload, localToday()),
        payload,
      };
    },

    async generate(model: string, id: number, userId: number) {
      return db.transaction(async (tx) => {
        const p = await provider(tx);
        const { record, payload } = await load(tx, model, id, true);
        if (record.irnStatus === 'active') throw new RecordError(409, `This document already has an e-invoice (IRN ${String(record.irn).slice(0, 12)}…).`);
        if (record.irnStatus === 'cancelled') throw new RecordError(409, 'The e-invoice for this document was cancelled. The IRP does not accept the same number again; cancel this document and issue a new one.');
        const skip = eInvoiceSkipReason({ buyerGstin: payload.BuyerDtls.Gstin, state: String(record.state) });
        if (skip) throw new RecordError(422, skip);
        const problems = validateEInvoice(payload, localToday());
        if (problems.length) throw new RecordError(422, `Fix these before generating the e-invoice: ${problems.join(' ')}`);
        const r = await call('e-invoice', () => p.generateIrn(payload));
        const t = tableFor(model);
        const patch = { irnStatus: 'active', irn: r.irn, irnAckNo: r.ackNo, irnAckDate: r.ackDate, irnSignedQr: r.signedQr, irnSimulated: r.simulated, updatedBy: userId };
        await tx.update(t).set(patch).where(eq(t.id, id));
        await appendAudit(tx, {
          userId,
          model,
          recordId: id,
          action: 'einvoice',
          changes: { irn: { from: null, to: r.irn }, irnAckNo: { from: null, to: r.ackNo }, ...(r.simulated ? { provider: { from: null, to: 'simulator' } } : {}) },
        });
        return { irn: r.irn, ackNo: r.ackNo, ackDate: r.ackDate, simulated: r.simulated };
      });
    },

    async cancel(model: string, id: number, input: { reason?: string; remark?: string }, userId: number) {
      if (!CANCEL_REASONS.some(([c]) => c === input.reason)) throw new RecordError(400, 'Choose a cancellation reason');
      const remark = (input.remark ?? '').trim();
      if (remark.length < 3 || remark.length > 100) throw new RecordError(400, 'Give a remark of 3 to 100 characters');
      return db.transaction(async (tx) => {
        const p = await provider(tx);
        const { record } = await load(tx, model, id, true);
        if (record.irnStatus !== 'active') throw new RecordError(409, 'This document has no active e-invoice.');
        if (record.ewbStatus === 'active') throw new RecordError(409, 'Cancel the e-way bill first; the portal does not cancel an e-invoice that has an active e-way bill.');
        if (Date.now() - Date.parse(String(record.irnAckDate)) > DAY_MS)
          throw new RecordError(409, 'An e-invoice can only be cancelled within 24 hours of generation. Issue a credit note instead.');
        await call('cancellation', () => p.cancelIrn(String(record.irn), input.reason as CancelReason, remark));
        const t = tableFor(model);
        await tx.update(t).set({ irnStatus: 'cancelled', updatedBy: userId }).where(eq(t.id, id));
        await appendAudit(tx, {
          userId,
          model,
          recordId: id,
          action: 'einvoice_cancel',
          changes: { irnStatus: { from: 'active', to: 'cancelled' }, reason: { from: null, to: `${CANCEL_REASONS.find(([c]) => c === input.reason)![1]}: ${remark}` } },
        });
        return { cancelled: true };
      });
    },

    async cancelEWayBill(model: string, id: number, input: { reason?: string; remark?: string }, userId: number) {
      if (!CANCEL_REASONS.some(([c]) => c === input.reason)) throw new RecordError(400, 'Choose a cancellation reason');
      const remark = (input.remark ?? '').trim();
      if (remark.length < 3 || remark.length > 100) throw new RecordError(400, 'Give a remark of 3 to 100 characters');
      return db.transaction(async (tx) => {
        const p = await provider(tx);
        const { record } = await load(tx, model, id, true);
        if (record.ewbStatus !== 'active') throw new RecordError(409, 'This invoice has no active e-way bill.');
        if (Date.now() - Date.parse(String(record.ewbDate)) > DAY_MS) throw new RecordError(409, 'An e-way bill can only be cancelled within 24 hours of generation.');
        await call('e-way bill cancellation', () => p.cancelEwb(String(record.ewbNo), input.reason as CancelReason, remark));
        const t = tableFor(model);
        await tx.update(t).set({ ewbStatus: 'cancelled', updatedBy: userId }).where(eq(t.id, id));
        await appendAudit(tx, { userId, model, recordId: id, action: 'ewaybill_cancel', changes: { ewbStatus: { from: 'active', to: 'cancelled' }, reason: { from: null, to: remark } } });
        return { cancelled: true };
      });
    },

    async eWayBill(model: string, id: number, input: EWayBillInput & Record<string, unknown>, userId: number) {
      if (model !== 'sales.invoice') throw new RecordError(400, 'E-way bills are generated from invoices');
      return db.transaction(async (tx) => {
        const p = await provider(tx);
        const { record, lines } = await load(tx, model, id, true);
        if (record.irnStatus !== 'active') throw new RecordError(409, 'Generate the e-invoice first; the e-way bill is created from its IRN.');
        if (record.ewbStatus === 'active') throw new RecordError(409, `This invoice already has e-way bill ${String(record.ewbNo)}.`);
        if (record.ewbStatus === 'cancelled') throw new RecordError(409, 'The e-way bill for this invoice was cancelled; the portal allows one e-way bill per IRN.');
        if (lines.every((l) => isService(l.hsnCode as string | null))) throw new RecordError(422, 'This invoice has only services; an e-way bill is for moving goods.');
        const e: EWayBillInput = {
          irn: String(record.irn),
          distanceKm: Number(input.distanceKm),
          transMode: (input.transMode as EWayBillInput['transMode']) ?? null,
          transporterGstin: (input.transporterGstin as string) || null,
          transporterName: (input.transporterName as string) || null,
          vehicleNo: (input.vehicleNo as string) || null,
          transDocNo: (input.transDocNo as string) || null,
          transDocDate: (input.transDocDate as string) || null,
        };
        const problems = validateEWayBill(e);
        if (problems.length) throw new RecordError(422, problems.join(' '));
        const r = await call('e-way bill', () => p.generateEwb(buildEWayBill(e)));
        const t = tableFor(model);
        await tx.update(t).set({ ewbStatus: 'active', ewbNo: r.ewbNo, ewbDate: r.ewbDate, ewbValidUntil: r.validUntil, updatedBy: userId }).where(eq(t.id, id));
        await appendAudit(tx, {
          userId,
          model,
          recordId: id,
          action: 'ewaybill',
          changes: { ewbNo: { from: null, to: r.ewbNo }, vehicleNo: { from: null, to: e.vehicleNo }, distanceKm: { from: null, to: e.distanceKm } },
        });
        return r;
      });
    },
  };
}

export type EInvoiceService = ReturnType<typeof createEInvoiceService>;
