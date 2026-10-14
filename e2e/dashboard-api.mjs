// API checks for the home dashboard against a FRESH product DB with OSUITE_LICENSE=off.
// Usage: node e2e/dashboard-api.mjs   (assumes today is 2026-10-14 or later in FY 2026-27)
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
const due = async (id) => (await api('GET', `/records/sales.invoice/${id}`)).body.amountDue;


await api('POST', '/setup', { companyName: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', adminName: 'Admin', login: 'admin', password: 'admin1234' });
token = (await api('POST', '/auth/login', { login: 'admin', password: 'admin1234' })).body.token;
const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const month = today.slice(0, 7);
const lastMonth = new Date(`${month}-01T00:00:00Z`);
lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
const lastMonthDay1 = `${lastMonth.toISOString().slice(0, 7)}-01`;

let r = await api('GET', '/dashboard');
check(r.status === 200 && r.body.sales.month === '0.00' && r.body.trend.length === 12 && r.body.drafts.length === 0, 'empty dashboard works', r.body);

const svc = await create('base.product', { name: 'Consulting', kind: 'service', hsnCode: '9983', salePrice: '1000' });
const bolt = await create('base.product', { name: 'Steel bolt M8', kind: 'goods', hsnCode: '7318', reorderLevel: '5' });
await create('base.product', { name: 'Washer', kind: 'goods', hsnCode: '7318', reorderLevel: '0' });
await post('stock.adjustment', (await create('stock.adjustment', { reason: 'opening', lines: [{ productId: bolt.id, qty: '3', unitCost: '4' }] })).id);
const acme = await create('base.contact', { name: 'Acme Industries', stateCode: '27' });
const beta = await create('base.contact', { name: 'Beta Retail', stateCode: '27' });
const vendor = await create('base.contact', { name: 'Pune Suppliers', isVendor: true, stateCode: '27' });
const line = (rate) => ({ productId: svc.id, description: 'Consulting', qty: '1', unitPrice: rate, gstRate: '18' });

const inv1 = await post('sales.invoice', (await create('sales.invoice', { customerId: acme.id, placeOfSupply: '27', lines: [line('1000')] })).id);
const inv2 = await post('sales.invoice', (await create('sales.invoice', { customerId: acme.id, placeOfSupply: '27', date: lastMonthDay1, lines: [line('2000')] })).id);
await post('sales.credit_note', (await create('sales.credit_note', { invoiceId: inv1.id, customerId: acme.id, placeOfSupply: '27', reason: 'return', lines: [line('200')] })).id);
await post('purchase.bill', (await create('purchase.bill', { vendorId: vendor.id, vendorState: '27', vendorBillNo: 'PS-1', lines: [line('500')] })).id);
await post('account.payment', (await create('account.payment', { direction: 'inbound', partnerId: beta.id, amount: '1000', mode: 'bank' })).id);
await create('sales.invoice', { customerId: beta.id, placeOfSupply: '27', lines: [line('50')] }); // draft

r = await api('GET', '/dashboard');
const d = r.body;
check(d.sales.today === '800.00' && d.sales.month === '800.00', 'sales today and this month are net of the credit note', d.sales);
check(d.sales.lastMonthToDate === '2000.00' && d.sales.fy === '2800.00', 'last month to date and financial year', d.sales);
check(d.purchasesMonth === '500.00', 'purchases this month', d.purchasesMonth);
check(d.profitFy === '2300.00', 'profit for the year', d.profitFy);
check(d.cash.total === '1000.00' && d.cash.accounts.some((a) => a.balance === '1000.00'), 'cash and bank', d.cash);
check(d.receivable.total === '3304.00' && d.receivable.overdue === '2360.00' && d.receivable.advance === '1000.00', 'receivables, overdue and advances', d.receivable);
check(d.receivable.overdueInvoices.length === 1 && d.receivable.overdueInvoices[0].number === inv2.number && d.receivable.overdueInvoices[0].daysOverdue === Math.round((Date.parse(today) - Date.parse(lastMonthDay1)) / 86400000), 'most overdue invoice first', d.receivable.overdueInvoices);
check(d.payable.total === '590.00' && d.payable.overdue === '0.00', 'payables', d.payable);
check(d.gst.month === month && d.gst.output === '144.00' && d.gst.input === '90.00' && d.gst.net === '54.00', 'GST this month', d.gst);
check(d.trend.at(-1).month === month && d.trend.at(-1).sales === '800.00' && d.trend.at(-1).purchases === '500.00', 'trend: this month', d.trend.at(-1));
check(d.trend.at(-2).sales === '2000.00', 'trend: last month', d.trend.at(-2));
check(d.topCustomers.length === 1 && d.topCustomers[0].name === 'Acme Industries' && d.topCustomers[0].sales === '2800.00', 'top customers', d.topCustomers);
check(d.lowStock.length === 1 && d.lowStock[0].name === 'Steel bolt M8' && Number(d.lowStock[0].onHand) === 3, 'low stock: below reorder level only', d.lowStock);
check(d.drafts.length === 1 && d.drafts[0].model === 'sales.invoice' && d.drafts[0].count === 1, 'drafts waiting', d.drafts);

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
