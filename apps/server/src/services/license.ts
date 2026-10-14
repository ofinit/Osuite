import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import type { LicenseStatus } from '@osuite/kernel';
import { evaluateLicense, LicenseError, verifyLicense, type LicensePayload } from '@osuite/license';
import type { Config } from '../config.ts';
import { LICENSE_PUBLIC_KEY } from './license-pubkey.ts';
import { RecordError } from './records.ts';

const CHECKIN_INTERVAL_MS = 6 * 3_600_000;
export const APP_VERSION = '0.1.0';

function machineId(): string {
  try {
    if (process.platform === 'win32') {
      const out = execFileSync('reg', ['query', 'HKLM\\SOFTWARE\\Microsoft\\Cryptography', '/v', 'MachineGuid'], {
        encoding: 'utf8',
        windowsHide: true,
      });
      const m = /MachineGuid\s+REG_SZ\s+(\S+)/.exec(out);
      if (m) return m[1]!;
    } else if (existsSync('/etc/machine-id')) {
      return readFileSync('/etc/machine-id', 'utf8').trim();
    } else if (process.platform === 'darwin') {
      const out = execFileSync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { encoding: 'utf8' });
      const m = /"IOPlatformUUID" = "([^"]+)"/.exec(out);
      if (m) return m[1]!;
    }
  } catch {
    // fall through
  }
  return hostname();
}

export function createLicenseManager(cfg: Config, log: (msg: string) => void) {
  const tokenPath = join(cfg.dataDir, 'license.token');
  const publicKey = process.env.OSUITE_LICENSE_PUBKEY ?? LICENSE_PUBLIC_KEY;
  const fingerprint = createHash('sha256').update(`osuite:${machineId()}`).digest('hex').slice(0, 32);
  let timer: NodeJS.Timeout | undefined;

  function load(): LicensePayload | null {
    if (!existsSync(tokenPath)) return null;
    try {
      return verifyLicense(readFileSync(tokenPath, 'utf8'), publicKey);
    } catch (err) {
      log(`stored licence rejected: ${(err as Error).message}`);
      return null;
    }
  }

  async function call(path: string, body: object): Promise<{ token?: string; revoked?: boolean; error?: string }> {
    let res: Response;
    try {
      res = await fetch(`${cfg.licenseServer}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new RecordError(503, 'Could not reach the licence server. Check your internet connection.');
    }
    const data = (await res.json().catch(() => ({}))) as { token?: string; revoked?: boolean; error?: string };
    if (!res.ok)
      throw new RecordError([404, 409].includes(res.status) ? res.status : 422, data.error ?? `Licence server error (${res.status})`);
    return data;
  }

  function store(token: string): LicensePayload {
    let payload: LicensePayload;
    try {
      payload = verifyLicense(token, publicKey);
    } catch (err) {
      throw new RecordError(422, err instanceof LicenseError ? err.message : 'Invalid licence');
    }
    if (payload.fp !== fingerprint) throw new RecordError(422, 'Licence was issued for a different machine');
    writeFileSync(tokenPath, token);
    return payload;
  }

  const machine = () => ({ fingerprint, hostname: hostname(), appVersion: APP_VERSION, platform: process.platform });

  const manager = {
    fingerprint,

    status(): LicenseStatus {
      if (!cfg.licenseEnforced) return { state: 'dev', writable: true, message: 'Licence checks disabled (development)' };
      const p = load();
      if (!p) return { state: 'unlicensed', writable: false, message: 'Activate a licence or start a free trial.' };
      const base = {
        plan: p.plan,
        customer: p.customer,
        seats: p.seats,
        modules: p.modules,
        expiresAt: p.exp,
        refreshBy: p.rby,
      };
      if (p.fp !== fingerprint)
        return { ...base, state: 'readonly', writable: false, message: 'This licence belongs to another machine.' };
      const e = evaluateLicense(p);
      const until = e.readonlyAt.toLocaleDateString('en-IN', { dateStyle: 'medium' });
      if (e.standing === 'active') return { ...base, state: 'active', writable: true };
      if (e.standing === 'grace')
        return {
          ...base,
          state: 'grace',
          writable: true,
          message:
            e.reason === 'expired'
              ? `Your subscription has ended. Renew before ${until} to keep editing.`
              : `Connect to the internet before ${until} to verify your licence.`,
        };
      return {
        ...base,
        state: 'readonly',
        writable: false,
        message:
          e.reason === 'expired'
            ? 'Subscription expired: your data is read-only until you renew.'
            : 'Licence could not be verified: connect to the internet to continue editing.',
      };
    },

    /** Seat limit, or undefined when unlimited / unenforced. */
    seats(): number | undefined {
      return cfg.licenseEnforced ? load()?.seats : undefined;
    },

    async activate(key: string): Promise<LicenseStatus> {
      const { token } = await call('/v1/activate', { key: String(key ?? '').trim().toUpperCase(), ...machine() });
      store(token!);
      return manager.status();
    },

    async startTrial(contact: { name: string; email: string; phone?: string; company: string }): Promise<LicenseStatus> {
      const { token } = await call('/v1/trial', { ...contact, ...machine() });
      store(token!);
      return manager.status();
    },

    async checkin(): Promise<LicenseStatus> {
      if (!existsSync(tokenPath)) return manager.status();
      const res = await call('/v1/checkin', { token: readFileSync(tokenPath, 'utf8'), ...machine() });
      if (res.revoked) {
        rmSync(tokenPath, { force: true });
        log('licence revoked by server');
      } else if (res.token) {
        store(res.token);
      }
      return manager.status();
    },

    deactivate() {
      rmSync(tokenPath, { force: true });
    },

    startBackgroundCheckins() {
      const run = () =>
        manager.checkin().catch((err: Error) => log(`licence check-in skipped: ${err.message}`));
      if (!cfg.licenseEnforced) return;
      void run();
      timer = setInterval(run, CHECKIN_INTERVAL_MS);
      timer.unref();
    },

    stop() {
      if (timer) clearInterval(timer);
    },
  };
  return manager;
}

export type LicenseManager = ReturnType<typeof createLicenseManager>;
