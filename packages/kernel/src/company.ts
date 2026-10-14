// Company profile: who the documents are issued by. Validated identically in
// the settings form and on the server.
import { z } from 'zod';
import { IN_STATES, isValidGstin } from './india.ts';

const STATE_CODES = IN_STATES.map(([c]) => c) as string[];
/** Logos are stored inline as data URLs; keep them small. */
export const MAX_LOGO_BYTES = 300 * 1024;

const opt = (schema: z.ZodType<string, string>) =>
  z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : typeof v === 'string' ? v.trim() : v), schema.optional());

// Built in a function marked pure so UI bundles that don't validate can drop zod.
const buildCompanySchema = () =>
  z
  .object({
    name: z.string().trim().min(1, 'Required').max(200),
    gstin: opt(z.string().transform((v) => v.toUpperCase()).pipe(z.string().refine(isValidGstin, 'Invalid GSTIN'))),
    stateCode: opt(z.string().refine((v) => STATE_CODES.includes(v), 'Choose a state')),
    pan: opt(z.string().transform((v) => v.toUpperCase()).pipe(z.string().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, 'Invalid PAN'))),
    street: opt(z.string().max(200)),
    street2: opt(z.string().max(200)),
    city: opt(z.string().max(100)),
    pincode: opt(z.string().regex(/^[1-9][0-9]{5}$/, 'PIN code must be 6 digits')),
    phone: opt(z.string().max(30)),
    email: opt(z.string().pipe(z.email('Invalid email'))),
    website: opt(z.string().max(200)),
    bankAccountName: opt(z.string().max(120)),
    bankAccountNumber: opt(z.string().regex(/^[0-9]{6,18}$/, '6 to 18 digits')),
    bankIfsc: opt(z.string().transform((v) => v.toUpperCase()).pipe(z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC'))),
    bankName: opt(z.string().max(120)),
    bankBranch: opt(z.string().max(120)),
    upiId: opt(z.string().regex(/^[a-zA-Z0-9._-]{2,256}@[a-zA-Z]{2,64}$/, 'Invalid UPI ID, e.g. business@okhdfc')),
    invoiceTerms: opt(z.string().max(2000)),
    /** Allow posting sales that take stock below zero (Tally-style). */
    allowNegativeStock: z.boolean().optional(),
    logo: opt(
      z
        .string()
        .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, 'Logo must be a PNG, JPEG or WebP image')
        .refine((v) => v.length * 0.75 <= MAX_LOGO_BYTES, 'Logo must be 300 KB or smaller'),
    ),
  })
  .superRefine((c, ctx) => {
    if (c.gstin && c.stateCode && c.gstin.slice(0, 2) !== c.stateCode)
      ctx.addIssue({ code: 'custom', path: ['stateCode'], message: `GSTIN is registered in state ${c.gstin.slice(0, 2)}` });
    if (c.gstin && c.pan && c.gstin.slice(2, 12) !== c.pan) ctx.addIssue({ code: 'custom', path: ['pan'], message: 'PAN does not match GSTIN' });
  });

export const companySchema = /* @__PURE__ */ buildCompanySchema();

export type Company = z.infer<typeof companySchema>;

/** One-line postal address, e.g. for document headers. */
export function companyAddressLines(c: Partial<Company>, stateName?: (code: string) => string | undefined): string[] {
  const cityLine = [c.city, c.pincode].filter(Boolean).join(' ');
  const state = c.stateCode ? stateName?.(c.stateCode) : undefined;
  return [c.street, c.street2, [cityLine, state].filter(Boolean).join(', ')].filter((l): l is string => !!l);
}
