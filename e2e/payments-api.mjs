// API checks for payments and ageing against a FRESH product DB with OSUITE_LICENSE=off.
// Usage: node e2e/payments-api.mjs
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
const act = (model, id, action) => api('POST', `/records/${model}/${id}/actions/${action}`);
const get = async (model, id) => (await api('GET', `/records/${model}/${id}`)).body;
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toLocaleDateString('en-CA');

await api('POST', '/setup', { companyName: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', adminName: 'Admin', login: 'admin', password: 'admin1234' });
token = (await api('POST', '/auth/login', { login: 'admin', password: 'admin1234' })).body.token;
const acme = (await api('POST', '/records/base.contact', { name: 'Acme Industries', stateCode: '27' })).body;
const kaveri = (await api('POST', '/records/base.contact', { name: 'Kaveri Agro Foods', stateCode: '27' })).body;
const vendor = (await api('POST', '/records/base.contact', { name: 'Pune Steel Suppliers', isVendor: true, isCustomer: false, stateCode: '27' })).body;
const svc = (await api('POST', '/records/base.product', { name: 'Consulting', kind: 'service', hsnCode: '9983', salePrice: '1000' })).body;
const line = (rate) => ({ productId: svc.id, description: 'Consulting', qty: '1', unitPrice: rate, gstRate: '18' });

const invoice = async (customer, rate, date, dueDate) => {
  const inv = (await api('POST', '/records/sales.invoice', { customerId: customer.id, placeOfSupply: '27', date, dueDate, lines: [line(rate)] })).body;
  return (await act('sales.invoice', inv.id, 'post')).body;
};
const i1 = await invoice(acme, '1000', daysAgo(75), daysAgo(45)); // 1180, 45 days overdue
const i2 = await invoice(acme, '2000', daysAgo(1)); // 2360, no due date -> due on the invoice date (1 day)
const i3 = await invoice(kaveri, '500', daysAgo(0)); // 590
check(i1.amountDue === '1180.00' && i1.amountPaid === '0.00' && i1.paymentState === 'unpaid', 'posted invoice is fully due', i1);

// Receipt allocated to the oldest dues.
let r = await api('POST', '/records/account.payment', { direction: 'inbound', partnerId: acme.id, amount: '2000', mode: 'upi', reference: 'UTR123' });
check(r.status === 201 && r.body.unallocatedAmount === '2000.00', 'receipt created unallocated', r.body);
const p1 = r.body;
r = await act('account.payment', p1.id, 'allocate');
check(
  r.body.lines.length === 2 && r.body.lines[0].invoiceId.id === i1.id && r.body.lines[0].amount === '1180.00' && r.body.lines[1].amount === '820.00' && r.body.unallocatedAmount === '0.00',
  'allocated oldest first: 1180 + 820',
  r.body,
);
r = await act('account.payment', p1.id, 'post');
check(r.body.state === 'posted' && /^RCPT\/\d{2}-\d{2}\/0001$/.test(r.body.number), 'receipt posted with its own series', r.body);
let a = await get('sales.invoice', i1.id);
let b = await get('sales.invoice', i2.id);
check(a.paymentState === 'paid' && a.amountDue === '0.00', 'oldest invoice paid', a);
check(b.paymentState === 'partial' && b.amountPaid === '820.00' && b.amountDue === '1540.00', 'next invoice partly paid', b);

// Guards.
r = await api('POST', '/records/account.payment', { direction: 'inbound', partnerId: acme.id, amount: '500', lines: [{ invoiceId: i1.id, amount: '500' }] });
r = await act('account.payment', r.body.id, 'post');
check(r.status === 422 && /only ₹0.00 due/.test(r.body.error), 'cannot pay more than is due', r.body);
r = await api('POST', '/records/account.payment', { direction: 'inbound', partnerId: acme.id, amount: '100', lines: [{ invoiceId: i3.id, amount: '100' }] });
r = await act('account.payment', r.body.id, 'post');
check(r.status === 422 && /different party/.test(r.body.error), "cannot settle another party's invoice", r.body);
r = await api('POST', '/records/account.payment', { direction: 'inbound', partnerId: acme.id, amount: '100', lines: [{ invoiceId: i2.id, amount: '150' }] });
check(r.status === 422 && r.body.fieldErrors?.amount, 'allocations cannot exceed the payment', r.body);
r = await api('POST', '/records/account.payment', { direction: 'outbound', partnerId: vendor.id, amount: '100', lines: [{ invoiceId: i2.id, amount: '50' }] });
check(r.status === 422 && r.body.fieldErrors?.['lines.0.billId'], 'vendor payment lines must point to bills', r.body);
r = await api('POST', '/records/account.payment', { direction: 'inbound', partnerId: acme.id, amount: '0' });
check(r.status === 422 && r.body.fieldErrors?.amount, 'zero payments rejected', r.body);
r = await act('sales.invoice', i2.id, 'cancel');
check(r.status === 409 && /Cancel those first/.test(r.body.error), 'an invoice with payments cannot be cancelled', r.body);

// Advance (unallocated) payment.
const adv = (await api('POST', '/records/account.payment', { direction: 'inbound', partnerId: kaveri.id, amount: '1000', mode: 'cash' })).body;
await act('account.payment', adv.id, 'post');

// Ageing.
let age = (await api('GET', '/reports/ageing?direction=inbound')).body;
const acmeRow = age.rows.find((x) => x.partnerId === acme.id);
const kavRow = age.rows.find((x) => x.partnerId === kaveri.id);
check(acmeRow.total === '1540.00' && acmeRow.d1_30 === '1540.00' && acmeRow.items.length === 1, 'receivables: Acme owes 1540 (1-30 days)', acmeRow);
check(kavRow.total === '590.00' && kavRow.advance === '1000.00' && kavRow.net === '-410.00', 'receivables: Kaveri owes 590 against a 1000 advance', kavRow);
check(age.totals.total === '2130.00' && age.totals.net === '1130.00', 'receivable totals', age.totals);

// Cancelling the receipt makes both invoices due again.
r = await act('account.payment', p1.id, 'cancel');
a = await get('sales.invoice', i1.id);
b = await get('sales.invoice', i2.id);
check(r.body.state === 'cancelled' && a.amountDue === '1180.00' && a.paymentState === 'unpaid' && b.amountDue === '2360.00', 'cancelled receipt restores the dues', [a.amountDue, b.amountDue]);
age = (await api('GET', '/reports/ageing?direction=inbound')).body;
const acmeAgain = age.rows.find((x) => x.partnerId === acme.id);
check(acmeAgain.d31_60 === '1180.00' && acmeAgain.d1_30 === '2360.00', 'overdue invoice lands in 31-60 days', acmeAgain);

// Vendor side.
const bill = (await api('POST', '/records/purchase.bill', { vendorId: vendor.id, vendorState: '27', vendorBillNo: 'PSS-9', lines: [line('3000')] })).body;
await act('purchase.bill', bill.id, 'post');
r = await api('POST', '/records/account.payment', { direction: 'outbound', partnerId: vendor.id, amount: '3540', mode: 'bank', reference: 'NEFT-778' });
await act('account.payment', r.body.id, 'allocate');
r = await act('account.payment', r.body.id, 'post');
check(/^PAY\/\d{2}-\d{2}\/0001$/.test(r.body.number), 'vendor payment posted as PAY/', r.body);
check((await get('purchase.bill', bill.id)).paymentState === 'paid', 'bill paid');
age = (await api('GET', '/reports/ageing?direction=outbound')).body;
check(age.rows.length === 0 && age.totals.total === '0.00', 'nothing payable after paying the bill', age);
r = await api('GET', '/records/account.payment?f.direction=outbound');
check(r.body.total === 1, 'payments filter by direction', r.body.total);
check((await api('GET', '/audit/verify')).body.ok, 'audit chain intact');

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
