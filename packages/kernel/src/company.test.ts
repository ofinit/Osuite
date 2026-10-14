import { describe, expect, it } from 'vitest';
import { companySchema, flattenErrors } from './index.ts';

describe('companySchema', () => {
  it('normalises and accepts a full profile', () => {
    const c = companySchema.parse({
      name: ' Ofin Demo Traders ',
      gstin: '27aapfu0939f1zv',
      stateCode: '27',
      pan: 'aapfu0939f',
      pincode: '411019',
      bankIfsc: 'hdfc0001234',
      upiId: 'ofindemo@okhdfc',
      street: '',
    });
    expect(c).toMatchObject({ name: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', pan: 'AAPFU0939F', bankIfsc: 'HDFC0001234' });
    expect(c.street).toBeUndefined();
  });

  it('reports field errors', () => {
    const r = companySchema.safeParse({ name: '', gstin: '27AAPFU0939F1ZV', stateCode: '29', pincode: '12', bankIfsc: 'XX', upiId: 'nope', logo: 'data:image/svg+xml;base64,AAAA' });
    expect(Object.keys(flattenErrors(r.error!)).sort()).toEqual(['bankIfsc', 'logo', 'name', 'pincode', 'stateCode', 'upiId']);
  });

  it('cross-checks GSTIN against state and PAN', () => {
    const r = companySchema.safeParse({ name: 'X', gstin: '27AAPFU0939F1ZV', stateCode: '29', pan: 'ABCDE1234F' });
    expect(Object.keys(flattenErrors(r.error!)).sort()).toEqual(['pan', 'stateCode']);
  });
});
