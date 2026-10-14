import { describe, expect, it } from 'vitest';
import { detectStatement, parseBankAmount, parseBankDate, parseCsv, readStatement } from './bank.ts';

// Shaped like an HDFC net-banking export: account details above the header,
// separate withdrawal/deposit columns, a footer line.
const HDFC = `Account Number : 50200012345678
Statement From : 01/10/26 To : 31/10/26

Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
02/10/26,"UPI-ACME INDUSTRIES-acme@okicici-UTR4471002",UTR4471002,02/10/26,,"1,180.00","51,180.00"
05/10/26,NEFT DR-KARNATAKA COPPER-N278100,N278100,05/10/26,410.00,,"50,770.00"
06/10/26,CHGS INCL GST,,06/10/26,59.00,,"50,711.00"
Statement Summary,,,,,,
`;

// SBI-style: single amount with a Dr/Cr column and month-name dates.
const SBI = `Txn Date,Description,Ref No./Cheque No.,Amount,Dr / Cr,Balance
02-Oct-2026,BY TRANSFER-UPI,UTR998,"2,500.00",CR,"12,500.00"
03 Oct 2026,TO CLG CHQ 000123,000123,800,DR,"11,700.00"
`;

describe('bank statement parsing', () => {
  it('reads quoted CSV with commas and CRLF', () => {
    expect(parseCsv('a,"b, c","say ""hi"""\r\n1,2,3\r\n')).toEqual([
      ['a', 'b, c', 'say "hi"'],
      ['1', '2', '3'],
    ]);
  });

  it('finds the header below account details and maps HDFC columns', () => {
    const rows = parseCsv(HDFC);
    const d = detectStatement(rows)!;
    expect(d.headerRow).toBe(2);
    expect(d.mapping).toMatchObject({ date: 0, description: 1, reference: 2, debit: 4, credit: 5, balance: 6 });
    const { rows: out, skipped } = readStatement(rows, d.headerRow, d.mapping);
    expect(out).toEqual([
      { date: '2026-10-02', description: 'UPI-ACME INDUSTRIES-acme@okicici-UTR4471002', reference: 'UTR4471002', amount: '1180.00', balance: '51180.00' },
      { date: '2026-10-05', description: 'NEFT DR-KARNATAKA COPPER-N278100', reference: 'N278100', amount: '-410.00', balance: '50770.00' },
      { date: '2026-10-06', description: 'CHGS INCL GST', reference: null, amount: '-59.00', balance: '50711.00' },
    ]);
    expect(skipped).toEqual([{ line: 7, reason: 'Unreadable date "Statement Summary"' }]);
  });

  it('handles one amount column with Dr/Cr', () => {
    const rows = parseCsv(SBI);
    const d = detectStatement(rows)!;
    expect(d.mapping).toMatchObject({ date: 0, description: 1, amount: 3, drcr: 4, balance: 5 });
    const out = readStatement(rows, d.headerRow, d.mapping).rows;
    expect(out.map((r) => [r.date, r.amount])).toEqual([
      ['2026-10-02', '2500.00'],
      ['2026-10-03', '-800.00'],
    ]);
  });

  it('parses Indian dates and amounts', () => {
    expect(parseBankDate('5/10/26')).toBe('2026-10-05');
    expect(parseBankDate('05-Oct-2026')).toBe('2026-10-05');
    expect(parseBankDate('31/02/2026')).toBeNull();
    expect(parseBankAmount('1,23,456.78')).toBe('123456.78');
    expect(parseBankAmount('500.00 Dr')).toBe('-500.00');
    expect(parseBankAmount('(250)')).toBe('-250.00');
    expect(parseBankAmount('₹ 99.5 Cr')).toBe('99.50');
    expect(parseBankAmount('')).toBeNull();
  });
});
