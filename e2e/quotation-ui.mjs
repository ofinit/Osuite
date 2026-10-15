// Browser walkthrough of quotations against a FRESH product DB, server run with
// OSUITE_LICENSE=off and OSUITE_WEB_DIST=apps/web/dist.
// Usage: node e2e/quotation-ui.mjs <screenshot-dir>
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
const check = (cond, msg) => {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  console.log(`ok  ${msg}`);
};

await api('POST', '/setup', { companyName: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', adminName: 'Priya Sharma', login: 'priya', password: 'priya12345' });
({ token } = await api('POST', '/auth/login', { login: 'priya', password: 'priya12345' }));
await api('PUT', '/company', { name: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', upiId: 'ofindemo@okhdfc', bankAccountNumber: '50200012345678', bankIfsc: 'HDFC0000123', bankName: 'HDFC Bank' });
const bolt = await api('POST', '/records/base.product', { name: 'Steel bolt M8', kind: 'goods', hsnCode: '7318', salePrice: '9', gstRate: '18' });
const adj = await api('POST', '/records/stock.adjustment', { reason: 'opening', lines: [{ productId: bolt.id, qty: '1000', unitCost: '4' }] });
await api('POST', `/records/stock.adjustment/${adj.id}/actions/post`);
await api('POST', '/records/base.contact', { name: 'Acme Industries', stateCode: '27', gstin: '27AAPFU0939F1ZV' });

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

// Write a quotation from the Sales menu.
await page.goto(B);
await page.getByRole('navigation').getByRole('link', { name: 'Quotations' }).click();
await page.getByText('No quotations yet').waitFor();
await page.keyboard.press('n');
await page.getByRole('heading', { name: 'New quotation' }).waitFor();
await page.getByRole('combobox', { name: 'Customer' }).fill('acme');
await page.getByRole('option', { name: 'Acme Industries' }).click();
await page.getByRole('button', { name: 'Add line' }).click();
await page.getByRole('combobox', { name: 'Product, line 1' }).fill('bolt');
await page.getByRole('option', { name: /Steel bolt/ }).waitFor();
await page.keyboard.press('Enter');
await page.getByLabel('Qty, line 1').fill('500');
await page.getByText('₹5,310.00').waitFor();
await page.keyboard.press('Control+s');
await page.getByText('Quotation created').waitFor();
const id = Number(new URL(page.url()).searchParams.get('id'));
check(id > 0, 'quotation saved as a draft');

await page.getByRole('button', { name: 'Mark as sent' }).click();
await page.getByText('Quotation sent').waitFor();
const q = await api('GET', `/records/sales.quotation/${id}`);
check(/^QT\//.test(q.number) && q.validUntil, 'numbered on sending, with a validity date');
await page.screenshot({ path: `${OUT}/q01-quotation-sent.png` });

// Print as quotation and as proforma.
await page.goto(`${B}/print/sales.quotation/${id}`);
await page.getByText('Quotation', { exact: true }).waitFor();
check((await page.getByText('Valid until').count()) === 1 && (await page.getByText('This is not a tax invoice').count()) === 1, 'quotation print shows validity and is not a tax invoice');
check((await page.getByText('Scan to pay with UPI').count()) === 0, 'no payment QR on a quotation');
await page.screenshot({ path: `${OUT}/q02-quotation-print.png`, fullPage: true });
await page.goto(`${B}/print/sales.quotation/${id}?as=proforma`);
await page.getByText('Proforma Invoice', { exact: true }).waitFor();
await page.getByText('Scan to pay with UPI').waitFor();
check(true, 'proforma print carries bank details and a UPI QR for an advance');
await page.screenshot({ path: `${OUT}/q03-proforma-print.png`, fullPage: true });

// Convert: lands in the new draft invoice.
await page.goto(`${B}/m/sales.quotation?id=${id}`);
await page.getByRole('button', { name: 'Create invoice' }).click();
await page.waitForURL(/\/m\/sales\.invoice\?id=\d+/);
await page.getByRole('heading', { name: /invoice/i }).first().waitFor();
await page.getByText('₹5,310.00').first().waitFor();
check((await page.getByRole('button', { name: 'Post invoice' }).count()) === 1, 'draft invoice opened, ready to post');
await page.getByRole('button', { name: 'Post invoice' }).click();
await page.getByText('Invoice posted').waitFor();
await page.goto(`${B}/m/sales.quotation`);
await page.getByRole('cell', { name: 'Invoiced' }).waitFor();
check(true, 'quotation list shows it as invoiced');
await page.screenshot({ path: `${OUT}/q04-quotations.png` });

console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
