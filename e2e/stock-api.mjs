// API checks for inventory against a FRESH product DB with OSUITE_LICENSE=off.
// Usage: node e2e/stock-api.mjs
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
  console.log(`${cond ? 'ok ' : 'FAIL'} ${msg}${cond || extra === undefined ? '' : `  -> ${JSON.stringify(extra).slice(0, 400)}`}`);
  if (!cond) failed++;
};
const post = (model, id) => api('POST', `/records/${model}/${id}/actions/post`);
const cancel = (model, id) => api('POST', `/records/${model}/${id}/actions/cancel`);
const stockOf = async (productId) => (await api('GET', `/records/stock.quant?f.productId=${productId}`)).body.records[0];

await api('POST', '/setup', { companyName: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', adminName: 'Admin', login: 'admin', password: 'admin1234' });
token = (await api('POST', '/auth/login', { login: 'admin', password: 'admin1234' })).body.token;

const wh = (await api('GET', '/records/stock.warehouse')).body.records;
check(wh.length === 1 && wh[0].code === 'MAIN', 'a main warehouse exists from the start', wh);
const bolt = (await api('POST', '/records/base.product', { name: 'Steel bolt M8', hsnCode: '7318', salePrice: '9', costPrice: '4', kind: 'goods' })).body;
const svc = (await api('POST', '/records/base.product', { name: 'Installation', hsnCode: '9987', salePrice: '1500', kind: 'service' })).body;
const customer = (await api('POST', '/records/base.contact', { name: 'Acme Industries', stateCode: '27' })).body;
const vendor = (await api('POST', '/records/base.contact', { name: 'Pune Steel Suppliers', isVendor: true, stateCode: '27' })).body;

// Opening stock: 100 @ 4.00
let r = await api('POST', '/records/stock.adjustment', { reason: 'opening', lines: [{ productId: bolt.id, qty: '100', unitCost: '4' }] });
check(r.status === 201 && r.body.warehouseId?.id === wh[0].id, 'adjustment defaults to the main warehouse', r.body);
r = await post('stock.adjustment', r.body.id);
check(r.body.state === 'posted' && /^ADJ\//.test(r.body.number), 'opening stock posted', r.body);
let q = await stockOf(bolt.id);
check(q.qty === '100.000' && q.value === '400.00' && q.avgCost === '4.0000', 'stock on hand 100 worth 400', q);

// Bill: 50 @ 5.50 less 10% discount -> net 4.95 each (GST is not cost)
const bill = (await api('POST', '/records/purchase.bill', {
  vendorId: vendor.id, vendorState: '27', vendorBillNo: 'PSS-1',
  lines: [{ productId: bolt.id, description: 'Steel bolt M8', qty: '50', unitPrice: '5.50', discountPct: '10', gstRate: '18' }],
})).body;
check(bill.warehouseId?.code === undefined && bill.warehouseId?.display === 'Main warehouse', 'bill receives into the main warehouse', bill.warehouseId);
r = await post('purchase.bill', bill.id);
check(r.status === 200, 'bill posted', r.body);
q = await stockOf(bolt.id);
check(q.qty === '150.000' && q.value === '647.50' && q.avgCost === '4.3167', 'bill adds 50 at net cost 4.95 (avg 4.3167)', q);

// Invoice: 30 bolts + a service line; only goods move.
const inv = (await api('POST', '/records/sales.invoice', {
  customerId: customer.id, placeOfSupply: '27',
  lines: [
    { productId: bolt.id, description: 'Steel bolt M8', qty: '30', unitPrice: '9', gstRate: '18' },
    { productId: svc.id, description: 'Installation', qty: '1', unitPrice: '1500', gstRate: '18' },
  ],
})).body;
r = await post('sales.invoice', inv.id);
check(r.status === 200, 'invoice posted', r.body);
q = await stockOf(bolt.id);
check(q.qty === '120.000' && q.value === '518.00' && q.avgCost === '4.3167', 'invoice removes 30 at average cost (129.50)', q);
const moves = (await api('GET', `/records/stock.move?q=${encodeURIComponent(r.body.number)}`)).body.records;
check(moves.length === 1 && moves[0].kind === 'sale' && moves[0].value === '-129.50' && moves[0].balanceQty === '120.000', 'ledger has one sale movement (no service line)', moves);
check((await stockOf(svc.id)) === undefined, 'services never get stock');

// Shortage is blocked and explained.
const big = (await api('POST', '/records/sales.invoice', { customerId: customer.id, placeOfSupply: '27', lines: [{ productId: bolt.id, description: 'Steel bolt M8', qty: '500', unitPrice: '9', gstRate: '18' }] })).body;
r = await post('sales.invoice', big.id);
check(r.status === 409 && /Steel bolt M8: need 500, have 120 in Main warehouse/.test(r.body.error), 'posting beyond stock is refused with details', r.body);
r = await api('GET', `/records/sales.invoice/${big.id}`);
check(r.body.state === 'draft' && r.body.number === null, 'refused invoice stays an unnumbered draft (no gap)', r.body);
check((await stockOf(bolt.id)).qty === '120.000', 'stock unchanged after refusal');

// Company may allow negative stock.
const company = (await api('GET', '/company')).body;
await api('PUT', '/company', { ...company, allowNegativeStock: true });
r = await post('sales.invoice', big.id);
check(r.status === 200 && (await stockOf(bolt.id)).qty === '-380.000', 'with negative stock allowed, the sale posts', r.body);

// Cancelling restores stock exactly.
r = await cancel('sales.invoice', big.id);
q = await stockOf(bolt.id);
check(r.body.state === 'cancelled' && q.qty === '120.000' && q.value === '518.00', 'cancelling the invoice restores quantity and value', q);
r = await cancel('sales.invoice', big.id);
check(r.status === 409 && (await stockOf(bolt.id)).qty === '120.000', 'a cancelled invoice cannot be reversed twice', r.body);
await api('PUT', '/company', { ...company, allowNegativeStock: false });

// Cancelling the bill would take stock below what remains -> blocked; at cost otherwise.
const adjOut = (await api('POST', '/records/stock.adjustment', { reason: 'damage', lines: [{ productId: bolt.id, qty: '-80' }] })).body;
await post('stock.adjustment', adjOut.id);
check((await stockOf(bolt.id)).qty === '40.000', 'damage write-off removes 80');
r = await cancel('purchase.bill', bill.id);
check(r.status === 409 && /need 50, have 40/.test(r.body.error), 'bill cancel refused when its stock is already gone', r.body);

// Ledger is read-only; documents searchable by partner name.
r = await api('POST', '/records/stock.move', { reference: 'x' });
check(r.status === 403, 'stock ledger cannot be written directly', r.body);
r = await api('PATCH', `/records/stock.quant/${q.id}`, { qty: '999' });
check(r.status === 403, 'stock on hand cannot be edited directly', r.body);
r = await api('GET', '/records/sales.invoice?q=acme');
check(r.body.total === 2, 'invoices found by customer name', r.body.total);
r = await api('GET', '/records/stock.quant?q=bolt');
check(r.body.total === 1, 'stock on hand found by product name', r.body.total);
check((await api('GET', '/audit/verify')).body.ok, 'audit chain intact');

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
