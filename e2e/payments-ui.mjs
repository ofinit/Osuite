// Browser walkthrough of payments and receivables against a FRESH product DB,
// server run with OSUITE_LICENSE=off and OSUITE_WEB_DIST=apps/web/dist.
// Usage: node e2e/payments-ui.mjs <screenshot-dir>   (uses installed Microsoft Edge)
import { chromium } from 'playwright-core';

const OUT = process.argv[2];
const B = 'http://127.0.0.1:47800';
const api = async (method, path, body, token) => {
  const r = await fetch(`${B}/api${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return r.json();
};
const check = (cond, msg) => {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  console.log(`ok  ${msg}`);
};
const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toLocaleDateString('en-CA');

await api('POST', '/setup', { companyName: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', adminName: 'Priya Sharma', login: 'priya', password: 'priya12345' });
const { token } = await api('POST', '/auth/login', { login: 'priya', password: 'priya12345' });
const acme = await api('POST', '/records/base.contact', { name: 'Acme Industries', stateCode: '27' }, token);
const svc = await api('POST', '/records/base.product', { name: 'Consulting', kind: 'service', hsnCode: '9983', salePrice: '1000' }, token);
const mkInvoice = async (rate, date, dueDate) => {
  const inv = await api('POST', '/records/sales.invoice', { customerId: acme.id, placeOfSupply: '27', date, dueDate, lines: [{ productId: svc.id, description: 'Consulting', qty: '1', unitPrice: rate, gstRate: '18' }] }, token);
  return api('POST', `/records/sales.invoice/${inv.id}/actions/post`, undefined, token);
};
const inv1 = await mkInvoice('1000', daysAgo(1));
const inv2 = await mkInvoice('2000', daysAgo(70), daysAgo(40));

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

// Filtered menu entries: only the right one is highlighted.
await page.goto(`${B}/`);
await page.getByRole('navigation').getByRole('link', { name: 'Payments received' }).click();
await page.getByRole('heading', { name: 'Payments received' }).waitFor();
const active = await page.locator('nav a.font-medium').allInnerTexts();
check(active.length === 1 && active[0].trim() === 'Payments received', 'only "Payments received" is highlighted');

// Record payment straight from the invoice.
await page.goto(`${B}/m/sales.invoice?id=${inv1.id}`);
await page.locator('aside header').getByText('Unpaid', { exact: true }).waitFor();
await page.getByRole('link', { name: 'Record payment' }).click();
await page.getByRole('heading', { name: 'New payment' }).waitFor();
check((await page.locator('#f-direction').inputValue()) === 'inbound', 'payment starts as received from customer');
check((await page.getByRole('combobox', { name: 'Party' }).inputValue()) === 'Acme Industries', 'party prefilled from the invoice');
check((await page.locator('#f-amount').inputValue()) === '1180.00', 'amount prefilled with the balance due');
check((await page.getByRole('combobox', { name: 'Invoice, line 1' }).inputValue()) === inv1.number, 'allocation prefilled to the invoice');
check((await page.getByRole('columnheader', { name: 'Bill' }).count()) === 0, 'bill column hidden on receipts');
await page.locator('#f-mode').selectOption('upi');
await page.locator('#f-reference').fill('UTR4471002');
await page.keyboard.press('Control+s');
await page.getByText('Payment created').waitFor();
await page.getByRole('button', { name: 'Post payment' }).click();
await page.getByText('Payment posted').waitFor();
check(/^RCPT\//.test((await page.locator('aside h2').innerText()).trim()), 'receipt posted');
await page.screenshot({ path: `${OUT}/y01-receipt.png` });

await page.goto(`${B}/m/sales.invoice?id=${inv1.id}`);
await page.locator('aside').getByText('Paid', { exact: true }).first().waitFor();
check((await page.getByRole('link', { name: 'Record payment' }).count()) === 0, 'paid invoice shows Paid and no payment button');
await page.getByRole('button', { name: 'Close' }).click();
await page.getByRole('cell', { name: inv2.number }).waitFor();
const listBadges = await page.locator('tbody span.rounded').allInnerTexts();
check(listBadges.includes('Paid') && listBadges.includes('Unpaid'), 'invoice list shows payment status');

// Partial payment, then the print shows the balance.
const p2 = await api('POST', '/records/account.payment', { direction: 'inbound', partnerId: acme.id, amount: '1000', lines: [{ invoiceId: inv2.id, amount: '1000' }] }, token);
await api('POST', `/records/account.payment/${p2.id}/actions/post`, undefined, token);
await page.goto(`${B}/print/sales.invoice/${inv2.id}`);
await page.getByText('Balance due').waitFor();
check((await page.getByText('₹1,360.00').count()) === 1, 'print shows paid and balance due');

// Receivables report.
await page.goto(`${B}/reports/receivables`);
await page.getByRole('heading', { name: 'Receivables' }).waitFor();
await page.getByRole('button', { name: 'Acme Industries' }).click();
await page.getByRole('link', { name: inv2.number }).waitFor();
check((await page.getByText('40 days overdue').count()) === 1, 'receivables list the overdue invoice in its bucket');
await page.screenshot({ path: `${OUT}/y02-receivables.png` });

// Payments made starts as a vendor payment.
await page.goto(`${B}/`);
await page.getByRole('navigation').getByRole('link', { name: 'Payments made' }).click();
await page.getByRole('heading', { name: 'Payments made' }).waitFor();
await page.getByText('No payments yet').waitFor();
await page.keyboard.press('n');
await page.getByRole('heading', { name: 'New payment' }).waitFor();
check((await page.locator('#f-direction').inputValue()) === 'outbound', 'new payment from "Payments made" is a vendor payment');
await page.getByRole('button', { name: 'Add line' }).click();
check((await page.getByRole('columnheader', { name: 'Bill' }).count()) === 1 && (await page.getByRole('columnheader', { name: 'Invoice' }).count()) === 0, 'vendor payments allocate to bills');

console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
