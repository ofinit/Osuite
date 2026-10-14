import { describe, expect, it } from 'vitest';
import { defineModel, flattenErrors, inputSchema } from './index.ts';

const model = defineModel({
  name: 'test.item',
  table: 'test_item',
  label: 'Item',
  labelPlural: 'Items',
  recName: 'name',
  searchFields: ['name'],
  fields: {
    name: { type: 'char', label: 'Name', required: true, maxLength: 10 },
    email: { type: 'email', label: 'Email' },
    price: { type: 'decimal', label: 'Price', scale: 2 },
    kind: { type: 'selection', label: 'Kind', options: [['a', 'A'], ['b', 'B']] },
    parentId: { type: 'many2one', label: 'Parent', relation: 'test.item' },
  },
  list: { columns: ['name'] },
  form: { sections: [{ fields: ['name', 'email', 'price', 'kind', 'parentId'] }] },
});

describe('inputSchema', () => {
  const create = inputSchema(model, 'create');
  const update = inputSchema(model, 'update');

  it('accepts valid input and normalises decimals to strings', () => {
    expect(create.parse({ name: 'Bolt', price: 12.5, kind: 'a' })).toEqual({ name: 'Bolt', price: '12.5', kind: 'a' });
  });

  it('enforces required fields on create only', () => {
    const r = create.safeParse({ email: '' });
    expect(r.success).toBe(false);
    expect(flattenErrors(r.error!)).toHaveProperty('name');
    expect(update.parse({ email: '' })).toEqual({ email: null });
  });

  it('rejects bad values', () => {
    const r = create.safeParse({ name: 'x', email: 'nope', price: '1.234', kind: 'z', parentId: -1 });
    expect(Object.keys(flattenErrors(r.error!)).sort()).toEqual(['email', 'kind', 'parentId', 'price']);
  });

  it('rejects unknown fields', () => {
    expect(update.safeParse({ hacker: true }).success).toBe(false);
  });

  it('validates model references', () => {
    expect(() => defineModel({ ...model, recName: 'missing' })).toThrow(/unknown field/);
  });
});
