// What the seller (OfinIT) publishes about itself and its plans, fetched from
// the licence server's GET /v1/site so prices and contact details edited in
// the admin panel reach every installation. The last good copy is kept on
// disk so the app still shows them offline.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Config } from '../config.ts';

export interface VendorSite {
  business: Record<string, string>;
  plans: {
    id: string;
    name: string;
    tagline: string;
    includes: string;
    seats: number;
    priceMonthly: string;
    priceYearly: string;
    cloudAddonMonthly: string;
  }[];
  /** When this copy was fetched; null if it never was. */
  fetchedAt: string | null;
}

const FRESH_MS = 10 * 60 * 1000;

export function createVendorInfo(cfg: Config) {
  const file = join(cfg.dataDir, 'vendor.json');
  let cached: VendorSite | null = null;
  /** When this process last fetched successfully; the disk copy is only an offline fallback. */
  let fetchedAt = 0;
  let inflight: Promise<VendorSite | null> | null = null;

  const fromDisk = (): VendorSite | null => {
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as VendorSite;
    } catch {
      return null;
    }
  };

  async function fetchFresh(): Promise<VendorSite | null> {
    try {
      const res = await fetch(`${cfg.licenseServer}/v1/site`, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const body = (await res.json()) as Omit<VendorSite, 'fetchedAt'>;
      const site = { ...body, fetchedAt: new Date().toISOString() };
      writeFileSync(file, JSON.stringify(site));
      return site;
    } catch {
      return null;
    }
  }

  return {
    /** Fresh when possible, the last good copy otherwise, or null if never fetched. */
    async get(): Promise<VendorSite | null> {
      cached ??= fromDisk();
      if (cached && Date.now() - fetchedAt < FRESH_MS) return cached;
      inflight ??= fetchFresh().finally(() => {
        inflight = null;
      });
      const fresh = await inflight;
      if (fresh) {
        cached = fresh;
        fetchedAt = Date.now();
      }
      return cached;
    },
  };
}
