// Period lock: the end date of the latest closed financial year.
import { desc, eq } from 'drizzle-orm';
import type { Tx } from '../../db/client.ts';
import { tableFor } from '../../db/tables.ts';

export const CLOSING_MODEL = 'account.year_close';

/** Latest locked date, or null when no year is closed. */
export async function lockDate(tx: Tx): Promise<{ fy: string; to: string } | null> {
  const t = tableFor(CLOSING_MODEL);
  const [row] = await tx.select({ fy: t.fy, to: t.dateTo }).from(t).where(eq(t.state, 'closed')).orderBy(desc(t.dateTo)).limit(1);
  return row ? { fy: String(row.fy), to: String(row.to) } : null;
}
