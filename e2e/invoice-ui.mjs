// Browser walkthrough of GST invoicing against a FRESH product DB, server run
// with OSUITE_LICENSE=off and OSUITE_WEB_DIST=apps/web/dist.
// Usage: node e2e/invoice-ui.mjs <screenshot-dir>   (uses installed Microsoft Edge)
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

await api('POST', '/setup', { companyName: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', adminName: 'Priya Sharma', login: 'priya', password: 'priya12345' });
const { token } = await api('POST', '/auth/login', { login: 'priya', password: 'priya12345' });
await api('POST', '/records/base.contact', { name: 'Acme Industries', stateCode: '27', gstin: '27AAPFU0939F1ZV', street: '14 MIDC Road', city: 'Pune', pincode: '411019' }, token);
await api('POST', '/records/base.contact', { name: 'Kaveri Agro Foods', stateCode: '29', city: 'Mysuru' }, token);
const bolt = await api('POST', '/records/base.product', { name: 'Steel bolt M8 × 40', sku: 'BLT-M8', hsnCode: '7318', salePrice: '4.50', gstRate: '18' }, token);
const opening = await api('POST', '/records/stock.adjustment', { reason: 'opening', lines: [{ productId: bolt.id, qty: '1000', unitCost: '3' }] }, token);
await api('POST', `/records/stock.adjustment/${opening.id}/actions/post`, undefined, token);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => void d.accept());
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
const onFailure = async (e) => {
  console.error(e.message);
  await page.screenshot({ path: `${OUT}/FAILED.png` }).catch(() => {});
  process.exit(1);
};
process.on('unhandledRejection', onFailure);
process.on('uncaughtException', onFailure);

await page.goto(B);
await page.evaluate((t) => localStorage.setItem('osuite.token', t), token);
await page.goto(`${B}/m/sales.invoice`);
await page.getByText('No invoices yet').waitFor();
await page.keyboard.press('n');
await page.getByRole('heading', { name: 'New invoice' }).waitFor();

// Customer fills place of supply and GSTIN.
await page.getByRole('combobox', { name: 'Customer' }).fill('acme');
await page.getByRole('option', { name: 'Acme Industries' }).click();
await page.waitForFunction(() => document.querySelector('#f-placeOfSupply')?.value === '27');
check((await page.locator('#f-customerGstin').inputValue()) === '27AAPFU0939F1ZV', 'customer fills GSTIN and place of supply');

// Line 1 from a product; line 2 typed; keyboard moves between rows.
await page.getByRole('button', { name: 'Add line' }).click();
await page.getByRole('combobox', { name: 'Product, line 1' }).fill('bolt');
await page.getByRole('option', { name: /Steel bolt/ }).waitFor();
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.querySelector('[aria-label="Description, line 1"]')?.value?.startsWith('Steel bolt'));
check((await page.getByLabel('HSN/SAC, line 1').inputValue()) === '7318', 'product fills description, HSN and rate');
await page.getByLabel('Qty, line 1').fill('100');
await page.keyboard.press('Enter'); // adds line 2, same column
await page.getByLabel('Qty, line 2').waitFor();
check(await page.getByLabel('Qty, line 2').evaluate((el) => el === document.activeElement), 'Enter on the last row adds a line and keeps the column');
await page.getByLabel('Description, line 2').fill('Installation and testing');
await page.getByLabel('HSN/SAC, line 2').fill('9987');
await page.getByLabel('Rate, line 2').fill('1500');
await page.getByLabel('Disc %, line 2').fill('10');
// 450 + 1350 = 1800 taxable; 18% -> 162 + 162; total 2124
await page.getByText('₹2,124.00').waitFor();
check((await page.getByText('Intra-state supply').count()) === 1, 'live totals show CGST + SGST');
await shot('i01-draft-invoice');

await page.keyboard.press('Control+s');
await page.getByText('Invoice created').waitFor();
await page.getByRole('button', { name: 'Post invoice' }).click();
await page.getByText('Invoice posted').waitFor();
const number = (await page.locator('aside h2').innerText()).trim();
check(/^INV\/\d{2}-\d{2}\/0001$/.test(number), `posted as ${number}`);
check(
  (await page.locator('aside form input, aside form select, aside form textarea').count()) === 0 &&
    (await page.getByRole('button', { name: 'Add line' }).count()) === 0 &&
    (await page.getByRole('cell', { name: 'Numbers' }).count()) === 2,
  'posted invoice reads as text, not inputs',
);
await shot('i02-posted-invoice');

await page.getByRole('link', { name: 'Print' }).evaluate((a) => a.removeAttribute('target'));
await page.getByRole('link', { name: 'Print' }).click();
await page.getByText('Tax Invoice', { exact: true }).waitFor();
check((await page.getByText('Rupees Two Thousand One Hundred Twenty Four Only').count()) === 1, 'print shows amount in words');
check((await page.getByText('7318 @ 18%').count()) === 1, 'print has HSN-wise tax summary');
await page.screenshot({ path: `${OUT}/i03-print.png`, fullPage: true });

// Inter-state invoice.
await page.goto(`${B}/m/sales.invoice?id=new`);
await page.getByRole('combobox', { name: 'Customer' }).fill('kaveri');
await page.getByRole('option', { name: 'Kaveri Agro Foods' }).click();
await page.waitForFunction(() => document.querySelector('#f-placeOfSupply')?.value === '29');
await page.getByRole('button', { name: 'Add line' }).click();
await page.getByLabel('Description, line 1').fill('Consulting');
await page.getByLabel('Rate, line 1').fill('10000');
await page.getByText('Inter-state supply').waitFor();
await page.getByText('₹11,800.00').waitFor();
check(true, 'inter-state invoice shows IGST live');
await page.keyboard.press('Control+s');
await page.getByText('Invoice created').waitFor();
await page.getByRole('button', { name: 'Close' }).click();
await page.getByRole('cell', { name: 'Kaveri Agro Foods' }).waitFor(); // list refetched after the save
const badges = page.locator('tbody span.rounded');
check((await badges.allInnerTexts()).sort().join() === 'Draft,Posted,Unpaid', 'list shows status and payment badges (none on drafts)');
await shot('i04-invoice-list');

console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
