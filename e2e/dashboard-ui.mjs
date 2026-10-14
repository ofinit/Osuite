// Browser walkthrough of the home dashboard against a FRESH product DB, server
// run with OSUITE_LICENSE=off and OSUITE_WEB_DIST=apps/web/dist.
// Usage: node e2e/dashboard-ui.mjs <screenshot-dir>
import { chromium } from 'playwright-core';

const OUT = process.argv[2];
const B = 'http://127.0.0.1:47800';
let token;
const api = async (method, path, body) => {
  const r = await fetch(`${B}/api${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.status === 204 ? null : r.json();
};
const create = (model, values) => api('POST', `/records/${model}`, values);
const post = async (model, values) => api('POST', `/records/${model}/${(await create(model, values)).id}/actions/post`);
const check = (cond, msg) => {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  console.log(`ok  ${msg}`);
};

await api('POST', '/setup', { companyName: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', adminName: 'Priya Sharma', login: 'priya', password: 'priya12345' });
({ token } = await api('POST', '/auth/login', { login: 'priya', password: 'priya12345' }));
const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const lm = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
lm.setUTCMonth(lm.getUTCMonth() - 1);
const lastMonthDay1 = `${lm.toISOString().slice(0, 7)}-01`;

const svc = await create('base.product', { name: 'Consulting', kind: 'service', hsnCode: '9983', salePrice: '1000' });
const bolt = await create('base.product', { name: 'Steel bolt M8', kind: 'goods', hsnCode: '7318', reorderLevel: '5' });
await post('stock.adjustment', { reason: 'opening', lines: [{ productId: bolt.id, qty: '3', unitCost: '4' }] });
const acme = await create('base.contact', { name: 'Acme Industries', stateCode: '27' });
const beta = await create('base.contact', { name: 'Beta Retail', stateCode: '27' });
const vendor = await create('base.contact', { name: 'Pune Suppliers', isVendor: true, stateCode: '27' });
const line = (rate) => ({ productId: svc.id, description: 'Consulting', qty: '1', unitPrice: rate, gstRate: '18' });
const inv1 = await post('sales.invoice', { customerId: acme.id, placeOfSupply: '27', lines: [line('1000')] });
const inv2 = await post('sales.invoice', { customerId: acme.id, placeOfSupply: '27', date: lastMonthDay1, lines: [line('2000')] });
await post('sales.credit_note', { invoiceId: inv1.id, customerId: acme.id, placeOfSupply: '27', reason: 'return', lines: [line('200')] });
await post('purchase.bill', { vendorId: vendor.id, vendorState: '27', vendorBillNo: 'PS-1', lines: [line('500')] });
await post('account.payment', { direction: 'inbound', partnerId: beta.id, amount: '1000', mode: 'bank' });
await create('sales.invoice', { customerId: beta.id, placeOfSupply: '27', lines: [line('50')] });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const onFailure = async (e) => {
  console.error(e.message);
  await page.screenshot({ path: `${OUT}/FAILED.png` }).catch(() => {});
  process.exit(1);
};
process.on('unhandledRejection', onFailure);
process.on('uncaughtException', onFailure);
await page.goto(B);
await page.evaluate((t) => localStorage.setItem('osuite.token', t), token);
await page.goto(B);

const kpis = page.getByRole('region', { name: 'Key figures' });
await kpis.getByText('Sales this month').waitFor();
check((await kpis.getByText('₹800', { exact: true }).count()) === 1, 'sales this month ₹800');
check((await kpis.getByText('₹2,360 overdue').count()) === 1, 'receivables show the overdue amount');
check((await kpis.getByText('₹1,000', { exact: true }).count()) === 1, 'cash and bank ₹1,000');
check((await kpis.getByText('₹54', { exact: true }).count()) === 1, 'GST payable ₹54');
check((await kpis.getByText('₹2,300', { exact: true }).count()) === 1, 'profit for the year ₹2,300');
check((await page.getByRole('img', { name: 'Monthly sales and purchases' }).count()) === 1, 'trend chart drawn');
check((await page.getByText('Steel bolt M8').count()) === 1, 'low stock listed');
await page.screenshot({ path: `${OUT}/d01-dashboard.png`, fullPage: true });

// Panels lead somewhere useful.
await page.getByRole('link', { name: new RegExp(inv2.number.replaceAll('/', '\/')) }).click();
await page.waitForURL(`**/m/sales.invoice?id=${inv2.id}`);
check(true, 'overdue invoice opens');
await page.goto(B);
await page.getByRole('region', { name: 'Key figures' }).waitFor();
await page.locator('section', { hasText: 'Top customers' }).getByRole('link', { name: /Acme Industries/ }).click();
await page.getByRole('heading', { name: 'Statement: Acme Industries' }).waitFor();
check(true, 'top customer opens their statement');
await page.goto(B);
await page.locator('section', { hasText: 'Drafts to finish' }).getByRole('link', { name: /Invoices/ }).click();
await page.waitForURL('**/m/sales.invoice?f.state=draft');
await page.getByRole('cell', { name: 'Beta Retail' }).waitFor();
check((await page.getByRole('cell', { name: 'Acme Industries' }).count()) === 0, 'drafts link lists only drafts');
await page.goto(B);
await page.getByRole('link', { name: 'New invoice' }).click();
await page.waitForURL('**/m/sales.invoice?id=new');
check(true, 'New invoice quick action');

console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
