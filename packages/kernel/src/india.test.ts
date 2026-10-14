import { describe, expect, it } from 'vitest';
import { isValidGstin } from './india.ts';

describe('isValidGstin', () => {
  it('accepts a GSTIN with a correct check digit (any case)', () => {
    expect(isValidGstin('27AAPFU0939F1ZV')).toBe(true);
    expect(isValidGstin('27aapfu0939f1zv')).toBe(true);
  });
  it('rejects a wrong check digit', () => {
    expect(isValidGstin('27AAPFU0939F1ZX')).toBe(false);
    expect(isValidGstin('29AAPFU0939F1ZV')).toBe(false);
  });
  it('rejects malformed input', () => {
    for (const g of ['', '27AAPFU0939F1Z', '27AAPFU0939F1ZVV', 'AAAPFU0939F1ZV2']) expect(isValidGstin(g)).toBe(false);
  });
});
