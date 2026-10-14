import clsx from 'clsx';

/** Ledger-book mark: an "O" ruled with the crimson margin line. */
export function BrandMark({ className, withName = false }: { className?: string; withName?: boolean }) {
  return (
    <span className={clsx('inline-flex items-center gap-2', className)}>
      <svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true">
        <rect x="1" y="1" width="24" height="24" rx="5" fill="var(--sheet)" stroke="var(--rule-strong)" />
        <line x1="8" y1="2" x2="8" y2="24" stroke="var(--crimson)" strokeWidth="1.5" />
        <circle cx="15.5" cy="13" r="5" fill="none" stroke="var(--ink)" strokeWidth="2.2" />
      </svg>
      {withName && <span className="text-[15px] font-semibold tracking-tight">OSuite</span>}
    </span>
  );
}
