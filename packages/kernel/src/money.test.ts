import { describe, expect, it } from 'vitest';
import { ageBucket, money, paymentStateOf } from './money.ts';

describe('money', () => {
  it('adds and subtracts exactly', () => {
    expect(money.add('0.10', '0.20')).toBe('0.30');
    expect(money.sub('9839.00', '5000.50')).toBe('4838.50');
    expect(money.min('100', '99.99')).toBe('99.99');
    expect(money.cmp('5.00', '5')).toBe(0);
  });
});

describe('paymentStateOf', () => {
  it('derives unpaid, partial and paid', () => {
    expect(paymentStateOf('100', '0')).toBe('unpaid');
    expect(paymentStateOf('100', '40')).toBe('partial');
    expect(paymentStateOf('100', '100.00')).toBe('paid');
  });
});

describe('ageBucket', () => {
  it('buckets by days past due', () => {
    expect(ageBucket('2026-10-20', '2026-10-14')).toEqual({ bucket: 'notDue', daysOverdue: 0 });
    expect(ageBucket('2026-10-14', '2026-10-14').bucket).toBe('notDue');
    expect(ageBucket('2026-09-14', '2026-10-14')).toEqual({ bucket: 'd1_30', daysOverdue: 30 });
    expect(ageBucket('2026-09-13', '2026-10-14').bucket).toBe('d31_60');
    expect(ageBucket('2026-07-01', '2026-10-14').bucket).toBe('d90plus');
  });
});
