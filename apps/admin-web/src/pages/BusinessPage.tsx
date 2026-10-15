import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, ApiError, type StaffUser } from '../api.ts';
import { ErrorText, Field, PageHeader } from '../components/ui.tsx';

/** Groups of the profile form; every field comes from the server's definition. */
const GROUPS: { title: string; note?: string; keys: string[] }[] = [
  { title: 'Identity', keys: ['brandName', 'legalName', 'tagline', 'gstin', 'pan', 'cin'] },
  { title: 'Address', keys: ['street', 'street2', 'city', 'state', 'pincode'] },
  { title: 'Contact', keys: ['salesEmail', 'supportEmail', 'phone', 'whatsapp', 'supportHours'] },
  {
    title: 'Legal pages',
    note: 'The privacy policy names a grievance officer (IT Rules, 2021). The refund window appears in the refund policy.',
    keys: ['grievanceOfficer', 'grievanceEmail', 'refundDays', 'gstNote'],
  },
  {
    title: 'Desktop download',
    note: 'The download button on the website points here. Publish a new installer, then update the link and version.',
    keys: ['downloadUrl', 'downloadVersion', 'downloadSize'],
  },
  { title: 'Social', keys: ['linkedin', 'youtube', 'x', 'instagram', 'facebook'] },
];

/** The business profile shown on the website, the legal pages and in the apps. */
export function BusinessPage({ me }: { me: StaffUser }) {
  const qc = useQueryClient();
  const owner = me.role === 'owner';
  const { data } = useQuery({ queryKey: ['business'], queryFn: api.business });
  const [v, setV] = useState<Record<string, string> | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  useEffect(() => {
    if (data && !v) setV(data.values);
  }, [data, v]);
  const save = useMutation({
    mutationFn: () => api.saveBusiness(v!),
    onSuccess: (saved) => {
      setErrors({});
      setV(saved);
      void qc.invalidateQueries({ queryKey: ['business'] });
    },
    onError: (e) => setErrors(e instanceof ApiError ? e.fieldErrors : {}),
  });
  if (!data || !v) return null;
  const dirty = JSON.stringify(v) !== JSON.stringify(data.values);

  return (
    <>
      <PageHeader
        title="Business details"
        sub={
          owner
            ? 'Shown on osuite.business (contact, footer and legal pages) and in the apps. Changes appear within a minute, without a rebuild.'
            : 'Only the owner can change these.'
        }
      />
      <form
        className="max-w-4xl space-y-8"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
      >
        <fieldset disabled={!owner} className="space-y-8">
          {GROUPS.map((g) => (
            <section key={g.title}>
              <h2 className="mb-1 font-semibold">{g.title}</h2>
              {g.note && <p className="mb-3 text-[13px] text-ink-3">{g.note}</p>}
              <div className="grid gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
                {g.keys.map((k) => {
                  const f = data.fields[k];
                  if (!f) return null;
                  return (
                    <div key={k}>
                      <Field
                        label={f.required ? `${f.label} *` : f.label}
                        name={k}
                        maxLength={f.max}
                        value={v[k] ?? ''}
                        aria-invalid={errors[k] ? true : undefined}
                        onChange={(e) => setV({ ...v, [k]: e.target.value })}
                      />
                      {errors[k] && <p className="mt-1 text-[12.5px] text-crimson">{errors[k]}</p>}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </fieldset>
        {owner && (
          <div className="flex items-center gap-3">
            <button className="btn-primary" disabled={!dirty || save.isPending}>
              {save.isPending ? 'Saving…' : 'Save details'}
            </button>
            {save.isSuccess && !dirty && <span className="text-[13px] text-ok">Saved. The website picks this up within a minute.</span>}
            <ErrorText error={save.error} />
          </div>
        )}
      </form>
    </>
  );
}
