// Refreshes prices and business details from the admin API after load, so an
// edit in the admin panel appears without rebuilding the site.
//   data-biz="supportEmail"            text of a business field
//   data-biz-href="mailto:supportEmail" an href built from a field (mailto:, tel:, wa:)
//   data-biz-if="whatsapp"             hidden when the field is empty
//   data-plan="business" data-plan-field="priceMonthly|priceYearly|seats|name|tagline|includes|cloudAddonMonthly"
// Prices are written as rupees with Indian grouping. Nothing here is needed to read the page.

type Site = { business: Record<string, string>; plans: Record<string, string | number>[] };

const api = document.documentElement.dataset.api;
const rupees = (v: string | number) => `₹${Math.round(Number(v)).toLocaleString('en-IN')}`;
const PRICE = new Set(['priceMonthly', 'priceYearly', 'cloudAddonMonthly']);

function href(spec: string, b: Record<string, string>): string | null {
  const [scheme, field] = spec.split(':') as [string, string];
  const v = b[field];
  if (!v) return null;
  if (scheme === 'mailto') return `mailto:${v}`;
  if (scheme === 'tel') return `tel:${v.replace(/[^\d+]/g, '')}`;
  if (scheme === 'wa') return `https://wa.me/${v.replace(/\D/g, '')}`;
  return v;
}

async function refresh() {
  if (!api) return;
  let site: Site;
  try {
    const res = await fetch(`${api}/v1/site`, { cache: 'no-cache' });
    if (!res.ok) return;
    site = (await res.json()) as Site;
  } catch {
    return; // keep the values the page was built with
  }
  const b = site.business;
  document.querySelectorAll<HTMLElement>('[data-biz]').forEach((el) => {
    const v = b[el.dataset.biz!];
    // An empty field in the admin panel keeps what the page was built with.
    if (v) el.textContent = v;
  });
  // An email set large is split before the @ into two lines.
  document.querySelectorAll<HTMLElement>('[data-email-user]').forEach((el) => {
    const v = b[el.dataset.emailUser!];
    if (v?.includes('@')) el.textContent = v.split('@')[0]!;
  });
  document.querySelectorAll<HTMLElement>('[data-email-domain]').forEach((el) => {
    const v = b[el.dataset.emailDomain!];
    if (v?.includes('@')) el.textContent = `@${v.split('@')[1]}`;
  });
  document.querySelectorAll<HTMLAnchorElement>('[data-biz-href]').forEach((el) => {
    const h = href(el.dataset.bizHref!, b);
    if (h) el.href = h;
  });
  document.querySelectorAll<HTMLElement>('[data-biz-if]').forEach((el) => {
    el.hidden = !b[el.dataset.bizIf!];
  });
  const plans = new Map(site.plans.map((p) => [String(p.id), p]));
  document.querySelectorAll<HTMLElement>('[data-plan]').forEach((el) => {
    const p = plans.get(el.dataset.plan!);
    const f = el.dataset.planField;
    if (!p) {
      // A plan no longer offered: hide its block, if it is one.
      if (!f) el.hidden = true;
      return;
    }
    if (!f) return;
    const v = p[f];
    if (v === undefined || v === '') return;
    el.textContent = PRICE.has(f) ? rupees(v) : String(v);
  });
  // A plan taken off sale: hide its whole column in tables.
  document.querySelectorAll<HTMLElement>('[data-plan-col]').forEach((el) => {
    el.hidden = !plans.has(el.dataset.planCol!);
  });
  document.dispatchEvent(new CustomEvent('site:data', { detail: site }));
}

void refresh();
