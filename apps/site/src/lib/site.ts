// Prices and business details come from the admin panel (GET /v1/site on the
// admin API). They are read once at build time so the pages are complete
// without script, and refreshed in the browser by src/scripts/live-data.ts so
// an edit in the admin panel shows on the next page view without a rebuild.

export const API = (import.meta.env.SITE_API ?? (import.meta.env.DEV ? 'http://127.0.0.1:47900' : 'https://api.osuite.business')).replace(/\/+$/, '');

export interface Plan {
  id: string;
  name: string;
  tagline: string;
  includes: string;
  seats: number;
  priceMonthly: string;
  priceYearly: string;
  cloudAddonMonthly: string;
}

export interface SiteData {
  business: Record<string, string>;
  plans: Plan[];
}

/** Used only when the admin API cannot be reached during a build. */
const FALLBACK: SiteData = {
  business: {
    brandName: 'OSuite',
    legalName: 'OfinIT',
    tagline: 'GST-ready accounting, invoicing and inventory for Indian businesses',
    refundDays: '14',
    gstNote: 'Prices exclude 18% GST',
  },
  plans: [],
};

let cached: Promise<SiteData> | undefined;

export function siteData(): Promise<SiteData> {
  cached ??= (async () => {
    try {
      const res = await fetch(`${API}/v1/site`, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as SiteData;
    } catch (e) {
      console.warn(`[site] ${API}/v1/site unreachable (${(e as Error).message}); using fallback values`);
      return FALLBACK;
    }
  })();
  return cached;
}

/** ₹ with Indian grouping and no paise: 2,11,928. */
export const rupees = (v: string | number) => `₹${Math.round(Number(v)).toLocaleString('en-IN')}`;

/** Paid plans, cheapest first as ordered in the admin panel. */
export const paidPlans = (d: SiteData) => d.plans.filter((p) => Number(p.priceMonthly) > 0);
export const trialPlan = (d: SiteData) => d.plans.find((p) => Number(p.priceMonthly) === 0);
