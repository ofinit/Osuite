// The seller's own business profile (OfinIT), edited in the admin panel and
// published to the website, legal pages and apps through GET /v1/site.
import { isValidGstin } from '@osuite/kernel';
import { eq } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { HttpError } from './licensing.ts';
import { settings } from './schema.ts';

type Rule = { label: string; max: number; pattern?: RegExp; message?: string; required?: boolean };

/** Every field the website can show. Order is the order of the admin form. */
export const BUSINESS_FIELDS = {
  brandName: { label: 'Product name', max: 60, required: true },
  legalName: { label: 'Registered business name', max: 200, required: true },
  tagline: { label: 'One-line description', max: 160 },
  gstin: { label: 'GSTIN', max: 15, pattern: /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, message: 'Invalid GSTIN' },
  pan: { label: 'PAN', max: 10, pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/, message: 'Invalid PAN' },
  cin: { label: 'CIN / LLPIN', max: 21 },
  street: { label: 'Address', max: 200 },
  street2: { label: 'Address line 2', max: 200 },
  city: { label: 'City', max: 100 },
  state: { label: 'State', max: 60 },
  pincode: { label: 'PIN code', max: 6, pattern: /^[1-9][0-9]{5}$/, message: 'PIN code must be 6 digits' },
  salesEmail: { label: 'Sales email', max: 200, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Invalid email' },
  supportEmail: { label: 'Support email', max: 200, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Invalid email' },
  phone: { label: 'Phone', max: 20, pattern: /^\+?[0-9 ()-]{8,20}$/, message: 'Invalid phone number' },
  whatsapp: { label: 'WhatsApp number', max: 20, pattern: /^\+?[0-9 ()-]{8,20}$/, message: 'Invalid phone number' },
  supportHours: { label: 'Support hours', max: 120 },
  grievanceOfficer: { label: 'Grievance officer (name)', max: 120 },
  grievanceEmail: { label: 'Grievance officer email', max: 200, pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/, message: 'Invalid email' },
  refundDays: { label: 'Refund window (days)', max: 3, pattern: /^[0-9]{1,3}$/, message: 'A number of days' },
  gstNote: { label: 'Tax note on prices', max: 80 },
  downloadUrl: { label: 'Installer download URL', max: 300, pattern: /^https:\/\//, message: 'Must start with https://' },
  downloadVersion: { label: 'Installer version', max: 20, pattern: /^[0-9]+\.[0-9]+\.[0-9]+$/, message: 'Like 0.1.0' },
  downloadSize: { label: 'Installer size', max: 20 },
  linkedin: { label: 'LinkedIn URL', max: 200, pattern: /^https:\/\//, message: 'Must start with https://' },
  youtube: { label: 'YouTube URL', max: 200, pattern: /^https:\/\//, message: 'Must start with https://' },
  x: { label: 'X (Twitter) URL', max: 200, pattern: /^https:\/\//, message: 'Must start with https://' },
  instagram: { label: 'Instagram URL', max: 200, pattern: /^https:\/\//, message: 'Must start with https://' },
  facebook: { label: 'Facebook URL', max: 200, pattern: /^https:\/\//, message: 'Must start with https://' },
} satisfies Record<string, Rule>;

export type BusinessKey = keyof typeof BUSINESS_FIELDS;
export type Business = Record<BusinessKey, string>;

/** Shown until the owner fills the profile in, so the website is never broken. */
const DEFAULTS: Business = Object.assign(Object.fromEntries(Object.keys(BUSINESS_FIELDS).map((k) => [k, ''])) as Business, {
  brandName: 'OSuite',
  legalName: 'OfinIT',
  tagline: 'GST-ready accounting, invoicing and inventory for Indian businesses',
  refundDays: '14',
  gstNote: 'Prices exclude 18% GST',
});

export async function getBusiness(db: NodePgDatabase): Promise<Business> {
  const [row] = await db.select().from(settings).where(eq(settings.key, 'business'));
  return { ...DEFAULTS, ...((row?.value as Partial<Business>) ?? {}) };
}

/** Validates and stores the profile; returns the field errors instead of saving when any. */
export async function saveBusiness(db: NodePgDatabase, input: Record<string, unknown>): Promise<Business> {
  const next = { ...(await getBusiness(db)) };
  const errors: Record<string, string> = {};
  for (const [k, rule] of Object.entries(BUSINESS_FIELDS) as [BusinessKey, Rule][]) {
    if (!(k in input)) continue;
    let v = String(input[k] ?? '').trim();
    if (k === 'gstin' || k === 'pan') v = v.toUpperCase();
    if (!v && rule.required) errors[k] = `${rule.label} is required`;
    else if (v.length > rule.max) errors[k] = `${rule.label} is too long`;
    else if (v && rule.pattern && !rule.pattern.test(v)) errors[k] = rule.message ?? 'Invalid value';
    next[k] = v;
  }
  // The format check above lets a mistyped check character through; this does not.
  if (next.gstin && !errors.gstin && !isValidGstin(next.gstin)) errors.gstin = 'Invalid GSTIN';
  if (next.gstin && next.pan && next.gstin.slice(2, 12) !== next.pan) errors.pan = 'PAN does not match the GSTIN';
  if (Object.keys(errors).length) throw new HttpError(422, Object.values(errors)[0]!, errors);
  await db
    .insert(settings)
    .values({ key: 'business', value: next })
    .onConflictDoUpdate({ target: settings.key, set: { value: next, updatedAt: new Date() } });
  return next;
}
