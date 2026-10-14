import { companySchema, flattenErrors, type Company } from '@osuite/kernel';
import { eq } from 'drizzle-orm';
import type { Tx } from '../db/client.ts';
import { settings } from '../db/tables.ts';
import { RecordError } from './errors.ts';

export type { Company };

export async function getCompany(tx: Tx): Promise<Company | null> {
  const [row] = await tx.select().from(settings).where(eq(settings.key, 'company'));
  return (row?.value as Company) ?? null;
}

export async function updateCompany(tx: Tx, input: unknown): Promise<Company> {
  const parsed = companySchema.safeParse(input);
  if (!parsed.success) throw new RecordError(422, 'Please fix the highlighted fields', flattenErrors(parsed.error));
  await tx
    .insert(settings)
    .values({ key: 'company', value: parsed.data })
    .onConflictDoUpdate({ target: settings.key, set: { value: parsed.data } });
  return parsed.data;
}
