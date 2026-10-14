// Browser walkthrough of the ledger, party statement and day book against a FRESH
// product DB, server run with OSUITE_LICENSE=off and OSUITE_WEB_DIST=apps/web/dist.
// Usage: node e2e/ledger-ui.mjs <screenshot-dir>
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

await invoice('10000', '2026-03-15'); // 11,800 in the previous year
await post('account.payment', (await api('POST', '/records/account.payment', { direction: 'inbound', partnerId: acme.id, amount: '3000', mode: 'bank' })).id);
const inv1 = await invoice('1000'); // 1,180
await invoice('2000'); // 2,360

// Trial balance drills into the ledger.
await page.goto(`${B}/reports/trial-balance`);
await page.getByRole('link', { name: /Sundry debtors/ }).click();
await page.getByRole('heading', { name: 'Sundry debtors' }).waitFor();
check((await page.getByText('11,800.00 Dr').count()) >= 1 && (await page.getByText('12,340.00 Dr').count()) >= 1, 'debtors ledger shows opening and closing');
await page.getByRole('link', { name: inv1.number }).click();
await page.waitForURL(`**/m/sales.invoice?id=${inv1.id}`);
check(true, 'ledger voucher opens its invoice');

// Party statement from the contact.
await page.goto(`${B}/m/base.contact?id=${acme.id}`);
await page.getByRole('link', { name: 'Statement' }).click();
await page.getByRole('heading', { name: 'Statement: Acme Industries' }).waitFor();
check((await page.locator('tbody tr').count()) === 4, 'statement lists opening and three items');
check((await page.getByText('Payment received').count()) === 1 && (await page.getByText('Sales invoice').count()) === 2, 'statement names document kinds, not ledgers');
await page.screenshot({ path: `${OUT}/l01-statement.png` });
await page.getByRole('link', { name: 'Print statement' }).click();
await page.getByText('Statement of account').waitFor();
await page.getByText('Balance due to Ofin Demo Traders: ₹12,340.00').waitFor();
check(true, 'printable statement shows the balance due');
await page.screenshot({ path: `${OUT}/l02-statement-print.png`, fullPage: true });

// Day book for today.
await page.goto(`${B}/reports/day-book`);
await page.getByText('3 entries').waitFor();
check((await page.getByRole('link', { name: inv1.number }).count()) === 1, 'day book lists today’s entries');
await page.screenshot({ path: `${OUT}/l03-day-book.png` });

// Picking an account in the ledger.
await page.goto(`${B}/reports/ledger`);
await page.getByText('Choose an account').waitFor();
await page.getByLabel('Account').fill('Sales');
await page.getByRole('option', { name: /^Sales/ }).first().click();
await page.getByRole('heading', { name: 'Sales', exact: true }).waitFor();
check((await page.getByText('13,000.00 Cr').count()) >= 1, 'sales ledger picked from the account box');

console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
