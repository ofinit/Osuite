import { describe, expect, it } from 'vitest';
import {
  evaluateLicense,
  generateLicenseKey,
  generateSigningKeys,
  LicenseError,
  signLicense,
  verifyLicense,
  type LicensePayload,
} from './index.ts';

const keys = generateSigningKeys();
const payload: LicensePayload = {
  v: 1,
  lid: 'lic_1',
  customer: 'Acme Traders',
  plan: 'business',
  seats: 5,
  modules: ['base', 'sales'],
  fp: 'abc',
  iat: '2026-01-01T00:00:00Z',
  exp: '2026-12-31T00:00:00Z',
  rby: '2026-02-01T00:00:00Z',
};

describe('licence tokens', () => {
  it('round-trips a signed payload', () => {
    expect(verifyLicense(signLicense(payload, keys.privateKeyPem), keys.publicKeyPem)).toEqual(payload);
  });

  it('rejects a tampered payload', () => {
    const [p, , s] = signLicense(payload, keys.privateKeyPem).split('.');
    const forged = Buffer.from(JSON.stringify({ ...payload, seats: 500 })).toString('base64url');
    expect(() => verifyLicense(`${p}.${forged}.${s}`, keys.publicKeyPem)).toThrow(LicenseError);
  });

  it('rejects a token signed by another key', () => {
    const other = generateSigningKeys();
    expect(() => verifyLicense(signLicense(payload, other.privateKeyPem), keys.publicKeyPem)).toThrow(LicenseError);
  });

  it('generates well-formed keys', () => {
    expect(generateLicenseKey()).toMatch(/^OSX(-[A-Z2-9]{4}){4}$/);
  });
});

describe('evaluateLicense', () => {
  it('is active before the check-in deadline', () => {
    expect(evaluateLicense(payload, new Date('2026-01-15')).standing).toBe('active');
  });
  it('enters grace after a missed check-in', () => {
    const e = evaluateLicense(payload, new Date('2026-02-04'));
    expect(e).toMatchObject({ standing: 'grace', reason: 'checkin-overdue' });
  });
  it('goes read-only once grace ends', () => {
    expect(evaluateLicense(payload, new Date('2026-02-09')).standing).toBe('readonly');
  });
  it('uses subscription expiry when it comes first', () => {
    const p = { ...payload, exp: '2026-01-10T00:00:00Z' };
    expect(evaluateLicense(p, new Date('2026-01-12'))).toMatchObject({ standing: 'grace', reason: 'expired' });
  });
});
