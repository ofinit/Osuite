import { financialYear } from '@osuite/kernel';
import { sql } from 'drizzle-orm';
import type { Tx } from '../db/client.ts';
import { sequences } from '../db/tables.ts';

/**
 * Next number for a document series within the Indian financial year of
 * `date`, e.g. INV/26-27/0001. Runs inside the caller's transaction, so a
 * rolled-back posting does not consume a number (GST requires no gaps).
 */
export async function nextDocumentNumber(tx: Tx, code: string, date: string): Promise<string> {
  const period = financialYear(date);
  const [row] = await tx
    .insert(sequences)
    .values({ code, period, lastValue: 1 })
    .onConflictDoUpdate({
      target: [sequences.code, sequences.period],
      set: { lastValue: sql`${sequences.lastValue} + 1` },
    })
    .returning({ value: sequences.lastValue });
  return `${code}/${period}/${String(row!.value).padStart(4, '0')}`;
}
