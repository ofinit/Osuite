// Offline-verifiable licence tokens.
//   token = "OSL1." + base64url(JSON payload) + "." + base64url(Ed25519 signature)
// The admin panel holds the private key; every install embeds the public key.
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';

const PREFIX = 'OSL1';

export interface LicensePayload {
  v: 1;
  /** Licence id in the admin panel. */
  lid: string;
  customer: string;
  plan: string;
  seats: number;
  modules: string[];
  /** Machine fingerprint the token is bound to. */
  fp: string;
  /** Issued-at, ISO timestamp. */
  iat: string;
  /** End of the paid subscription period. */
  exp: string;
  /** The install must check in before this time; extended on every check-in. */
  rby: string;
}

export class LicenseError extends Error {}

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');

export function signLicense(payload: LicensePayload, privateKeyPem: string): string {
  const body = b64url(JSON.stringify(payload));
  const sig = sign(null, Buffer.from(`${PREFIX}.${body}`), createPrivateKey(privateKeyPem));
  return `${PREFIX}.${body}.${b64url(sig)}`;
}

export function verifyLicense(token: string, publicKeyPem: string): LicensePayload {
  const parts = token.trim().split('.');
  if (parts.length !== 3 || parts[0] !== PREFIX) throw new LicenseError('Malformed licence token');
  const [, body, sig] = parts as [string, string, string];
  const ok = verify(null, Buffer.from(`${PREFIX}.${body}`), createPublicKey(publicKeyPem), Buffer.from(sig, 'base64url'));
  if (!ok) throw new LicenseError('Licence signature is invalid');
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as LicensePayload;
  if (payload.v !== 1) throw new LicenseError(`Unsupported licence version ${String(payload.v)}`);
  return payload;
}

export type Standing = 'active' | 'grace' | 'readonly';

export interface Evaluation {
  standing: Standing;
  /** Deadline after which the install drops to read-only. */
  readonlyAt: Date;
  reason?: 'expired' | 'checkin-overdue';
}

/**
 * Lapsed subscriptions and missed check-ins get a grace period, then the
 * install becomes read-only. It never locks users out of their own data.
 */
export function evaluateLicense(p: LicensePayload, now = new Date(), graceDays = 7): Evaluation {
  const exp = new Date(p.exp);
  const rby = new Date(p.rby);
  const deadline = exp < rby ? exp : rby;
  const reason = exp < rby ? 'expired' : 'checkin-overdue';
  const readonlyAt = new Date(deadline.getTime() + graceDays * 86_400_000);
  if (now <= deadline) return { standing: 'active', readonlyAt };
  if (now <= readonlyAt) return { standing: 'grace', readonlyAt, reason };
  return { standing: 'readonly', readonlyAt, reason };
}

export function generateSigningKeys(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

/** Human-entered licence keys, e.g. "OSX-7KQ2-M9PD-4TWZ-H3RA". */
export function generateLicenseKey(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
  return `OSX-${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8, 12)}-${chars.slice(12, 16)}`;
}
