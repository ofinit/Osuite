import { money } from '@osuite/kernel';
import { eq } from 'drizzle-orm';
import type { Tx } from '../../db/client.ts';
import { tableFor } from '../../db/tables.ts';
import { RecordError } from '../../services/errors.ts';
import type { HookMap, Values } from '../../services/hooks.ts';
import { nextDocumentNumber } from '../../services/numbering.ts';
import { reverseSettlements } from './credits.ts';
import { paymentLines, postJournal, reverseJournal } from './journal.ts';
import { openItems, settle, SIDE, type Direction } from './service.ts';

async function bankLedger(tx: Tx, bankAccountId: number | null): Promise<number | null> {
  if (!bankAccountId) return null;
  const banks = tableFor('account.bank_account');
  const [b] = await tx.select({ ledger: banks.ledgerAccountId }).from(banks).where(eq(banks.id, bankAccountId));
  return (b?.ledger as number | undefined) ?? null;
}

const direction = (r: Values) => (r.direction === 'outbound' ? 'outbound' : 'inbound') as Direction;

export const hooks: HookMap = {
  'account.manual': {
    compute(_ctx, record, lines) {
      const rows = (lines.lines ?? []) as Values[];
      const errors: Record<string, string> = {};
      rows.forEach((l, i) => {
        const d = money.isPositive(l.debit as string);
        const c = money.isPositive(l.credit as string);
        if (d === c) errors[`lines.${i}.${d ? 'credit' : 'debit'}`] = d ? 'Enter a debit or a credit, not both' : 'Enter a debit or a credit';
        if (money.cmp(l.debit as string, 0) < 0) errors[`lines.${i}.debit`] = 'Use a positive amount';
        if (money.cmp(l.credit as string, 0) < 0) errors[`lines.${i}.credit`] = 'Use a positive amount';
      });
      if (Object.keys(errors).length) throw new RecordError(422, 'Please fix the highlighted lines', errors);
      record.totalDebit = money.add(...rows.map((l) => l.debit as string));
      record.totalCredit = money.add(...rows.map((l) => l.credit as string));
    },
    actions: {
      async post({ tx }, record, lines) {
        const rows = (lines.lines ?? []) as Values[];
        if (rows.length < 2) throw new RecordError(422, 'A journal needs at least two lines.');
        if (money.cmp(record.totalDebit as string, record.totalCredit as string) !== 0)
          throw new RecordError(422, `Debits (₹${String(record.totalDebit)}) and credits (₹${String(record.totalCredit)}) must be equal.`);
        const number = await nextDocumentNumber(tx, 'MJ', String(record.date));
        await postJournal(
          tx,
          { date: String(record.date), reference: number, narration: String(record.narration), refModel: 'account.manual', refId: record.id as number },
          rows.map((l) => ({
            account: l.accountId as number,
            partnerId: (l.partnerId as number | null) ?? null,
            amount: money.sub(l.debit as string, l.credit as string),
          })),
        );
        return { state: 'posted', number };
      },
      async cancel({ tx }, record) {
        await reverseJournal(tx, { date: String(record.date), reference: String(record.number), refModel: 'account.manual', refId: record.id as number });
        return { state: 'cancelled' };
      },
    },
  },

  'account.payment': {
    validate(v, existing) {
      const amount = 'amount' in v ? v.amount : existing?.amount;
      if (amount !== undefined && amount !== null && !money.isPositive(amount as string)) return { amount: 'Enter an amount above zero' };
      return undefined;
    },

    async compute({ tx }, record, lines) {
      // Non-cash payments go through a bank account (the first one by default).
      if (record.mode === 'cash') record.bankAccountId = null;
      else if (!record.bankAccountId) {
        const banks = tableFor('account.bank_account');
        const [first] = await tx.select({ id: banks.id }).from(banks).where(eq(banks.active, true)).orderBy(banks.id).limit(1);
        record.bankAccountId = first?.id ?? null;
      }
      const side = SIDE[direction(record)];
      const other = side.lineField === 'invoiceId' ? 'billId' : 'invoiceId';
      const rows = (lines.lines ?? []) as Values[];
      const errors: Record<string, string> = {};
      rows.forEach((l, i) => {
        l[other] = null; // only the matching document type applies
        if (!l[side.lineField]) errors[`lines.${i}.${side.lineField}`] = `Choose ${side.label === 'invoice' ? 'an invoice' : 'a bill'}`;
        if (!money.isPositive(l.amount as string)) errors[`lines.${i}.amount`] = 'Enter an amount above zero';
      });
      if (Object.keys(errors).length) throw new RecordError(422, 'Please fix the highlighted fields', errors);
      const allocated = money.add(...rows.map((l) => l.amount as string));
      if (money.cmp(allocated, record.amount as string) > 0)
        throw new RecordError(422, `Allocations (₹${allocated}) exceed the payment amount.`, { amount: 'Less than the allocations below' });
      record.allocatedAmount = allocated;
      record.unallocatedAmount = money.sub(record.amount as string, allocated);
    },

    actions: {
      /** Replaces allocations with the partner's oldest dues, up to the amount. */
      async allocate({ tx }, record) {
        const dir = direction(record);
        const side = SIDE[dir];
        const items = await openItems(tx, dir, record.partnerId as number);
        if (!items.length) throw new RecordError(422, `Nothing is due from this party on posted ${side.label}s.`);
        const lines = tableFor('account.payment_line');
        await tx.delete(lines).where(eq(lines.paymentId, record.id as number));
        let left = String(record.amount);
        let seq = 0;
        for (const it of items) {
          if (!money.isPositive(left)) break;
          const amount = money.min(left, it.amountDue);
          await tx.insert(lines).values({ paymentId: record.id, sequence: ++seq, [side.lineField]: it.id, amount });
          left = money.sub(left, amount);
        }
        return { allocatedAmount: money.sub(record.amount as string, left), unallocatedAmount: left };
      },

      async post({ tx }, record, lines) {
        const dir = direction(record);
        const side = SIDE[dir];
        for (const l of (lines.lines ?? []) as Values[]) {
          await settle(tx, dir, l[side.lineField] as number, record.partnerId as number, String(l.amount));
        }
        const number = await nextDocumentNumber(tx, side.prefix, String(record.date));
        await postJournal(
          tx,
          { date: String(record.date), reference: number, narration: `Payment ${number}`, refModel: 'account.payment', refId: record.id as number },
          paymentLines(record, await bankLedger(tx, record.bankAccountId as number | null)),
        );
        return { state: 'posted', number };
      },

      async cancel({ tx, userId }, record, lines) {
        await reverseSettlements(tx, 'source', 'account.payment', record.id as number, userId);
        const dir = direction(record);
        const side = SIDE[dir];
        for (const l of (lines.lines ?? []) as Values[]) {
          await settle(tx, dir, l[side.lineField] as number, record.partnerId as number, money.sub(0, l.amount as string));
        }
        await reverseJournal(tx, { date: String(record.date), reference: String(record.number), refModel: 'account.payment', refId: record.id as number });
        return { state: 'cancelled' };
      },
    },
  },
};
