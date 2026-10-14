// Server-side helpers shared by the product server and the admin API.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, N, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(actual, expected);
}

/** Burns comparable time when a login does not exist, hiding which logins are valid. */
export async function fakePasswordCheck(): Promise<false> {
  await scrypt('x', randomBytes(16), 64, SCRYPT);
  return false;
}

/** Opaque session token for the client; only its hash is stored. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Postgres error fields, unwrapping Drizzle's DrizzleQueryError. */
export function pgError(err: unknown): { code?: string; constraint?: string } {
  const outer = err as { code?: string; cause?: unknown };
  return (outer?.code ? outer : (outer?.cause ?? {})) as { code?: string; constraint?: string };
}
