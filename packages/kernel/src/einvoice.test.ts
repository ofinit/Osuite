import { describe, expect, it } from 'vitest';
import { buildEInvoice, buildEWayBill, eWayBillValidUntil, irpDate, validateEInvoice, validateEWayBill, type EInvoiceInput } from './einvoice.ts';

const seller = { gstin: '27AAPFU0939F1ZV', legalName: 'Ofin Demo Traders', street: '14 MG Road', city: 'Pune', pincode: '411030', stateCode: '27', phone: '020 2445 6677' };
const buyer = { gstin: '29AABCT1332L1ZA', legalName: 'Karnataka Components', street: '5 Residency Rd', city: 'Bengaluru', pincode: '560025', stateCode: '29' };

const base: EInvoiceInput = {
  docType: 'INV',
  number: 'INV/26-27/0007',
  date: '2026-10-15',
  seller,
  buyer,
  placeOfSupply: '29',
  lines: [
    { description: 'Steel bolt M8', hsnCode: '7318', qty: '100', uom: 'NOS', unitPrice: '9', discountPct: '0', gstRate: '18' },
    { description: 'Installation', hsnCode: '998719', qty: '2', uom: 'HRS', unitPrice: '1500', discountPct: '10', gstRate: '18' },
  ],
  totals: { taxable: '3600.00', cgst: '0.00', sgst: '0.00', igst: '648.00', roundOff: '0.00', total: '4248.00' },
};

describe('e-invoice payload', () => {
  it('maps a document to INV-01', () => {
    const p = buildEInvoice(base);
    expect(p.Version).toBe('1.1');
    expect(p.DocDtls).toEqual({ Typ: 'INV', No: 'INV/26-27/0007', Dt: '15/10/2026' });
    expect(p.SellerDtls).toMatchObject({ Gstin: '27AAPFU0939F1ZV', Pin: 411030, Stcd: '27', Ph: '02024456677' });
    expect(p.BuyerDtls).toMatchObject({ Pos: '29', Stcd: '29', Loc: 'Bengaluru' });
    const [goods, service] = p.ItemList;
    expect(goods).toMatchObject({ IsServc: 'N', Unit: 'NOS', TotAmt: 900, Discount: 0, AssAmt: 900, IgstAmt: 162, CgstAmt: 0, TotItemVal: 1062 });
    expect(service).toMatchObject({ IsServc: 'Y', Unit: 'OTH', TotAmt: 3000, Discount: 300, AssAmt: 2700, IgstAmt: 486 });
    expect(p.ValDtls).toEqual({ AssVal: 3600, CgstVal: 0, SgstVal: 0, IgstVal: 648, RndOffAmt: 0, TotInvVal: 4248 });
    expect(validateEInvoice(p, '2026-10-15')).toEqual([]);
  });

  it('splits CGST and SGST within the state', () => {
    const p = buildEInvoice({
      ...base,
      buyer: { ...buyer, gstin: '27AABCU9603R1ZN', stateCode: '27', pincode: '411001', city: 'Pune' },
      placeOfSupply: '27',
      lines: [base.lines[0]!],
      totals: { taxable: '900.00', cgst: '81.00', sgst: '81.00', igst: '0.00', roundOff: '0.00', total: '1062.00' },
    });
    expect(p.ItemList[0]).toMatchObject({ CgstAmt: 81, SgstAmt: 81, IgstAmt: 0 });
    expect(validateEInvoice(p, '2026-10-15')).toEqual([]);
  });

  it('names the original invoice on a credit note', () => {
    const p = buildEInvoice({ ...base, docType: 'CRN', number: 'CN/26-27/0001', original: { number: 'INV/26-27/0007', date: '2026-10-15' } });
    expect(p.RefDtls).toEqual({ PrecDocDtls: [{ InvNo: 'INV/26-27/0007', InvDt: '15/10/2026' }] });
    const { RefDtls: _omit, ...withoutRef } = p;
    expect(validateEInvoice(withoutRef as typeof p, '2026-10-15')).toContain('A credit or debit note must name the original invoice.');
  });

  it('reports what the IRP would reject, in words', () => {
    const p = buildEInvoice({
      ...base,
      number: '0INV-TOO-LONG-NUMBER',
      date: '2026-10-20',
      buyer: { ...buyer, street: '', pincode: '5600', city: 'B' },
      lines: [{ ...base.lines[0]!, hsnCode: '73' }],
    });
    const problems = validateEInvoice(p, '2026-10-15');
    expect(problems.some((x) => x.startsWith('Document number'))).toBe(true);
    expect(problems).toContain('The document date is in the future.');
    expect(problems).toContain('The customer: the street address is required (up to 100 characters).');
    expect(problems).toContain('The customer: a 6-digit PIN code is required.');
    expect(problems).toContain('The customer: the city is required (3 to 50 characters).');
    expect(problems.some((x) => x.includes('HSN/SAC must be 4, 6 or 8 digits'))).toBe(true);
    expect(problems.some((x) => x.startsWith('The taxable value of the items'))).toBe(true);
  });
});

describe('e-way bill', () => {
  it('builds the by-IRN payload', () => {
    expect(buildEWayBill({ irn: 'abc', distanceKm: 842.4, transMode: '1', vehicleNo: 'mh 12-ab 1234' })).toEqual({
      Irn: 'abc',
      Distance: 842,
      TransMode: '1',
      VehNo: 'MH12AB1234',
      VehType: 'R',
    });
    expect(irpDate('2026-01-05')).toBe('05/01/2026');
  });

  it('checks transport details', () => {
    expect(validateEWayBill({ irn: 'x', distanceKm: 100, transMode: '1', vehicleNo: 'MH12AB1234' })).toEqual([]);
    expect(validateEWayBill({ irn: 'x', distanceKm: 100, transporterGstin: '29AABCT1332L1ZA' })).toEqual([]);
    expect(validateEWayBill({ irn: 'x', distanceKm: 100 })).toHaveLength(1);
    expect(validateEWayBill({ irn: 'x', distanceKm: 100, vehicleNo: 'NOT A PLATE' })[0]).toMatch(/Vehicle number/);
  });

  it('is valid one day per 200 km, ending at midnight', () => {
    expect(eWayBillValidUntil('2026-10-15T10:30:00Z', 150)).toBe('2026-10-16');
    expect(eWayBillValidUntil('2026-10-15', 200)).toBe('2026-10-16');
    expect(eWayBillValidUntil('2026-10-15', 201)).toBe('2026-10-17');
    expect(eWayBillValidUntil('2026-10-15', 0)).toBe('2026-10-16');
  });
});
