// API checks for GST invoices against a FRESH product DB with OSUITE_LICENSE=off.
// Usage: node e2e/invoice-api.mjs
const B = 'http://127.0.0.1:47800/api';
let token;
async function api(method, path, body) {
  const r = await fetch(B + path, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
}
let failed = 0;
const check = (cond, msg, extra) => {
  console.log(`${cond ? 'ok ' : 'FAIL'} ${msg}${cond || extra === undefined ? '' : `  -> ${JSON.stringify(extra).slice(0, 300)}`}`);
  if (!cond) failed++;
};

await api('POST', '/setup', { companyName: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', adminName: 'Admin', login: 'admin', password: 'admin1234' });
token = (await api('POST', '/auth/login', { login: 'admin', password: 'admin1234' })).body.token;
const pune = (await api('POST', '/records/base.contact', { name: 'Acme Industries', stateCode: '27' })).body;
const blr = (await api('POST', '/records/base.contact', { name: 'Kaveri Agro Foods', stateCode: '29' })).body;
const bolt = (await api('POST', '/records/base.product', { name: 'Steel bolt M8', hsnCode: '7318', salePrice: '4.50' })).body;
// Opening stock so goods invoices can post.
const opening = (await api('POST', '/records/stock.adjustment', { reason: 'opening', lines: [{ productId: bolt.id, qty: '1000', unitCost: '3' }] })).body;
await api('POST', `/records/stock.adjustment/${opening.id}/actions/post`);

const lines = [
  { productId: bolt.id, description: 'Steel bolt M8', hsnCode: '7318', qty: '10', unitPrice: '4.50', gstRate: '18' },
  { description: 'Copper wire 2.5 mm', hsnCode: '8544', qty: '3', unitPrice: '2450', discountPct: '10', gstRate: '18' },
  { description: 'Installation', hsnCode: '9987', qty: '1', unitPrice: '1500', gstRate: '18' },
  { description: 'Gloves', qty: '2', unitPrice: '99.99', gstRate: '5' },
];

let r = await api('POST', '/records/sales.invoice', { customerId: pune.id, placeOfSupply: '27', lines });
check(r.status === 201, 'draft invoice created', r.body);
const inv = r.body;
check(inv.state === 'draft' && inv.number === null, 'starts as an unnumbered draft');
check(/^\d{4}-\d{2}-\d{2}$/.test(inv.date), 'date defaults to today', inv.date);
check(
  inv.taxableAmount === '8359.98' && inv.cgstAmount === '739.40' && inv.sgstAmount === '739.40' && inv.igstAmount === '0.00',
  'intra-state CGST/SGST totals',
  inv,
);
check(inv.roundOff === '0.22' && inv.totalAmount === '9839.00', 'rounded to the rupee');
check(
  inv.lines.length === 4 && inv.lines[1].taxableAmount === '6615.00' && inv.lines[0].productId.display === 'Steel bolt M8',
  'lines saved with computed amounts',
);
check(inv.lines.map((l) => l.sequence).join() === '1,2,3,4', 'lines numbered in order');

// Edit lines: change qty of the first, drop the last, add one, reorder.
const [l1, l2, l3] = inv.lines;
r = await api('PATCH', `/records/sales.invoice/${inv.id}`, {
  lines: [
    { id: l3.id, description: l3.description, qty: '2', unitPrice: '1500', gstRate: '18' },
    { id: l1.id, description: l1.description, productId: bolt.id, qty: '20', unitPrice: '4.50', gstRate: '18' },
    { description: 'Freight', qty: '1', unitPrice: '200', gstRate: '18' },
  ],
});
check(r.status === 200, 'lines updated', r.body);
check(r.body.lines.length === 3 && r.body.lines[0].id === l3.id && r.body.lines[1].id === l1.id, 'existing lines kept their ids and new order');
check(r.body.taxableAmount === '3290.00' && r.body.totalAmount === '3882.00', 'totals recomputed', r.body.totalAmount);
check(!r.body.lines.some((l) => l.id === l2.id), 'removed line deleted');

// Changing place of supply alone re-derives taxes on stored lines.
r = await api('PATCH', `/records/sales.invoice/${inv.id}`, { placeOfSupply: '29' });
check(r.body.igstAmount === '592.20' && r.body.cgstAmount === '0.00', 'place of supply switch moves tax to IGST', r.body);
r = await api('GET', `/records/sales.invoice/${inv.id}`);
check(r.body.lines[0].taxAmount === '540.00', 'stored line tax follows the switch', r.body.lines[0]);
await api('PATCH', `/records/sales.invoice/${inv.id}`, { placeOfSupply: '27' });

// Validation.
r = await api('POST', '/records/sales.invoice', { customerId: pune.id, placeOfSupply: '27', lines: [{ qty: 'abc', unitPrice: '1' }] });
check(r.status === 422 && r.body.fieldErrors['lines.0.description'] && r.body.fieldErrors['lines.0.qty'], 'line errors are reported per row', r.body);
r = await api('POST', '/records/sales.invoice', { customerId: blr.id, placeOfSupply: '27', customerGstin: '29AAPFU0939F1ZV' });
check(r.status === 422 && 'customerGstin' in r.body.fieldErrors, 'invalid customer GSTIN rejected', r.body);
r = await api('POST', '/records/sales.invoice_line', { description: 'x', qty: '1', unitPrice: '1' });
check(r.status === 403, 'lines cannot be written directly', r.body);
const empty = (await api('POST', '/records/sales.invoice', { customerId: pune.id, placeOfSupply: '27' })).body;
r = await api('POST', `/records/sales.invoice/${empty.id}/actions/post`);
check(r.status === 422, 'cannot post an invoice without items', r.body);

// Posting assigns numbers in order and locks the invoice.
r = await api('POST', `/records/sales.invoice/${inv.id}/actions/post`);
check(r.status === 200 && r.body.state === 'posted' && /^INV\/\d{2}-\d{2}\/0001$/.test(r.body.number), 'posted with the first number', r.body);
r = await api('PATCH', `/records/sales.invoice/${inv.id}`, { reference: 'PO-9' });
check(r.status === 409, 'posted invoice cannot be edited', r.body);
r = await api('DELETE', `/records/sales.invoice/${inv.id}`);
check(r.status === 409, 'posted invoice cannot be deleted', r.body);
r = await api('POST', `/records/sales.invoice/${inv.id}/actions/post`);
check(r.status === 409, 'cannot post twice', r.body);

const inv2 = (
  await api('POST', '/records/sales.invoice', {
    customerId: blr.id,
    placeOfSupply: '29',
    lines: [{ description: 'Bolts', qty: '100', unitPrice: '4.5', gstRate: '18' }],
  })
).body;
check(inv2.igstAmount === '81.00' && inv2.totalAmount === '531.00', 'inter-state invoice charges IGST', inv2);
r = await api('POST', `/records/sales.invoice/${inv2.id}/actions/post`);
check(r.body.number?.endsWith('/0002'), 'next invoice gets the next number', r.body);

r = await api('POST', `/records/sales.invoice/${inv.id}/actions/cancel`);
check(r.body.state === 'cancelled' && r.body.number.endsWith('/0001'), 'cancelled invoice keeps its number', r.body);
r = await api('DELETE', `/records/sales.invoice/${empty.id}`);
check(r.status === 204, 'draft can be deleted', r.body);

const hist = (await api('GET', `/records/sales.invoice/${inv.id}/history`)).body;
check(hist.map((h) => h.action).join() === 'cancel,post,update,update,update,create', 'history records edits and actions', hist.map((h) => h.action));
check((await api('GET', '/audit/verify')).body.ok, 'audit chain intact');
const list = (await api('GET', '/records/sales.invoice?q=INV')).body;
check(list.total === 2, 'invoices searchable by number', list.total);

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
