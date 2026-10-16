// API checks for purchase orders and goods receipts against a FRESH product DB with OSUITE_LICENSE=off.
// Usage: node e2e/purchase-order-api.mjs
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
  console.log(`${cond ? 'ok ' : 'FAIL'} ${msg}${cond || extra === undefined ? '' : `  -> ${JSON.stringify(extra).slice(0, 500)}`}`);
  if (!cond) failed++;
};
const create = async (model, values) => {
  const r = await api('POST', `/records/${model}`, values);
  if (r.status !== 201) throw new Error(`${model}: ${JSON.stringify(r.body)}`);
  return r.body;
};
const act = (model, id, action) => api('POST', `/records/${model}/${id}/actions/${action}`);
const get = async (model, id) => (await api('GET', `/records/${model}/${id}`)).body;
const tb = async () => (await api('GET', '/reports/trial-balance')).body;
const bal = (t, code) => t.rows.find((x) => x.code === code)?.balance ?? '0.00';
const stock = async (productId) => (await api('GET', `/records/stock.quant?f.productId=${productId}`)).body.records[0];
const pick = (t, codes) => t.rows.filter((x) => codes.includes(x.code)).map((x) => `${x.code}=${x.balance}`);

await api('POST', '/setup', { companyName: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', adminName: 'Admin', login: 'admin', password: 'admin1234' });
token = (await api('POST', '/auth/login', { login: 'admin', password: 'admin1234' })).body.token;
const bolt = await create('base.product', { name: 'Steel bolt M8', kind: 'goods', hsnCode: '7318', salePrice: '10', costPrice: '4' });
const freight = await create('base.product', { name: 'Freight', kind: 'service', hsnCode: '9965', costPrice: '200' });
const kcc = await create('base.contact', { name: 'Kalyani Castings', stateCode: '27', isVendor: true });
const boltLine = (qty, unitPrice = '4') => ({ productId: bolt.id, description: 'Steel bolt M8', hsnCode: '7318', qty, unitPrice, gstRate: '18' });
const freightLine = { productId: freight.id, description: 'Freight', hsnCode: '9965', qty: '1', unitPrice: '200', gstRate: '18' };
const accounts = (await api('GET', '/records/account.account?limit=100')).body.records;
check(accounts.some((a) => a.key === 'grni' && a.code === '2150' && a.type === 'liability'), 'chart has "Goods received, not billed"');

// ---------------------------------------------------------------- order
let po = await create('purchase.order', { vendorId: kcc.id, vendorState: '27', reference: 'KCC-Q-12', lines: [boltLine('100'), freightLine] });
check(po.state === 'draft' && po.totalAmount === '708.00' && po.cgstAmount === '54.00' && po.placeOfSupply === '27', 'draft purchase order priced with GST', po);
let r = await act('purchase.order', po.id, 'confirm');
check(r.status === 200 && /^PO\/\d\d-\d\d\/0001$/.test(r.body.number), 'confirmed as PO/…/0001', r.body);
check((await tb()).totalDebit === '0.00', 'a purchase order does not touch the books');

// ---------------------------------------------------------------- receiving in two parts
r = await act('purchase.order', po.id, 'createReceipt');
check(r.status === 200 && r.body.$open?.model === 'purchase.receipt', 'goods receipt created from the order', r.body);
let grn = await get('purchase.receipt', r.body.$open.id);
check(grn.lines.length === 1 && grn.lines[0].qty === '100.000' && grn.orderId?.id === po.id, 'receipt lists the 100 bolts to come', grn);
r = await api('PATCH', `/records/purchase.receipt/${grn.id}`, { vendorChallanNo: 'KCC/DC/44', lines: [{ id: grn.lines[0].id, ...boltLine('60') }] });
check(r.status === 200 && r.body.lines[0].qty === '60.000', 'part receipt of 60', r.body);
r = await act('purchase.receipt', grn.id, 'post');
check(r.status === 200 && /^GRN\/\d\d-\d\d\/0001$/.test(r.body.number) && r.body.lines[0].stockValue === '240.00', 'receipt posted as GRN/…/0001, 240 into stock', r.body);
let q = await stock(bolt.id);
check(q.qty === '60.000' && q.value === '240.00', 'stock up by 60 at 4', q);
let t = await tb();
check(bal(t, '1400') === '240.00' && bal(t, '2150') === '240.00' && bal(t, '2100') === '0.00' && t.balanced, 'Dr stock / Cr goods received not billed 240; nothing owed yet', pick(t, ['1400', '2150', '2100']));
po = await get('purchase.order', po.id);
check(po.deliveryStatus === 'partial' && po.invoiceStatus === 'none', 'order partly received', po);

r = await act('purchase.order', po.id, 'createReceipt');
let grn2 = await get('purchase.receipt', r.body.$open.id);
check(grn2.lines[0].qty === '40.000', 'next receipt offers the 40 left', grn2.lines);
await api('PATCH', `/records/purchase.receipt/${grn2.id}`, { lines: [{ id: grn2.lines[0].id, ...boltLine('45') }] });
check((await act('purchase.receipt', grn2.id, 'post')).status === 422, 'cannot receive more than ordered');
grn2 = await get('purchase.receipt', grn2.id);
await api('PATCH', `/records/purchase.receipt/${grn2.id}`, { lines: [{ id: grn2.lines[0].id, ...boltLine('40') }] });
check((await act('purchase.receipt', grn2.id, 'post')).status === 200, 'second receipt posted');
po = await get('purchase.order', po.id);
check(po.deliveryStatus === 'full', 'order fully received', po);

// ---------------------------------------------------------------- billing what arrived
r = await act('purchase.order', po.id, 'createBill');
check(r.status === 200 && r.body.$open?.model === 'purchase.bill', 'bill created from the order', r.body);
let bill = await get('purchase.bill', r.body.$open.id);
check(bill.lines.length === 3 && bill.lines.filter((l) => l.stockDone).length === 2 && bill.orderId?.id === po.id, 'bill lists both receipts and the freight', bill.lines);
check(bill.lines.filter((l) => l.stockDone).map((l) => l.receivedValue).join() === '240.00,160.00', 'with the value each receipt took in', bill.lines);
check((await act('purchase.bill', bill.id, 'post')).status === 422, "cannot post without the vendor's bill number");
// The vendor charged 4.50 for the second lot: the difference is a purchase expense.
r = await api('PATCH', `/records/purchase.bill/${bill.id}`, {
  vendorBillNo: 'KCC/991',
  lines: bill.lines.map((l, i) => ({ id: l.id, ...(i === 0 ? boltLine('60') : i === 1 ? boltLine('40', '4.5') : freightLine) })),
});
check(r.status === 200 && r.body.taxableAmount === '620.00' && r.body.lines[1].stockDone === true && r.body.lines[1].receivedValue === '160.00', 'rate changed on the draft; receipt links kept', r.body);
r = await act('purchase.bill', bill.id, 'post');
check(r.status === 200 && r.body.state === 'posted', 'bill posted', r.body);
q = await stock(bolt.id);
check(q.qty === '100.000' && q.value === '400.00', 'posting the bill does not add the goods again', q);
t = await tb();
check(bal(t, '2150') === '0.00' && bal(t, '1400') === '400.00' && bal(t, '5200') === '220.00' && bal(t, '2100') === '732.00', 'bill clears goods received (400); freight 200 + price difference 20 expensed; vendor owed 732', pick(t, ['2150', '1400', '5200', '2100']));
check(t.balanced, 'trial balance balances', t);
po = await get('purchase.order', po.id);
check(po.state === 'done' && po.invoiceStatus === 'full', 'order completed', po);
check((await act('purchase.receipt', grn.id, 'cancel')).status === 409, 'a billed receipt cannot be cancelled');

// ---------------------------------------------------------------- undoing
r = await act('purchase.bill', bill.id, 'cancel');
check(r.status === 200 && (await get('purchase.receipt', grn.id)).billId === null, 'cancelled bill frees its receipts', r.body);
t = await tb();
check(bal(t, '2150') === '400.00' && bal(t, '1400') === '400.00' && t.balanced, 'goods are back to received, not billed', pick(t, ['2150', '1400']));
po = await get('purchase.order', po.id);
check(po.state === 'confirmed' && po.invoiceStatus === 'none', 'order reopened', po);
r = await act('purchase.receipt', grn2.id, 'cancel');
check(r.status === 200 && (await stock(bolt.id)).qty === '60.000', 'cancelled receipt takes 40 back out', await stock(bolt.id));
t = await tb();
check(bal(t, '2150') === '240.00' && bal(t, '1400') === '240.00', 'and its 160 off both accounts', pick(t, ['2150', '1400']));
check((await act('purchase.order', po.id, 'cancel')).status === 409, 'an order with a posted receipt cannot be cancelled');

// ---------------------------------------------------------------- billed without a receipt
const po2 = await create('purchase.order', { vendorId: kcc.id, vendorState: '27', lines: [boltLine('10')] });
await act('purchase.order', po2.id, 'confirm');
r = await act('purchase.order', po2.id, 'createBill');
const b2 = await get('purchase.bill', r.body.$open.id);
check(b2.lines[0].stockDone === false && b2.lines[0].qty === '10.000', 'without receipts the bill itself brings the goods in', b2.lines);
await api('PATCH', `/records/purchase.bill/${b2.id}`, { vendorBillNo: 'KCC/992' });
check((await act('purchase.bill', b2.id, 'post')).status === 200 && (await stock(bolt.id)).qty === '70.000', 'stock up by 10 on the bill', await stock(bolt.id));
check((await get('purchase.order', po2.id)).state === 'done', 'direct-billed order completed');

const po3 = await create('purchase.order', { vendorId: kcc.id, vendorState: '27', lines: [freightLine] });
await act('purchase.order', po3.id, 'confirm');
check((await act('purchase.order', po3.id, 'createReceipt')).status === 422, 'a services-only order has nothing to receive');

t = await tb();
check(t.balanced, 'trial balance balances at the end', t);
check((await stock(bolt.id)).value === bal(t, '1400'), 'stock ledger and stock account agree');
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
