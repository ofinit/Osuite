// Building blocks shared by GST documents (invoices, bills, credit and debit
// notes): line fields, total fields and the hooks that compute, post and cancel them.
import { computeGst, isIntraState, isValidGstin, money, netUnitCost, type FieldDef, type ModelDef } from '@osuite/kernel';
import { and, asc, eq, ne, sql } from 'drizzle-orm';
import type { Tx } from '../db/client.ts';
import { tableFor } from '../db/tables.ts';
import { getCompany } from '../services/company.ts';
import { RecordError } from '../services/errors.ts';
import type { HookCtx, ModelHooks, Values } from '../services/hooks.ts';
import { nextDocumentNumber } from '../services/numbering.ts';
import { journalLines, postJournal, reverseJournal, type JournalKind } from './account/journal.ts';
import { reverseSettlements } from './account/credits.ts';
import { settle, type Direction } from './account/service.ts';
import { GST_RATES, UOMS } from './base/index.ts';
import { defaultWarehouseId, goodsProductIds, postMoves, reverseMoves } from './stock/service.ts';

export const DOC_STATES = [
  ['draft', 'Draft'],
  ['posted', 'Posted'],
  ['cancelled', 'Cancelled'],
] as const;

const amount = (label: string) => ({ type: 'decimal', label, scale: 2, readonly: true }) as const;

/**
 * Fields of a GST line. `inverse` names the many2one back to the document and
 * `price` is the product field that fills the rate.
 */
export function gstLineFields(o: { inverse: string; parent: string; parentLabel: string; price: 'salePrice' | 'costPrice' }): Record<string, FieldDef> {
  return {
    [o.inverse]: { type: 'many2one', label: o.parentLabel, relation: o.parent, onDelete: 'cascade' },
    sequence: { type: 'int', label: 'No.', readonly: true },
    productId: {
      type: 'many2one',
      label: 'Product',
      relation: 'base.product',
      fill: { description: 'name', hsnCode: 'hsnCode', uom: 'uom', unitPrice: o.price, gstRate: 'gstRate' },
    },
    description: { type: 'char', label: 'Description', required: true, maxLength: 300 },
    hsnCode: { type: 'char', label: 'HSN/SAC', maxLength: 8 },
    qty: { type: 'decimal', label: 'Qty', scale: 3, precision: 14, required: true, default: '1' },
    uom: { type: 'selection', label: 'Unit', options: UOMS, default: 'NOS', required: true },
    unitPrice: { type: 'decimal', label: 'Rate', scale: 2, required: true, default: '0' },
    discountPct: { type: 'decimal', label: 'Disc %', scale: 2, precision: 5, default: '0' },
    gstRate: { type: 'selection', label: 'GST', options: GST_RATES, default: '18', required: true },
    taxableAmount: amount('Taxable'),
    taxAmount: amount('Tax'),
    totalAmount: amount('Amount'),
  };
}

export const GST_LINE_COLUMNS = ['productId', 'description', 'hsnCode', 'qty', 'uom', 'unitPrice', 'discountPct', 'gstRate', 'taxableAmount'];

export const gstTotalFields = {
  taxableAmount: amount('Taxable value'),
  cgstAmount: amount('CGST'),
  sgstAmount: amount('SGST'),
  igstAmount: amount('IGST'),
  roundOff: amount('Round off'),
  totalAmount: amount('Total'),
} as const;

export const PAYMENT_STATES = [
  ['unpaid', 'Unpaid'],
  ['partial', 'Partly paid'],
  ['paid', 'Paid'],
] as const;

/** Settlement fields, maintained by payments and notes once the document is posted. */
export const paymentFields = {
  amountPaid: { type: 'decimal', label: 'Paid or credited', scale: 2, readonly: true, default: '0', visibleWhen: { state: 'posted' } },
  amountDue: { type: 'decimal', label: 'Balance due', scale: 2, readonly: true, default: '0', visibleWhen: { state: 'posted' } },
  paymentState: {
    type: 'selection',
    label: 'Payment',
    options: PAYMENT_STATES,
    default: 'unpaid',
    readonly: true,
    badge: true,
    index: true,
    visibleWhen: { state: 'posted' },
  },
} as const;

