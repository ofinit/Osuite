// API checks for quotations against a FRESH product DB with OSUITE_LICENSE=off.
// Usage: node e2e/quotation-api.mjs
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
const get = async (model, id) => (await api('GET', `/records/${model}/${id}`)).body;

await api('POST', '/setup', { companyName: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', adminName: 'Admin', login: 'admin', password: 'admin1234' });
token = (await api('POST', '/auth/login', { login: 'admin', password: 'admin1234' })).body.token;
const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const plus = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const svc = await create('base.product', { name: 'Consulting', kind: 'service', hsnCode: '9983', salePrice: '1000' });
const acme = await create('base.contact', { name: 'Acme Industries', stateCode: '27' });
const line = (qty = '1') => ({ productId: svc.id, description: 'Consulting', hsnCode: '9983', qty, unitPrice: '1000', gstRate: '18' });
const tbBefore = (await api('GET', '/reports/trial-balance')).body.totalDebit;

// ---------------------------------------------------------------- drafting and sending
let q = await create('sales.quotation', { customerId: acme.id, placeOfSupply: '27', lines: [line()] });
check(q.state === 'draft' && q.number === null && q.totalAmount === '1180.00' && q.cgstAmount === '90.00', 'draft quotation priced with GST', q);
check(q.validUntil === plus(q.date, 15), 'valid for 15 days by default', q.validUntil);
const empty = await create('sales.quotation', { customerId: acme.id, placeOfSupply: '27' });
check((await act('sales.quotation', empty.id, 'send')).status === 422, 'cannot send a quotation without items');
let r = await api('POST', '/records/sales.quotation', { customerId: acme.id, placeOfSupply: '27', date: today, validUntil: plus(today, -1) });
check(r.status === 422 && r.body.fieldErrors.validUntil, 'valid-until before the date is refused', r.body);

r = await act('sales.quotation', q.id, 'send');
check(r.status === 200 && r.body.state === 'sent' && /^QT\/\d\d-\d\d\/0001$/.test(r.body.number), 'sent quotation numbered', r.body);
const number = r.body.number;
r = await api('PATCH', `/records/sales.quotation/${q.id}`, { reference: 'changed' });
check(r.status >= 400 && r.status < 500, 'sent quotation is locked', r.body);

// ---------------------------------------------------------------- revising
r = await act('sales.quotation', q.id, 'revise');
check(r.body.state === 'draft' && r.body.number === number, 'revise reopens it with the same number', r.body);
q = await get('sales.quotation', q.id);
r = await api('PATCH', `/records/sales.quotation/${q.id}`, { lines: [{ id: q.lines[0].id, ...line('2') }] });
check(r.status === 200 && r.body.totalAmount === '2360.00', 'revised quantity reprices it', r.body);
r = await act('sales.quotation', q.id, 'send');
check(r.body.number === number, 'resending keeps the number', r.body.number);

// ---------------------------------------------------------------- converting
check((await act('sales.quotation', q.id, 'accept')).body.state === 'accepted', 'customer accepted');
r = await act('sales.quotation', q.id, 'toInvoice');
check(r.status === 200 && r.body.state === 'invoiced' && r.body.invoiceId, 'converted to an invoice', r.body);
let inv = await get('sales.invoice', r.body.invoiceId.id);
check(inv.state === 'draft' && inv.date === today && inv.totalAmount === '2360.00' && inv.cgstAmount === '180.00' && inv.amountDue === '2360.00', 'draft invoice carries the totals', inv);
check(inv.lines.length === 1 && inv.lines[0].qty === '2.000' && inv.reference === `Quotation ${number}`, 'and the items and a reference to the quotation', inv);
check((await api('GET', '/reports/trial-balance')).body.totalDebit === tbBefore, 'quotations never touch the books');
check((await act('sales.quotation', q.id, 'toInvoice')).status >= 400, 'cannot invoice twice');

// Deleting the draft invoice puts the quotation back.
r = await api('DELETE', `/records/sales.invoice/${inv.id}`);
check(r.status === 204, 'draft invoice deleted', r.body);
q = await get('sales.quotation', q.id);
check(q.state === 'accepted' && q.invoiceId === null, 'quotation back to accepted', q);
r = await act('sales.quotation', q.id, 'toInvoice');
inv = await get('sales.invoice', r.body.invoiceId.id);
r = await act('sales.invoice', inv.id, 'post');
check(r.status === 200 && /^INV\//.test(r.body.number), 'the new invoice posts normally', r.body);

// ---------------------------------------------------------------- expiry and declining
const old = await create('sales.quotation', { customerId: acme.id, placeOfSupply: '27', date: plus(today, -30), lines: [line()] });
await act('sales.quotation', old.id, 'send');
r = await act('sales.quotation', old.id, 'toInvoice');
check(r.status === 422 && /expired/.test(r.body.error), 'expired quotation needs acceptance first', r.body);
await act('sales.quotation', old.id, 'accept');
check((await act('sales.quotation', old.id, 'toInvoice')).body.state === 'invoiced', 'accepted expired quotation converts');

const lost = await create('sales.quotation', { customerId: acme.id, placeOfSupply: '27', lines: [line()] });
await act('sales.quotation', lost.id, 'send');
check((await act('sales.quotation', lost.id, 'decline')).body.state === 'declined', 'declined');
check((await act('sales.quotation', lost.id, 'toInvoice')).status >= 400, 'declined quotation cannot be invoiced');
check((await act('sales.quotation', lost.id, 'send')).status >= 400, 'or resent without revising');
check((await api('GET', '/audit/verify')).body.ok, 'audit chain intact');
const hist = (await api('GET', `/records/sales.invoice/${inv.id}/history`)).body;
check(Array.isArray(hist) && hist.some((h) => h.changes?.quotationId?.to === number), 'invoice history shows its quotation', hist);

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
