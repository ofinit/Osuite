import type { FieldDef, Many2oneValue } from '@osuite/kernel';

const decimalFmt = new Map<number, Intl.NumberFormat>();

/** Indian digit grouping: 12,34,567.00 */
export function formatDecimal(v: string | number, scale = 2): string {
  let f = decimalFmt.get(scale);
  if (!f) {
    f = new Intl.NumberFormat('en-IN', { minimumFractionDigits: scale, maximumFractionDigits: scale });
    decimalFmt.set(scale, f);
  }
  return f.format(Number(v));
}

const dateFmt = new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export const formatDate = (iso: string) => dateFmt.format(new Date(iso));
export const formatDateTime = (iso: string) => dateTimeFmt.format(new Date(iso));

/** Display text for a field value in lists and history. */
export function formatValue(field: FieldDef | undefined, v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (!field) return String(v);
  switch (field.type) {
    case 'decimal':
      return formatDecimal(v as string, field.scale ?? 2);
    case 'bool':
      return v ? 'Yes' : 'No';
    case 'selection':
      return field.options.find(([k]) => k === v)?.[1] ?? String(v);
    case 'many2one':
      return typeof v === 'object' ? (v as Many2oneValue).display : `#${String(v)}`;
    case 'date':
      return formatDate(String(v));
    case 'datetime':
      return formatDateTime(String(v));
    default:
      return String(v);
  }
}

export const isNumeric = (f: FieldDef | undefined) => f?.type === 'decimal' || f?.type === 'int';
