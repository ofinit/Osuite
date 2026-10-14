import { describe, expect, it } from 'vitest';
import { applyMove, netUnitCost, type StockPosition } from './stock.ts';

const empty: StockPosition = { qty: '0', value: '0', avgCost: '0' };

describe('applyMove (weighted average)', () => {
  it('averages incoming lots and values outgoing stock at the average', () => {
    const a = applyMove(empty, '100', '4');
    expect(a.position).toEqual({ qty: '100.000', value: '400.00', avgCost: '4.0000' });
    const b = applyMove(a.position, '50', '5');
    expect(b.position).toEqual({ qty: '150.000', value: '650.00', avgCost: '4.3333' });
    const c = applyMove(b.position, '-30');
    expect(c.moveValue).toBe('-130.00');
    expect(c.position).toEqual({ qty: '120.000', value: '520.00', avgCost: '4.3333' });
  });

  it('keeps value exact when stock is fully consumed', () => {
    const a = applyMove(empty, '3', '10'); // 30.00
    const b = applyMove(a.position, '-1'); // -10.00
    const c = applyMove(b.position, '-2'); // -20.00
    expect(c.position.value).toBe('0.00');
    expect(c.position.qty).toBe('0.000');
  });

  it('values returns without a cost at the current average', () => {
    const a = applyMove(empty, '10', '7.5');
    const b = applyMove(a.position, '-4');
    const back = applyMove(b.position, '4');
    expect(back.unitCost).toBe('7.5000');
    expect(back.position).toEqual(a.position);
  });

  it('reverses a purchase at its original cost', () => {
    const a = applyMove(empty, '100', '4');
    const b = applyMove(a.position, '50', '5');
    const undo = applyMove(b.position, '-50', '5', { atCost: true });
    expect(undo.moveValue).toBe('-250.00');
    expect(undo.position).toEqual(a.position);
  });

  it('restarts the average from the incoming cost after negative stock', () => {
    const neg = applyMove(empty, '-5'); // allowed negative, valued at 0
    const r = applyMove(neg.position, '10', '6');
    expect(r.position.qty).toBe('5.000');
    expect(r.position.avgCost).toBe('12.0000'); // 60 value over 5 units
  });
});

describe('netUnitCost', () => {
  it('divides the taxable amount by quantity', () => {
    expect(netUnitCost('3', '6615.00')).toBe('2205.0000');
    expect(netUnitCost('0', '10')).toBe('0.0000');
  });
});