export const NOTE_REASONS = [
  ['return', 'Goods returned'],
  ['rate', 'Rate difference'],
  ['discount', 'Discount after sale'],
  ['other', 'Other correction'],
] as const;

/** What a posted note did to its original document's balance. */
export const noteSettlementFields = {
  amountApplied: { type: 'decimal', label: 'Applied to the original', scale: 2, readonly: true, default: '0', visibleWhen: { state: 'posted' } },
  unappliedAmount: { type: 'decimal', label: 'Left as credit', scale: 2, readonly: true, default: '0', visibleWhen: { state: 'posted' } },
} as const;

/** A note (credit/debit) is issued against an original posted document. */
export interface AppliesTo {
  /** many2one on the note pointing at the original document. */
  field: string;
  model: string;
  lineModel: string;
  lineInverse: string;
  /** The note's own line model and its many2one back to the note. */
  ownLineModel: string;
  ownLineInverse: string;
  /** Settlement side: credit notes reduce what a customer owes (inbound). */
  direction: Direction;
  label: string;
}

interface GstDocOptions {
  /** Numbering series, e.g. 'INV' -> INV/26-27/0001. */
  prefix: string;
  /** many2one to the customer/vendor contact. */
  partnerField: string;
  /** GSTIN snapshot field on the document. */
  gstinField: string;
  /** The partner's registered state; when set, the GSTIN must belong to it. */
  partnerStateField?: string;
  /** Extra checks when posting (inside the posting transaction). */
  beforePost?: (ctx: HookCtx, record: Values) => Promise<void>;
  /** Goods lines move stock in or out of `warehouseId`. */
  stock?: 'in' | 'out';
  /** Journal entry written on posting. */
  journal: JournalKind;
  /** Notes settle against, and take stock cost from, their original document. */
  appliesTo?: AppliesTo;
}

const STOCK_KIND = { sale: 'sale', purchase: 'purchase', sale_return: 'return', purchase_return: 'return' } as const;
const TOTALS = ['taxableAmount', 'cgstAmount', 'sgstAmount', 'igstAmount', 'roundOff', 'totalAmount'] as const;
const COPY_LINE_FIELDS = ['productId', 'description', 'hsnCode', 'qty', 'uom', 'unitPrice', 'discountPct', 'gstRate', 'taxableAmount', 'taxAmount', 'totalAmount'];

/** Unit cost per product from the stock movements of a posted document. */
async function sourceUnitCosts(tx: Tx, refModel: string, refId: number): Promise<Map<number, string>> {
  const moves = tableFor('stock.move');
  const rows = await tx
    .select({ productId: moves.productId, unitCost: moves.unitCost })
    .from(moves)
    .where(and(eq(moves.refModel, refModel), eq(moves.refId, refId), ne(moves.kind, 'reversal')));
  return new Map(rows.map((r) => [r.productId as number, String(r.unitCost)]));
}

