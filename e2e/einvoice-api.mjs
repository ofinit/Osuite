// API checks for e-invoicing and e-way bills (simulator provider) against a FRESH
// product DB with OSUITE_LICENSE=off.   Usage: node e2e/einvoice-api.mjs
import { createHash } from 'node:crypto';

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
const post = async (model, id) => {
  const r = await api('POST', `/records/${model}/${id}/actions/post`);
  if (r.status !== 200) throw new Error(`${model} post: ${JSON.stringify(r.body)}`);
  return r.body;
};
const act = (model, id, action) => api('POST', `/records/${model}/${id}/actions/${action}`);
const ei = (model, id, path = '', body) => api(path ? 'POST' : 'GET', `/einvoice/${model}/${id}${path}`, body ?? (path ? {} : undefined));
const irnOf = (type, number) => createHash('sha256').update(`27AAPFU0939F1ZV2026-27${type}${number}`).digest('hex');

await api('POST', '/setup', { companyName: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', adminName: 'Admin', login: 'admin', password: 'admin1234' });
token = (await api('POST', '/auth/login', { login: 'admin', password: 'admin1234' })).body.token;
let r = await api('PUT', '/company', { name: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', street: '14 MG Road', city: 'Pune', pincode: '411030', phone: '020 2445 6677' });
check(r.status === 200, 'company address set', r.body);

const bolt = await create('base.product', { name: 'Steel bolt M8', kind: 'goods', hsnCode: '7318', salePrice: '9' });
await post('stock.adjustment', (await create('stock.adjustment', { reason: 'opening', lines: [{ productId: bolt.id, qty: '10000', unitCost: '4' }] })).id);
const svc = await create('base.product', { name: 'Installation', kind: 'service', hsnCode: '998719', salePrice: '1500' });
const kc = await create('base.contact', { name: 'Karnataka Components Pvt Ltd', gstin: '29AABCT1332L1ZA', stateCode: '29', street: '5 Residency Road', city: 'Bengaluru', pincode: '560025' });
const noPin = await create('base.contact', { name: 'Nashik Agencies', gstin: '27AABCU9603R1ZN', stateCode: '27', city: 'Nashik' });
const walkIn = await create('base.contact', { name: 'Walk-in customer', stateCode: '27' });
const goods = (qty = '100') => ({ productId: bolt.id, description: 'Steel bolt M8', hsnCode: '7318', qty, uom: 'NOS', unitPrice: '9', gstRate: '18' });
const service = { productId: svc.id, description: 'Installation', hsnCode: '998719', qty: '1', uom: 'HRS', unitPrice: '1500', gstRate: '18' };
const invoice = async (customer, lines) => {
  const d = await create('sales.invoice', { customerId: customer.id, placeOfSupply: customer.stateCode, lines });
  return post('sales.invoice', d.id);
};

// ---------------------------------------------------------------- settings
r = await api('GET', '/einvoice/settings');
check(r.body.enabled === false && r.body.providers.some((p) => p.id === 'simulator' && p.simulated), 'off by default; simulator offered', r.body);
const inv = await invoice(kc, [goods(), service]);
check((await ei('sales.invoice', inv.id, '/generate')).status === 409, 'generating while turned off is refused');
r = await api('PUT', '/einvoice/settings', { enabled: true, provider: 'simulator' });
check(r.status === 200 && r.body.enabled, 'turned on with the simulator', r.body);
check((await api('PUT', '/einvoice/settings', { provider: 'nope' })).status === 400, 'unknown provider refused');

// ---------------------------------------------------------------- preview
r = await ei('sales.invoice', inv.id);
const p = r.body.payload;
check(r.body.skipReason === null && r.body.problems.length === 0, 'posted B2B invoice is ready', r.body.problems);
check(p.DocDtls.Typ === 'INV' && p.DocDtls.No === inv.number && p.BuyerDtls.Gstin === '29AABCT1332L1ZA' && p.BuyerDtls.Pos === '29', 'payload names document and buyer', p.DocDtls);
check(p.ValDtls.IgstVal === 432 && p.ValDtls.TotInvVal === 2832 && p.ItemList[1].IsServc === 'Y', 'inter-state IGST values and service flag', p.ValDtls);

const inv2 = await invoice(noPin, [goods('10')]);
r = await ei('sales.invoice', inv2.id);
check(r.body.problems.some((x) => /customer: a 6-digit PIN/.test(x)) && r.body.problems.some((x) => /customer: the street/.test(x)), 'missing customer address is reported in words', r.body.problems);
r = await ei('sales.invoice', inv2.id, '/generate');
check(r.status === 422 && /Fix these/.test(r.body.error), 'generation refused until the address is fixed', r.body);
const b2c = await invoice(walkIn, [goods('5')]);
r = await ei('sales.invoice', b2c.id, '/generate');
check(r.status === 422 && /registered \(B2B\)/.test(r.body.error), 'B2C invoices are not e-invoiced', r.body);
const draftOnly = await create('sales.invoice', { customerId: kc.id, placeOfSupply: '29', lines: [goods()] });
check((await ei('sales.invoice', draftOnly.id)).body.skipReason === 'Only posted documents can be e-invoiced.', 'drafts are not e-invoiced');

// ---------------------------------------------------------------- generate
r = await ei('sales.invoice', inv.id, '/generate');
check(r.status === 200 && r.body.irn === irnOf('INV', inv.number) && r.body.simulated, 'IRN follows the IRP formula', r.body);
let doc = (await api('GET', `/records/sales.invoice/${inv.id}`)).body;
check(doc.irnStatus === 'active' && /^\d{15}$/.test(doc.irnAckNo) && doc.irnSignedQr.split('.').length === 3, 'IRN, ack and signed QR stored', doc);
const qr = JSON.parse(JSON.parse(Buffer.from(doc.irnSignedQr.split('.')[1], 'base64url').toString()).data);
check(qr.Irn === irnOf('INV', inv.number) && qr.TotInvVal === 2832 && qr.ItemCnt === 2 && qr.MainHsnCode === '998719', 'QR carries the IRP fields', qr);
check((await ei('sales.invoice', inv.id, '/generate')).status === 409, 'cannot generate twice');
r = await act('sales.invoice', inv.id, 'cancel');
check(r.status === 409 && /active e-invoice/.test(r.body.error), 'invoice with an active IRN cannot simply be cancelled', r.body);

// ---------------------------------------------------------------- e-way bill
const svcOnly = await invoice(kc, [service]);
await ei('sales.invoice', svcOnly.id, '/generate');
r = await ei('sales.invoice', svcOnly.id, '/ewaybill', { distanceKm: 100, vehicleNo: 'MH12AB1234', transMode: '1' });
check(r.status === 422 && /only services/.test(r.body.error), 'no e-way bill for services', r.body);
check((await ei('sales.invoice', b2c.id, '/ewaybill', { distanceKm: 100, vehicleNo: 'MH12AB1234' })).status === 409, 'e-way bill needs an IRN first');
r = await ei('sales.invoice', inv.id, '/ewaybill', { distanceKm: 840 });
check(r.status === 422 && /vehicle number/.test(r.body.error), 'vehicle or transporter required', r.body);
r = await ei('sales.invoice', inv.id, '/ewaybill', { distanceKm: 840, transMode: '1', vehicleNo: 'mh 12 ab 1234' });
check(r.status === 200 && /^\d{12}$/.test(r.body.ewbNo), 'e-way bill generated', r.body);
doc = (await api('GET', `/records/sales.invoice/${inv.id}`)).body;
const days = (Date.parse(doc.ewbValidUntil) - Date.parse(doc.ewbDate.slice(0, 10))) / 86400000;
check(doc.ewbStatus === 'active' && days === 5, 'valid five days for 840 km', { until: doc.ewbValidUntil, days });

// ---------------------------------------------------------------- cancelling
r = await ei('sales.invoice', inv.id, '/cancel', { reason: '2', remark: 'Wrong rate' });
check(r.status === 409 && /e-way bill first/.test(r.body.error), 'IRN cannot be cancelled while the e-way bill is active', r.body);
check((await ei('sales.invoice', inv.id, '/ewaybill/cancel', { reason: '9', remark: 'x' })).status === 400, 'cancellation needs a valid reason');
r = await ei('sales.invoice', inv.id, '/ewaybill/cancel', { reason: '3', remark: 'Order cancelled by buyer' });
check(r.status === 200, 'e-way bill cancelled', r.body);
r = await ei('sales.invoice', inv.id, '/cancel', { reason: '2', remark: 'Wrong rate' });
check(r.status === 200, 'e-invoice cancelled within 24 hours', r.body);
check((await ei('sales.invoice', inv.id, '/generate')).status === 409, 'a cancelled IRN is not regenerated for the same number');
r = await act('sales.invoice', inv.id, 'cancel');
check(r.status === 200 && r.body.state === 'cancelled', 'now the invoice itself can be cancelled', r.body);

// ---------------------------------------------------------------- credit note
const inv3 = await invoice(kc, [goods('200')]);
await ei('sales.invoice', inv3.id, '/generate');
const cn = await create('sales.credit_note', { invoiceId: inv3.id, customerId: kc.id, placeOfSupply: '29', reason: 'return', lines: [goods('20')] });
const cnPosted = await post('sales.credit_note', cn.id);
r = await ei('sales.credit_note', cn.id);
check(r.body.problems.length === 0 && r.body.payload.DocDtls.Typ === 'CRN' && r.body.payload.RefDtls.PrecDocDtls[0].InvNo === inv3.number, 'credit note payload refers to its invoice', r.body);
r = await ei('sales.credit_note', cn.id, '/generate');
check(r.status === 200 && r.body.irn === irnOf('CRN', cnPosted.number), 'credit note e-invoiced', r.body);

const hist = (await api('GET', `/records/sales.invoice/${inv.id}/history`)).body.map((h) => h.action);
check(['einvoice', 'ewaybill', 'ewaybill_cancel', 'einvoice_cancel'].every((a) => hist.includes(a)), 'every step is in the history', hist);
check((await api('GET', '/audit/verify')).body.ok, 'audit chain intact');

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
