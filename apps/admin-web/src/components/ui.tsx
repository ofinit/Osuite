import clsx from 'clsx';
import type { Standing } from '../api.ts';

const STANDING: Record<Standing, { label: string; className: string }> = {
  active: { label: 'Active', className: 'bg-[color-mix(in_srgb,var(--ok)_14%,transparent)] text-ok' },
  trial: { label: 'Trial', className: 'bg-accent-soft text-accent' },
  expired: { label: 'Expired', className: 'bg-amber-soft text-amber' },
  suspended: { label: 'Suspended', className: 'bg-amber-soft text-amber' },
  revoked: { label: 'Revoked', className: 'bg-crimson-soft text-crimson' },
};

export function StandingBadge({ standing }: { standing: Standing }) {
  const s = STANDING[standing];
  return <span className={clsx('inline-block rounded px-1.5 py-px text-[12px] font-medium', s.className)}>{s.label}</span>;
}

export function PageHeader({ title, sub, children }: { title: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <header className="flex flex-wrap items-end gap-3 pb-5">
      <div className="mr-auto min-w-0">
        <h1 className="truncate text-[22px] font-semibold tracking-tight">{title}</h1>
        {sub && <div className="mt-0.5 text-ink-2">{sub}</div>}
      </div>
      {children}
    </header>
  );
}

export function Field({
  label,
  hint,
  ...input
}: { label: string; hint?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[12.5px] font-medium text-ink-2">{label}</span>
      <input className="field-input" {...input} />
      {hint && <span className="mt-1 block text-[12px] text-ink-3">{hint}</span>}
    </label>
  );
}

export function Select({
  label,
  children,
  ...select
}: { label: string } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[12.5px] font-medium text-ink-2">{label}</span>
      <select className="field-input" {...select}>
        {children}
      </select>
    </label>
  );
}

export function ErrorText({ error }: { error?: Error | string | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="rounded-[5px] bg-crimson-soft px-3 py-2 text-[13px] text-crimson">
      {typeof error === 'string' ? error : error.message}
    </p>
  );
}

/** Plain ruled table matching the product's ledger lists. */
export function Table({ head, children }: { head: React.ReactNode[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-left">
        <thead>
          <tr>
            {head.map((h, i) => (
              <th key={i} scope="col" className="border-b border-rule-strong py-2 pr-4 text-[12.5px] font-medium whitespace-nowrap text-ink-2">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&_td]:border-b [&_td]:border-rule [&_td]:py-2.5 [&_td]:pr-4">{children}</tbody>
      </table>
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-10 text-center text-ink-3">{children}</p>;
}
