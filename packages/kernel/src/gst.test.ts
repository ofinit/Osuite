import { describe, expect, it } from 'vitest';
import { amountInWords, computeGst, financialYear, isIntraState, upiPayLink } from './gst.ts';

describe('computeGst', () => {
  const lines = [
    { qty: '10', unitPrice: '4.50', gstRate: '18' }, // 45.00 -> 8.10
    { qty: '3', unitPrice: '2450', discountPct: '10', gstRate: '18' }, // 6615.00 -> 1190.70
    { qty: '1', unitPrice: '1500', gstRate: '18' }, // 1500.00 -> 270.00
    { qty: '2', unitPrice: '99.99', gstRate: '5' }, // 199.98 -> 10.00 (9.999)
  ];

  it('splits CGST/SGST for intra-state supply', () => {
    const r = computeGst(lines, { intraState: true });
    expect(r.taxable).toBe('8359.98');
    expect(r.cgst).toBe(r.sgst);
    expect(r.igst).toBe('0.00');
    expect(r.lines[0]).toEqual({ taxable: '45.00', cgst: '4.05', sgst: '4.05', igst: '0.00', tax: '8.10', total: '53.10' });
    // 4.9995 rounds half-up per component
    expect(r.lines[3]).toMatchObject({ cgst: '5.00', sgst: '5.00', tax: '10.00' });
    expect(r.tax).toBe('1478.80');
    expect(r.total).toBe('9839.00');
    expect(r.roundOff).toBe('0.22');
  });

  it('charges IGST for inter-state supply', () => {
    const r = computeGst(lines, { intraState: false });
    expect(r.cgst).toBe('0.00');
    expect(r.igst).toBe('1478.80');
    expect(r.lines[1]).toMatchObject({ taxable: '6615.00', igst: '1190.70' });
  });

  it('summarises by rate and tolerates blanks', () => {
    const r = computeGst([...lines, { qty: '', unitPrice: null, gstRate: '' }], { intraState: true });
    expect(r.byRate.map((g) => g.rate)).toEqual(['0', '5', '18']);
    expect(r.byRate.find((g) => g.rate === '18')?.taxable).toBe('8160.00');
  });

  it('can skip rupee rounding', () => {
    const r = computeGst(lines, { intraState: true, roundToRupee: false });
    expect(r.roundOff).toBe('0.00');
    expect(r.total).toBe('9838.78');
  });
});

describe('financialYear', () => {
  it('runs April to March', () => {
    expect(financialYear('2026-10-14')).toBe('26-27');
    expect(financialYear('2027-03-31')).toBe('26-27');
    expect(financialYear('2027-04-01')).toBe('27-28');
    expect(financialYear('2099-12-01')).toBe('99-00');
  });
});

describe('amountInWords', () => {
  it('uses lakh and crore', () => {
    expect(amountInWords('9839')).toBe('Rupees Nine Thousand Eight Hundred Thirty Nine Only');
    expect(amountInWords('12340.50')).toBe('Rupees Twelve Thousand Three Hundred Forty and Fifty Paise Only');
    expect(amountInWords('12345678')).toBe('Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only');
    expect(amountInWords('0.05')).toBe('Rupees Zero and Five Paise Only');
    expect(amountInWords('100000')).toBe('Rupees One Lakh Only');
  });
});

describe('isIntraState', () => {
  const sale = { gst: { placeOfSupplyField: 'pos' } };
  const bill = { gst: { placeOfSupplyField: 'pos', supplierStateField: 'vendorState' } };
  it('compares the company state with the place of supply on sales', () => {
    expect(isIntraState(sale, { pos: '27' }, '27')).toBe(true);
    expect(isIntraState(sale, { pos: '29' }, '27')).toBe(false);
  });
  it('compares the vendor state with the place of supply on purchases', () => {
    expect(isIntraState(bill, { vendorState: '29', pos: '27' }, '27')).toBe(false);
    expect(isIntraState(bill, { vendorState: '27', pos: null }, '27')).toBe(true);
  });
  it('assumes intra-state when a state is unknown', () => {
    expect(isIntraState(sale, { pos: '29' }, null)).toBe(true);
  });
});

describe('upiPayLink', () => {
  it('keeps the payee address readable and encodes text', () => {
    expect(upiPayLink({ upiId: 'ofindemo@okhdfc', payee: 'Ofin Demo & Co', amount: '5782', note: 'Invoice INV/26-27/0001' })).toBe(
      'upi://pay?pa=ofindemo@okhdfc&pn=Ofin%20Demo%20%26%20Co&am=5782.00&cu=INR&tn=Invoice%20INV%2F26-27%2F0001',
    );
  });
});
