// Browser walkthrough of applying credit and year-end closing against a FRESH
// product DB, server run with OSUITE_LICENSE=off and OSUITE_WEB_DIST=apps/web/dist.
// Usage: node e2e/closing-ui.mjs <screenshot-dir>   (assumes FY 2025-26 has ended)
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
const post = (model, id) => api('POST', `/records/${model}/${id}/actions/post`);
const check = (cond, msg) => {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  console.log(`ok  ${msg}`);
};

await api('POST', '/setup', { companyName: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', adminName: 'Priya Sharma', login: 'priya', password: 'priya12345' });
({ token } = await api('POST', '/auth/login', { login: 'priya', password: 'priya12345' }));
const svc = await api('POST', '/records/base.product', { name: 'Consulting', kind: 'service', hsnCode: '9983', salePrice: '1000' });
const acme = await api('POST', '/records/base.contact', { name: 'Acme Industries', stateCode: '27' });
const line = (rate) => ({ productId: svc.id, description: 'Consulting', qty: '1', unitPrice: rate, gstRate: '18' });
const invoice = async (rate, date) => post('sales.invoice', (await api('POST', '/records/sales.invoice', { customerId: acme.id, placeOfSupply: '27', date, lines: [line(rate)] })).id);
await post('account.payment', (await api('POST', '/records/account.payment', { direction: 'inbound', partnerId: acme.id, amount: '3000', mode: 'bank' })).id);
const inv1 = await invoice('1000');
const inv2 = await invoice('1000');

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => void d.accept());
const onFailure = async (e) => {
  console.error(e.message);
  await page.screenshot({ path: `${OUT}/FAILED.png` }).catch(() => {});
  process.exit(1);
};
process.on('unhandledRejection', onFailure);
process.on('uncaughtException', onFailure);
await page.goto(B);
await page.evaluate((t) => localStorage.setItem('osuite.token', t), token);

// Apply credit from the invoice.
await page.goto(`${B}/m/sales.invoice?id=${inv1.id}`);
await page.getByRole('button', { name: 'Apply ₹1,180.00 credit' }).click();
await page.getByText('₹1,180.00 of credit applied').waitFor();
await page.locator('aside header').getByText('Paid', { exact: true }).waitFor();
check(true, 'invoice paid from the customer advance');

// Apply the rest from Receivables.
await page.goto(`${B}/reports/receivables`);
await page.getByRole('button', { name: 'Apply' }).click();
await page.getByText('₹1,180.00 of credit applied to the oldest dues.').waitFor();
check((await api('GET', `/records/sales.invoice/${inv2.id}`)).paymentState === 'paid', 'second invoice paid from the remaining advance');
await page.screenshot({ path: `${OUT}/c01-receivables.png` });

// Year-end closing.
await invoice('10000', '2026-03-15');
const draft = await api('POST', '/records/sales.invoice', { customerId: acme.id, placeOfSupply: '27', date: '2026-03-25', lines: [line('500')] });
await page.goto(`${B}/closing`);
await page.getByText('Still in draft: 1 draft invoices').waitFor();
check(await page.getByRole('button', { name: 'Close year' }).isDisabled(), 'closing is blocked by the draft');
await api('DELETE', `/records/sales.invoice/${draft.id}`);
await page.reload();
await page.getByRole('button', { name: 'Close year' }).click();
await page.getByText('moved to Reserves & surplus').waitFor();
await page.getByRole('button', { name: 'Reopen' }).waitFor();
check((await page.getByText('Closed', { exact: true }).count()) === 1 && (await page.getByRole('button', { name: 'Reopen' }).count()) === 1, 'year shows as closed with a Reopen option');
await page.screenshot({ path: `${OUT}/c02-closing.png` });

console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
