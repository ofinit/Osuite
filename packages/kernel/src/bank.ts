// Bank statement CSV parsing: detects the columns Indian banks use and
// normalises their date and amount formats.
import Decimal from 'decimal.js';

export type StatementColumn = 'date' | 'description' | 'reference' | 'debit' | 'credit' | 'amount' | 'balance' | 'drcr';

export interface StatementMapping {
  date: number;
  description: number;
  reference?: number;
  /** Either separate withdrawal/deposit columns... */
  debit?: number;
  credit?: number;
  /** ...or one signed amount column, optionally with a Dr/Cr column. */
  amount?: number;
  drcr?: number;
  balance?: number;
}

export interface StatementRow {
  date: string;
  description: string;
  reference: string | null;
  /** Signed: positive = money in (deposit), negative = money out. */
  amount: string;
  balance: string | null;
}

/** Minimal RFC 4180 CSV parser (quoted fields, escaped quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

const HEADER_PATTERNS: [StatementColumn, RegExp][] = [
  ['date', /^(txn |transaction |value )?date$|^tran date$|^date$/i],
  ['description', /narration|description|particulars|remarks|details/i],
  ['reference', /chq|cheque|ref(erence)?( no\.?)?|utr|instrument/i],
  ['debit', /withdrawal|debit|dr\.? ?amount|^dr$|paid out/i],
  ['credit', /deposit|credit|cr\.? ?amount|^cr$|paid in/i],
  ['balance', /balance/i],
  ['drcr', /^(dr\s*\/\s*cr|cr\s*\/\s*dr|type)$/i],
  ['amount', /^(transaction )?amount( \(inr\))?$/i],
];

/**
 * Finds the header row (within the first rows, since banks print account
 * details above it) and maps its columns. Returns null when no date and
 * amount columns can be found.
 */
export function detectStatement(rows: string[][]): { headerRow: number; mapping: StatementMapping } | null {
  for (let h = 0; h < Math.min(rows.length, 25); h++) {
    const headers = rows[h]!.map((c) => c.trim());
    const found: Partial<Record<StatementColumn, number>> = {};
    headers.forEach((name, i) => {
      for (const [col, re] of HEADER_PATTERNS) {
        if (found[col] === undefined && re.test(name)) {
          // "Value Date" is a second date; keep the first date column.
          if (col === 'date' && found.date !== undefined) continue;
          // "Closing Balance" must not be read as credit, "Debit" before "Credit".
          if ((col === 'debit' || col === 'credit') && /balance/i.test(name)) continue;
          found[col] = i;
          break;
        }
      }
    });
    const hasAmount = (found.debit !== undefined && found.credit !== undefined) || found.amount !== undefined;
    if (found.date !== undefined && found.description !== undefined && hasAmount) {
      const mapping: StatementMapping = { date: found.date, description: found.description };
      for (const k of ['reference', 'debit', 'credit', 'amount', 'drcr', 'balance'] as const) if (found[k] !== undefined) mapping[k] = found[k];
      if (mapping.debit !== undefined && mapping.credit !== undefined) delete mapping.amount;
      return { headerRow: h, mapping };
    }
  }
  return null;
}

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };

/** Indian bank dates: 05/10/2026, 5/10/26, 05-10-2026, 05-Oct-2026, 05 Oct 26, 2026-10-05. */
export function parseBankDate(raw: string): string | null {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s);
  let y: number;
  let mo: number;
  let d: number;
  if (m) [, y, mo, d] = m.map(Number) as [number, number, number, number];
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(s))) {
    [d, mo, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
  } else if ((m = /^(\d{1,2})[\s/-]([A-Za-z]{3,4})[\s/-](\d{2,4})$/.exec(s))) {
    d = Number(m[1]);
    mo = MONTHS[m[2]!.toLowerCase()] ?? 0;
    y = Number(m[3]);
  } else return null;
  if (y < 100) y += 2000;
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (mo < 1 || mo > 12 || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** "1,23,456.78", "₹ 500", "(250.00)", "500.00 Dr", "-12" -> signed decimal string, or null when empty. */
export function parseBankAmount(raw: string): string | null {
  let s = raw.trim();
  if (!s || s === '-') return null;
  let negative = false;
  if (/\bdr\.?$/i.test(s)) {
    negative = true;
    s = s.replace(/\bdr\.?$/i, '');
  } else s = s.replace(/\bcr\.?$/i, '');
  if (/^\(.*\)$/.test(s.trim())) {
    negative = true;
    s = s.trim().slice(1, -1);
  }
  s = s.replace(/[₹,\s]|INR|Rs\.?/gi, '');
  if (s.startsWith('-')) {
    negative = !negative;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const v = new Decimal(s).toDecimalPlaces(2);
  return (negative ? v.neg() : v).toFixed(2);
}

export interface ParseResult {
  rows: StatementRow[];
  /** Data rows that could not be read, with the reason (1-based line numbers). */
  skipped: { line: number; reason: string }[];
}

/** Applies a mapping to the data rows after the header. */
export function readStatement(rows: string[][], headerRow: number, map: StatementMapping): ParseResult {
  const out: StatementRow[] = [];
  const skipped: ParseResult['skipped'] = [];
  for (let i = headerRow + 1; i < rows.length; i++) {
    const r = rows[i]!;
    const cell = (c: number | undefined) => (c === undefined ? '' : (r[c] ?? '').trim());
    const date = parseBankDate(cell(map.date));
    if (!date) {
      // Footer lines ("Statement summary", totals) have no date: ignore quietly.
      if (cell(map.date)) skipped.push({ line: i + 1, reason: `Unreadable date "${cell(map.date)}"` });
      continue;
    }
    let amount: string | null;
    if (map.debit !== undefined && map.credit !== undefined) {
      const out_ = parseBankAmount(cell(map.debit));
      const in_ = parseBankAmount(cell(map.credit));
      amount = in_ && Number(in_) !== 0 ? in_ : out_ && Number(out_) !== 0 ? new Decimal(out_).abs().neg().toFixed(2) : null;
    } else {
      amount = parseBankAmount(cell(map.amount));
      const flag = cell(map.drcr).toLowerCase();
      if (amount && /^d/.test(flag)) amount = new Decimal(amount).abs().neg().toFixed(2);
      if (amount && /^c/.test(flag)) amount = new Decimal(amount).abs().toFixed(2);
    }
    if (!amount || Number(amount) === 0) {
      skipped.push({ line: i + 1, reason: 'No amount' });
      continue;
    }
    out.push({
      date,
      description: cell(map.description).replace(/\s+/g, ' ') || '(no description)',
      reference: cell(map.reference) || null,
      amount,
      balance: parseBankAmount(cell(map.balance)),
    });
  }
  return { rows: out, skipped };
}
