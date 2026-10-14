import { describe, expect, it } from 'vitest';
import { hashPassword, tokenHash, verifyPassword } from './index.ts';

describe('passwords', () => {
  it('verifies the right password and rejects others', async () => {
    const h = await hashPassword('correct horse');
    expect(h.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse', h)).toBe(true);
    expect(await verifyPassword('wrong', h)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
  it('hashes tokens deterministically', () => {
    expect(tokenHash('a')).toBe(tokenHash('a'));
    expect(tokenHash('a')).not.toBe(tokenHash('b'));
  });
});