export function gstDocumentHooks(model: ModelDef, opts: GstDocOptions): ModelHooks {
  const pos = model.gst!.placeOfSupplyField;
  const src = (record: Values, reference = String(record.number)) => ({
    date: String(record.date),
    reference,
    refModel: model.name,
    refId: record.id as number,
  });

  /** Checks and locks the original document of a note. */
  async function original(tx: Tx, record: Values): Promise<Values> {
    const a = opts.appliesTo!;
    const t = tableFor(a.model);
    const notes = tableFor(model.name);
    const [doc] = await tx.select().from(t).where(eq(t.id, record[a.field] as number)).for('update');
    if (!doc || doc.state !== 'posted') throw new RecordError(422, `Choose a posted ${a.label}.`);
    if (doc[opts.partnerField] !== record[opts.partnerField]) throw new RecordError(422, `${String(doc.number)} belongs to a different party.`);
    // All notes against one document together cannot exceed it.
    const [prior] = await tx
      .select({ total: sql<string>`coalesce(sum(${notes.totalAmount}), 0)` })
      .from(notes)
      .where(and(eq(notes[a.field], doc.id as number), eq(notes.state, 'posted')));
    const available = money.sub(doc.totalAmount as string, prior!.total);
    if (money.cmp(record.totalAmount as string, available) > 0)
      throw new RecordError(422, `Only ₹${available} of ${String(doc.number)} is left to adjust; this note is ₹${String(record.totalAmount)}.`);
    return doc;
  }

  const actions: NonNullable<ModelHooks['actions']> = {
    async post(ctx, record, lines) {
      if (!(lines.lines ?? []).length) throw new RecordError(422, 'Add at least one item before posting.');
      if (Number(record.totalAmount) <= 0) throw new RecordError(422, 'The total must be more than zero.');
      await opts.beforePost?.(ctx, record);
      const orig = opts.appliesTo ? await original(ctx.tx, record) : null;
      // Freeze the partner's GSTIN as it was on this document.
      let gstin = record[opts.gstinField] as string | null;
      if (!gstin) {
        const contacts = tableFor('base.contact');
        const [c] = await ctx.tx.select({ gstin: contacts.gstin }).from(contacts).where(eq(contacts.id, record[opts.partnerField] as number));
        gstin = (c?.gstin as string | null) ?? null;
      }
      const number = await nextDocumentNumber(ctx.tx, opts.prefix, String(record.date));

      // Notes only move stock when goods actually come back (or go back).
      let stockValue = '0.00';
      const rows = (lines.lines ?? []) as Values[];
      if (opts.stock && (!orig || record.reason === 'return')) {
        const goods = await goodsProductIds(ctx.tx, rows.map((l) => l.productId).filter((v): v is number => typeof v === 'number'));
        // Returns move goods at the original document's cost, not today's average.
        const costs = orig ? await sourceUnitCosts(ctx.tx, opts.appliesTo!.model, orig.id as number) : new Map<number, string>();
        ({ value: stockValue } = await postMoves(
          ctx.tx,
          src(record, number),
          rows
            .filter((l) => goods.has(l.productId as number))
            .map((l) => ({
              productId: l.productId as number,
              warehouseId: record.warehouseId as number,
              qty: opts.stock === 'in' ? String(l.qty) : String(-Number(l.qty)),
              // Purchases add stock at net cost (GST is an input credit, not cost).
              unitCost: orig ? costs.get(l.productId as number) : opts.stock === 'in' ? netUnitCost(l.qty as string, l.taxableAmount as string) : undefined,
              atCost: !!orig && costs.has(l.productId as number),
              kind: STOCK_KIND[opts.journal],
            })),
        ));
      }
      await postJournal(ctx.tx, { ...src(record, number), narration: `${model.label} ${number}` }, journalLines(opts.journal, record, stockValue));

      const patch: Values = { state: 'posted', number, [opts.gstinField]: gstin };
      if (orig) {
        // Settle what is still due on the original; any rest stays as credit.
        const applied = money.min(record.totalAmount as string, orig.amountDue as string);
        if (money.isPositive(applied))
          await settle(ctx.tx, opts.appliesTo!.direction, orig.id as number, record[opts.partnerField] as number, applied);
        patch.amountApplied = applied;
        patch.unappliedAmount = money.sub(record.totalAmount as string, applied);
      }
      return patch;
    },

    async cancel({ tx, userId }, record) {
      // A note's credit applied to other documents is returned first.
      if (opts.appliesTo) await reverseSettlements(tx, 'source', model.name, record.id as number, userId);
      if (money.isPositive(record.amountPaid as string))
        throw new RecordError(409, `Payments or credit notes of ₹${String(record.amountPaid)} are allocated to this document. Cancel those first.`);
      if (opts.appliesTo && money.isPositive(record.amountApplied as string)) {
        await settle(
          tx,
          opts.appliesTo.direction,
          record[opts.appliesTo.field] as number,
          record[opts.partnerField] as number,
          money.sub(0, record.amountApplied as string),
        );
      }
      if (opts.stock) await reverseMoves(tx, src(record));
      await reverseJournal(tx, src(record));
      return { state: 'cancelled' };
    },
  };

  if (opts.appliesTo) {
    const a = opts.appliesTo;
    /** Replaces the note's lines with the original document's lines and totals. */
    actions.copyLines = async ({ tx }, record) => {
      if (!record[a.field]) throw new RecordError(422, `Choose the ${a.label} first.`);
      const from = tableFor(a.lineModel);
      const to = tableFor(a.ownLineModel);
      const source = await tx.select().from(from).where(eq(from[a.lineInverse], record[a.field] as number)).orderBy(asc(from.sequence));
      if (!source.length) throw new RecordError(422, `That ${a.label} has no items.`);
      await tx.delete(to).where(eq(to[a.ownLineInverse], record.id as number));
      await tx.insert(to).values(
        source.map((l, i) => ({ ...Object.fromEntries(COPY_LINE_FIELDS.map((k) => [k, l[k]])), sequence: i + 1, [a.ownLineInverse]: record.id })),
      );
      // Same lines and place of supply, so the original's totals are exact.
      const doc = tableFor(a.model);
      const [o] = await tx.select().from(doc).where(eq(doc.id, record[a.field] as number));
      return Object.fromEntries(TOTALS.map((k) => [k, o![k]]));
    };
  }

  return {
    normalize(v) {
      if (typeof v[opts.gstinField] === 'string') v[opts.gstinField] = (v[opts.gstinField] as string).trim().toUpperCase();
    },

    validate(v, existing) {
      const get = (k: string) => (k in v ? v[k] : existing?.[k]);
      const errors: Record<string, string> = {};
      const gstin = get(opts.gstinField);
      if (typeof gstin === 'string' && gstin) {
        if (!isValidGstin(gstin)) errors[opts.gstinField] = 'Invalid GSTIN';
        else if (opts.partnerStateField && get(opts.partnerStateField) && gstin.slice(0, 2) !== get(opts.partnerStateField))
          errors[opts.partnerStateField] = `GSTIN is registered in state ${gstin.slice(0, 2)}`;
      }
      const date = get('date');
      const due = get('dueDate');
      if (typeof date === 'string' && typeof due === 'string' && due < date) errors.dueDate = 'Due date is before the document date';
      return errors;
    },

    async compute({ tx }, record, lines) {
      const company = await getCompany(tx);
      if (opts.stock && !record.warehouseId) record.warehouseId = await defaultWarehouseId(tx);
      // Place of supply defaults to the company's own state (typical for purchases).
      if (!record[pos] && company?.stateCode) record[pos] = company.stateCode;
      const rows = (lines.lines ?? []) as Values[];
      const r = computeGst(
        rows.map((l) => ({ qty: l.qty as string, unitPrice: l.unitPrice as string, discountPct: l.discountPct as string, gstRate: l.gstRate as string })),
        { intraState: isIntraState(model, record, company?.stateCode) },
      );
      rows.forEach((l, i) => {
        const res = r.lines[i]!;
        l.taxableAmount = res.taxable;
        l.taxAmount = res.tax;
        l.totalAmount = res.total;
      });
      record.taxableAmount = r.taxable;
      record.cgstAmount = r.cgst;
      record.sgstAmount = r.sgst;
      record.igstAmount = r.igst;
      record.roundOff = r.roundOff;
      record.totalAmount = r.total;
      if ('amountDue' in model.fields) record.amountDue = money.sub(r.total, record.amountPaid as string);
    },

    actions,
  };
}

/** Posting check: the same vendor bill number must not be booked twice. */
export function noDuplicate(modelName: string, partnerField: string, refField: string, label: string) {
  return async ({ tx }: HookCtx, record: Values) => {
    const t = tableFor(modelName);
    const [dup] = await tx
      .select({ number: t.number })
      .from(t)
      .where(
        and(
          eq(t[partnerField], record[partnerField] as number),
          sql`lower(${t[refField]}) = lower(${String(record[refField] ?? '')})`,
          eq(t.state, 'posted'),
          ne(t.id, record.id as number),
        ),
      );
    if (dup) throw new RecordError(409, `${label} ${String(record[refField])} from this vendor is already recorded as ${String(dup.number)}.`);
  };
}
