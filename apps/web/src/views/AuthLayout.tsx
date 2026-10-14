import { BrandMark } from '@osuite/ui';

/** Centered sheet used by setup, sign-in and activation. */
export function AuthLayout({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-full overflow-y-auto px-4 py-10 sm:py-16">
      <div className="mx-auto w-full max-w-[460px]">
        <BrandMark withName className="mb-6" />
        <div className="relative rounded-lg border border-rule bg-sheet py-7 pr-7 pl-12 shadow-sm">
          <div aria-hidden className="absolute inset-y-0 left-7 w-px bg-crimson/45" />
          <h1 className="text-[20px] font-semibold tracking-tight">{title}</h1>
          {intro && <p className="mt-1 text-ink-2">{intro}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function TextField({
  label,
  error,
  ...input
}: { label: string; error?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = `a-${input.name}`;
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[12.5px] font-medium text-ink-2">
        {label}
      </label>
      <input id={id} className="field-input" aria-invalid={error ? true : undefined} {...input} />
      {error && <p className="mt-1 text-[12.5px] text-crimson">{error}</p>}
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-[5px] bg-crimson-soft px-3 py-2 text-[13px] text-crimson">
      {message}
    </p>
  );
}
