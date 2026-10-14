import { IN_STATES, MAX_LOGO_BYTES, type Company } from '@osuite/kernel';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ImagePlus, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.ts';
import { useSession } from '../lib/session.ts';

type Form = Record<Exclude<keyof Company, 'allowNegativeStock'>, string>;
const KEYS = [
  'name', 'gstin', 'stateCode', 'pan', 'street', 'street2', 'city', 'pincode', 'phone', 'email', 'website',
  'bankAccountName', 'bankAccountNumber', 'bankIfsc', 'bankName', 'bankBranch', 'upiId', 'invoiceTerms', 'logo',
] as const satisfies readonly (keyof Form)[];

const toForm = (c: Company | null): Form =>
  Object.fromEntries(KEYS.map((k) => [k, (c?.[k] as string | undefined) ?? ''])) as Form;
const STATES = [...IN_STATES].sort((a, b) => a[1].localeCompare(b[1]));

/** Company details printed on invoices: address, bank, UPI, terms, logo. */
export function CompanyView() {
  const { license, user } = useSession();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['company'], queryFn: api.company });
  const [form, setForm] = useState<Form>(() => toForm(null));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [logoError, setLogoError] = useState<string | null>(null);
  const [allowNegative, setAllowNegative] = useState(false);
  useEffect(() => {
    if (data === undefined) return;
    setForm(toForm(data));
    setAllowNegative(!!data?.allowNegativeStock);
  }, [data]);

  const save = useMutation({
    mutationFn: () =>
      api.updateCompany({
        ...(Object.fromEntries(Object.entries(form).filter(([, v]) => v !== '')) as Partial<Company>),
        allowNegativeStock: allowNegative,
      }),
    onSuccess: (c) => {
      setErrors({});
      qc.setQueryData(['company'], c);
      void qc.invalidateQueries({ queryKey: ['bootstrap'] });
    },
    onError: (err) => setErrors(err instanceof ApiError ? err.fieldErrors : {}),
  });

  const editable = user.isAdmin && license.writable;
  const dirty = data !== undefined && (JSON.stringify(form) !== JSON.stringify(toForm(data)) || allowNegative !== !!data?.allowNegativeStock);
  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    let v = e.target.value;
    const next = { ...form, [k]: v };
    if (k === 'gstin') {
      v = v.toUpperCase();
      next.gstin = v;
      // The GSTIN carries the state code and PAN.
      if (/^\d{2}/.test(v) && STATES.some(([c]) => c === v.slice(0, 2))) next.stateCode = v.slice(0, 2);
      if (v.length >= 12 && !form.pan) next.pan = v.slice(2, 12);
    }
    setForm(next);
    if (errors[k]) setErrors(({ [k]: _, ...rest }) => rest);
  };

  const onLogo = (file: File | undefined) => {
    setLogoError(null);
    if (!file) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) return setLogoError('Use a PNG, JPEG or WebP image.');
    if (file.size > MAX_LOGO_BYTES) return setLogoError('The logo must be 300 KB or smaller.');
    const reader = new FileReader();
    reader.onload = () => setForm((f) => ({ ...f, logo: String(reader.result) }));
    reader.readAsDataURL(file);
  };

  const field = (k: keyof Form, label: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block min-w-0">
      <span className="mb-1 block text-[12.5px] font-medium text-ink-2">{label}</span>
      <input className="field-input" value={form[k]} onChange={set(k)} aria-invalid={errors[k] ? true : undefined} {...props} />
      {errors[k] && <span className="mt-1 block text-[12.5px] text-crimson">{errors[k]}</span>}
    </label>
  );

  return (
    <div className="h-full overflow-y-auto px-5 py-6 sm:px-10">
      <form
        className="max-w-3xl"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <h1 className="text-[22px] font-semibold tracking-tight">Company</h1>
        <p className="mt-1 text-ink-2">These details appear on your invoices.</p>

        <fieldset disabled={!editable} className="mt-6 space-y-8">
          <section className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">{field('name', 'Legal name', { required: true })}</div>
            {field('gstin', 'GSTIN', { maxLength: 15 })}
            <label className="block min-w-0">
              <span className="mb-1 block text-[12.5px] font-medium text-ink-2">State</span>
              <select className="field-input" value={form.stateCode} onChange={set('stateCode')} aria-invalid={errors.stateCode ? true : undefined}>
                <option value="">Select</option>
                {STATES.map(([c, n]) => (
                  <option key={c} value={c}>
                    {n}
                  </option>
                ))}
              </select>
              {errors.stateCode && <span className="mt-1 block text-[12.5px] text-crimson">{errors.stateCode}</span>}
            </label>
            {field('pan', 'PAN', { maxLength: 10 })}
          </section>

          <section>
            <h2 className="mb-3 text-[15px] font-semibold">Logo</h2>
            <div className="flex items-center gap-4">
              <div className="grid h-20 w-40 place-items-center rounded-[5px] border border-dashed border-rule-strong bg-sheet">
                {form.logo ? <img src={form.logo} alt="Company logo" className="max-h-16 max-w-36 object-contain" /> : <span className="text-[12.5px] text-ink-3">No logo</span>}
              </div>
              {editable && (
                <div className="flex flex-col items-start gap-1">
                  <label className="btn-outline cursor-pointer">
                    <ImagePlus size={15} /> {form.logo ? 'Replace' : 'Upload'}
                    <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={(e) => onLogo(e.target.files?.[0])} />
                  </label>
                  {form.logo && (
                    <button type="button" className="btn-quiet h-8 text-[13px]" onClick={() => setForm((f) => ({ ...f, logo: '' }))}>
                      <Trash2 size={14} /> Remove
                    </button>
                  )}
                  <span className="text-[12px] text-ink-3">PNG, JPEG or WebP, up to 300 KB</span>
                </div>
              )}
            </div>
            {(logoError ?? errors.logo) && <p className="mt-2 text-[12.5px] text-crimson">{logoError ?? errors.logo}</p>}
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <h2 className="text-[15px] font-semibold sm:col-span-2">Address</h2>
            {field('street', 'Street')}
            {field('street2', 'Street 2')}
            {field('city', 'City')}
            {field('pincode', 'PIN code', { inputMode: 'numeric', maxLength: 6 })}
          </section>

          <section className="grid gap-4 sm:grid-cols-3">
            <h2 className="text-[15px] font-semibold sm:col-span-3">Contact</h2>
            {field('phone', 'Phone', { type: 'tel' })}
            {field('email', 'Email', { type: 'email' })}
            {field('website', 'Website')}
          </section>

          <section className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <h2 className="text-[15px] font-semibold">Payments</h2>
              <p className="text-[13px] text-ink-3">Printed on invoices. With a UPI ID, posted invoices carry a QR code for the exact amount.</p>
            </div>
            {field('bankAccountName', 'Account name')}
            {field('bankAccountNumber', 'Account number', { inputMode: 'numeric' })}
            {field('bankIfsc', 'IFSC', { maxLength: 11 })}
            {field('bankName', 'Bank')}
            {field('bankBranch', 'Branch')}
            {field('upiId', 'UPI ID', { placeholder: 'business@okhdfc' })}
          </section>

          <section>
            <h2 className="mb-2 text-[15px] font-semibold">Inventory</h2>
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-[var(--accent)]"
                checked={allowNegative}
                onChange={(e) => setAllowNegative(e.target.checked)}
              />
              <span>
                Allow sales when stock is short
                <span className="block text-[13px] text-ink-3">
                  When off, an invoice that would take a product below zero can’t be posted until the stock is entered.
                </span>
              </span>
            </label>
          </section>

          <section>
            <label className="block">
              <span className="mb-1 block text-[15px] font-semibold">Invoice terms</span>
              <span className="mb-2 block text-[13px] text-ink-3">Printed at the bottom of every invoice.</span>
              <textarea className="field-input h-auto min-h-24 py-2" rows={4} value={form.invoiceTerms} onChange={set('invoiceTerms')} />
            </label>
          </section>
        </fieldset>

        {editable && (
          <div className="sticky bottom-0 mt-8 flex items-center gap-3 border-t border-rule bg-paper py-3">
            <button className="btn-primary" disabled={!dirty || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save details'}
            </button>
            {save.isError && <span className="text-[13px] text-crimson">{save.error.message}</span>}
            {save.isSuccess && !dirty && <span className="text-[13px] text-ok">Saved</span>}
          </div>
        )}
      </form>
    </div>
  );
}
