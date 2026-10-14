import { z } from 'zod';
import type { FieldDef, ModelDef } from './model.ts';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function decimalPattern(precision = 16, scale = 2): RegExp {
  const intDigits = precision - scale;
  return new RegExp(`^-?\\d{1,${intDigits}}(\\.\\d{1,${scale}})?$`);
}

function fieldSchema(field: FieldDef): z.ZodType {
  switch (field.type) {
    case 'char':
    case 'phone': {
      let s = z.string().trim();
      if (field.maxLength) s = s.max(field.maxLength);
      return s;
    }
    case 'email':
      return z.string().trim().pipe(z.email());
    case 'text':
      return z.string();
    case 'int': {
      let n = z.number().int();
      if (field.min !== undefined) n = n.min(field.min);
      return n;
    }
    case 'decimal': {
      const re = decimalPattern(field.precision, field.scale);
      // Accept numbers from loose clients but always normalise to string.
      return z
        .union([z.string(), z.number()])
        .transform((v) => (typeof v === 'number' ? String(v) : v.trim()))
        .refine((v) => re.test(v), { message: `Must be a number with at most ${field.scale ?? 2} decimals` });
    }
    case 'bool':
      return z.boolean();
    case 'date':
      return z.string().regex(DATE_RE, 'Expected YYYY-MM-DD');
    case 'datetime':
      return z.iso.datetime({ offset: true });
    case 'selection': {
      const values = field.options.map(([v]) => v);
      return z.string().refine((v) => values.includes(v), { message: `Must be one of: ${values.join(', ')}` });
    }
    case 'many2one':
      return z.number().int().positive();
    case 'lines':
      throw new Error('lines fields are validated per row with the child model');
  }
}

/** Current local date as YYYY-MM-DD (business dates follow the local calendar). */
export function localToday(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Empty strings from forms are treated as "no value". */
const emptyToNull = (v: unknown) => (v === '' ? null : v);

/**
 * Builds the input schema for create (required fields enforced) or update
 * (every field optional, unknown keys rejected).
 */
export function inputSchema(model: ModelDef, mode: 'create' | 'update') {
  const shape: Record<string, z.ZodType> = {};
  for (const [name, field] of Object.entries(model.fields)) {
    if (field.readonly || field.type === 'lines') continue;
    const base = fieldSchema(field);
    const fallback = 'default' in field ? field.default : undefined;
    if (mode === 'create' && fallback === 'today') {
      shape[name] = z.preprocess((v) => (v === undefined || v === '' || v === null ? localToday() : v), base);
      continue;
    }
    if (mode === 'create' && fallback !== undefined) {
      // Omitted/blank values take the field default.
      shape[name] = z.preprocess((v) => (v === undefined || v === '' || v === null ? fallback : v), base);
    } else if (mode === 'create' && field.required) {
      shape[name] = z.preprocess(emptyToNull, base);
    } else {
      shape[name] = z.preprocess(emptyToNull, base.nullable()).optional();
    }
  }
  return z.strictObject(shape);
}

export type FieldErrors = Record<string, string>;

export function flattenErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    out[key] ??= issue.code === 'invalid_type' && issue.input == null ? 'Required' : issue.message;
  }
  return out;
}
