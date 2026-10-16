// API checks for sales orders and delivery challans against a FRESH product DB with OSUITE_LICENSE=off.
// Usage: node e2e/order-api.mjs
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
const stockQty = async (productId) => (await api('GET', `/records/stock.quant?f.productId=${productId}`)).body.records[0]?.qty;

await api('POST', '/setup', { companyName: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', adminName: 'Admin', login: 'admin', password: 'admin1234' });
token = (await api('POST', '/auth/login', { login: 'admin', password: 'admin1234' })).body.token;
const bolt = await create('base.product', { name: 'Steel bolt M8', kind: 'goods', hsnCode: '7318', salePrice: '10', costPrice: '4' });
const fit = await create('base.product', { name: 'Installation', kind: 'service', hsnCode: '9987', salePrice: '500' });
const acme = await create('base.contact', { name: 'Acme Industries', stateCode: '27' });
const opening = await create('stock.adjustment', { reason: 'opening', lines: [{ productId: bolt.id, qty: '100', unitCost: '4' }] });
await act('stock.adjustment', opening.id, 'post');
const boltLine = (qty) => ({ productId: bolt.id, description: 'Steel bolt M8', hsnCode: '7318', qty, unitPrice: '10', gstRate: '18' });
const fitLine = { productId: fit.id, description: 'Installation', hsnCode: '9987', qty: '1', unitPrice: '500', gstRate: '18' };

// ---------------------------------------------------------------- quotation → order
let q = await create('sales.quotation', { customerId: acme.id, placeOfSupply: '27', reference: 'RFQ-77', lines: [boltLine('30'), fitLine] });
await act('sales.quotation', q.id, 'send');
let r = await act('sales.quotation', q.id, 'toOrder');
check(r.status === 200 && r.body.state === 'ordered' && r.body.$open?.model === 'sales.order', 'quotation becomes a sales order', r.body);
let order = await get('sales.order', r.body.$open.id);
check(order.state === 'draft' && order.totalAmount === '944.00' && order.lines.length === 2 && order.quotationId?.id === q.id, 'draft order carries items, totals and its quotation', order);
check(order.reference === 'RFQ-77' && order.warehouseId, 'and the customer reference and a warehouse', order);

r = await act('sales.order', order.id, 'confirm');
check(r.status === 200 && r.body.state === 'confirmed' && /^SO\/\d\d-\d\d\/0001$/.test(r.body.number), 'confirmed order numbered SO/…/0001', r.body);
check(r.body.deliveryStatus === 'none' && r.body.invoiceStatus === 'none', 'nothing delivered or invoiced yet', r.body);
check((await api('PATCH', `/records/sales.order/${order.id}`, { reference: 'x' })).status === 409, 'confirmed order is locked');
const tb0 = await tb();

// ---------------------------------------------------------------- delivering in two parts
r = await act('sales.order', order.id, 'createDelivery');
check(r.status === 200 && r.body.$open?.model === 'sales.delivery', 'delivery challan created from the order', r.body);
let dc = await get('sales.delivery', r.body.$open.id);
check(dc.state === 'draft' && dc.lines.length === 1 && dc.lines[0].qty === '30.000' && dc.orderId?.id === order.id, 'challan lists only the stock item, with all 30 to go', dc);
check(dc.totalAmount === '354.00' && dc.taxableAmount === '300.00', 'challan carries the value of the goods (rule 55)', dc);
r = await api('PATCH', `/records/sales.delivery/${dc.id}`, { vehicleNo: 'MH12AB1234', lines: [{ id: dc.lines[0].id, ...boltLine('20') }] });
check(r.status === 200 && r.body.totalAmount === '236.00' && r.body.lines[0].orderLineId?.id === dc.lines[0].orderLineId.id, 'part delivery of 20 keeps its link to the order line', r.body);
r = await act('sales.delivery', dc.id, 'post');
check(r.status === 200 && r.body.state === 'posted' && /^DC\/\d\d-\d\d\/0001$/.test(r.body.number), 'challan posted as DC/…/0001', r.body);
check((await stockQty(bolt.id)) === '80.000', 'goods left stock on the challan', await stockQty(bolt.id));
let t = await tb();
check(bal(t, '5100') === '80.00' && bal(t, '1400') === '320.00' && bal(t, '1300') === '0.00' && bal(t, '4100') === '0.00', 'challan books cost of goods (80) but no sale', t.rows);
check(t.balanced, 'trial balance still balances', t);
order = await get('sales.order', order.id);
const boltOL = order.lines.find((l) => l.productId?.id === bolt.id);
check(order.deliveryStatus === 'partial' && boltOL.qtyDelivered === '20.000' && order.state === 'confirmed', 'order shows 20 of 30 delivered', order);

r = await act('sales.order', order.id, 'createDelivery');
let dc2 = await get('sales.delivery', r.body.$open.id);
check(dc2.lines[0].qty === '10.000', 'next challan offers the 10 left', dc2.lines);
check((await act('sales.order', order.id, 'createDelivery')).status === 422, 'no third challan while the rest is on a draft');
await api('PATCH', `/records/sales.delivery/${dc2.id}`, { lines: [{ id: dc2.lines[0].id, ...boltLine('15') }] });
r = await act('sales.delivery', dc2.id, 'post');
check(r.status === 422 && /More than ordered/.test(r.body.error ?? r.body.message ?? JSON.stringify(r.body)), 'cannot deliver more than ordered', r.body);
dc2 = await get('sales.delivery', dc2.id);
await api('PATCH', `/records/sales.delivery/${dc2.id}`, { lines: [{ id: dc2.lines[0].id, ...boltLine('10') }] });
r = await act('sales.delivery', dc2.id, 'post');
check(r.status === 200 && r.body.state === 'posted', 'second challan posted', r.body);
order = await get('sales.order', order.id);
check(order.deliveryStatus === 'full' && order.invoiceStatus === 'none', 'order fully delivered, not invoiced', order);

// ---------------------------------------------------------------- invoicing what was delivered
r = await act('sales.order', order.id, 'createInvoice');
check(r.status === 200 && r.body.$open?.model === 'sales.invoice', 'invoice created from the order', r.body);
let inv = await get('sales.invoice', r.body.$open.id);
const challanLines = inv.lines.filter((l) => l.stockDone);
check(inv.lines.length === 3 && challanLines.length === 2 && inv.lines.find((l) => l.productId?.id === fit.id && !l.stockDone), 'invoice lists both challans and the service', inv.lines);
check(inv.totalAmount === '944.00' && inv.orderId?.id === order.id, 'invoice total matches the order', inv);
check((await get('sales.delivery', dc.id)).invoiceId?.id === inv.id && (await get('sales.delivery', dc2.id)).invoiceId?.id === inv.id, 'both challans now point at the invoice');
check((await act('sales.order', order.id, 'createInvoice')).status === 422, 'nothing left to invoice while that draft exists');

r = await act('sales.invoice', inv.id, 'post');
check(r.status === 200 && r.body.state === 'posted', 'invoice posted', r.body);
check((await stockQty(bolt.id)) === '70.000', 'posting the invoice does not move the goods again', await stockQty(bolt.id));
t = await tb();
check(bal(t, '5100') === '120.00' && bal(t, '1300') === '944.00' && bal(t, '4100') === '800.00', 'cost booked once (120); sale 800 and debtors 944', t.rows.filter((x) => ['5100', '1300', '4100'].includes(x.code)));
check(t.balanced, 'trial balance balances', t);
order = await get('sales.order', order.id);
check(order.state === 'done' && order.invoiceStatus === 'full', 'order completed', order);
r = await act('sales.delivery', dc.id, 'cancel');
check(r.status === 409, 'an invoiced challan cannot be cancelled', r.body);

// ---------------------------------------------------------------- undoing
r = await act('sales.invoice', inv.id, 'cancel');
check(r.status === 200 && r.body.state === 'cancelled', 'invoice cancelled', r.body);
check((await stockQty(bolt.id)) === '70.000', 'goods stay with the customer (challans still stand)');
check((await get('sales.delivery', dc.id)).invoiceId === null, 'challans released for invoicing again');
order = await get('sales.order', order.id);
check(order.state === 'confirmed' && order.invoiceStatus === 'none' && order.deliveryStatus === 'full', 'order reopened: delivered, not invoiced', order);
r = await act('sales.order', order.id, 'createInvoice');
const inv2 = r.body.$open.id;
r = await api('DELETE', `/records/sales.invoice/${inv2}`);
check(r.status === 204 && (await get('sales.delivery', dc2.id)).invoiceId === null, 'deleting a draft invoice frees its challans', r.body);
r = await act('sales.delivery', dc2.id, 'cancel');
check(r.status === 200 && (await stockQty(bolt.id)) === '80.000', 'cancelled challan brings 10 back', await stockQty(bolt.id));
order = await get('sales.order', order.id);
check(order.deliveryStatus === 'partial', 'order back to partly delivered', order);
r = await act('sales.order', order.id, 'cancel');
check(r.status === 409, 'an order with a posted challan cannot be cancelled', r.body);
t = await tb();
check(t.balanced && bal(t, '1400') === '320.00' && bal(t, '5100') === '80.00', 'books match stock after the undo (80 out at 4)', t.rows);

// ---------------------------------------------------------------- an order invoiced without challans
let o2 = await create('sales.order', { customerId: acme.id, placeOfSupply: '27', lines: [boltLine('5')] });
await act('sales.order', o2.id, 'confirm');
r = await act('sales.order', o2.id, 'createInvoice');
const inv3 = await get('sales.invoice', r.body.$open.id);
check(inv3.lines.length === 1 && inv3.lines[0].stockDone === false && inv3.lines[0].qty === '5.000', 'without challans the invoice itself ships the goods', inv3.lines);
await act('sales.invoice', inv3.id, 'post');
check((await stockQty(bolt.id)) === '75.000', 'goods left stock on the invoice', await stockQty(bolt.id));
o2 = await get('sales.order', o2.id);
check(o2.state === 'done' && o2.deliveryStatus === 'full' && o2.invoiceStatus === 'full', 'direct-invoiced order completed', o2);

// ---------------------------------------------------------------- deleting a draft order
const q2 = await create('sales.quotation', { customerId: acme.id, placeOfSupply: '27', lines: [fitLine] });
await act('sales.quotation', q2.id, 'send');
const o3 = (await act('sales.quotation', q2.id, 'toOrder')).body.$open.id;
r = await api('DELETE', `/records/sales.order/${o3}`);
check(r.status === 204 && (await get('sales.quotation', q2.id)).state === 'accepted', 'deleting the draft order puts the quotation back to accepted', r.body);

// Services only: nothing to deliver.
const o4 = await create('sales.order', { customerId: acme.id, placeOfSupply: '27', lines: [fitLine] });
await act('sales.order', o4.id, 'confirm');
check((await act('sales.order', o4.id, 'createDelivery')).status === 422, 'a services-only order has nothing to deliver');
check((await act('sales.order', o4.id, 'cancel')).body.state === 'cancelled', 'an untouched order can be cancelled');

check((await tb()).balanced, 'trial balance balances at the end');
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
