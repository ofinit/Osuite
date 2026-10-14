import { money } from '@osuite/kernel';
import clsx from 'clsx';
import { formatDecimal } from '../lib/format.ts';

/** Live debit/credit totals for a manual journal, with the difference to fix. */
export function BalanceSummary({ lines }: { lines: Record<string, unknown>[] }) {
  const debit = money.add(...lines.map((l) => l.debit as string));
  const credit = money.add(...lines.map((l) => l.credit as string));
  const diff = money.sub(debit, credit);
  const balanced = money.cmp(diff, 0) === 0;
  return (
    <dl className="ml-auto w-full max-w-xs text-[14px] sm:w-72">
      <div className="flex justify-between py-1">
        <dt className="text-ink-2">Total debit</dt>
        <dd className="tabular-nums">{formatDecimal(debit)}</dd>
      </div>
      <div className="flex justify-between py-1">
        <dt className="text-ink-2">Total credit</dt>
        <dd className="tabular-nums">{formatDecimal(credit)}</dd>
      </div>
      <div className={clsx('mt-1 flex justify-between border-t border-ink pt-2 font-semibold', balanced ? 'text-ok' : 'text-crimson')}>
        <dt>{balanced ? 'Balanced' : money.isPositive(diff) ? 'Credits short by' : 'Debits short by'}</dt>
        <dd className="tabular-nums">{balanced ? '' : formatDecimal(diff.replace('-', ''))}</dd>
      </div>
    </dl>
  );
}
