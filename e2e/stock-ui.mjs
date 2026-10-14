// Browser walkthrough of inventory against a FRESH product DB, server run with
// OSUITE_LICENSE=off and OSUITE_WEB_DIST=apps/web/dist.
// Usage: node e2e/stock-ui.mjs <screenshot-dir>   (uses installed Microsoft Edge)
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
await api('POST', '/records/base.contact', { name: 'Acme Industries', stateCode: '27' }, token);
await api('POST', '/records/base.product', { name: 'Steel bolt M8 × 40', hsnCode: '7318', salePrice: '9', costPrice: '4.20', kind: 'goods' }, token);

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

// Opening stock through an adjustment.
await page.goto(`${B}/m/stock.adjustment`);
await page.getByText('No stock adjustments yet').waitFor();
await page.keyboard.press('n');
await page.getByRole('heading', { name: 'New stock adjustment' }).waitFor();
await page.getByLabel('Reason').selectOption('opening');
await page.getByRole('button', { name: 'Add line' }).click();
await page.getByRole('combobox', { name: 'Product, line 1' }).fill('bolt');
await page.getByRole('option', { name: /Steel bolt/ }).click();
await page.waitForFunction(() => document.querySelector('[aria-label="Unit cost, line 1"]')?.value === '4.20');
check(true, 'product fills its cost price');
await page.getByLabel('Qty change (+/−), line 1').fill('100');
await page.keyboard.press('Control+s');
await page.getByText('Stock adjustment created').waitFor();
await page.getByRole('button', { name: 'Post adjustment' }).click();
await page.getByText('Stock adjustment posted').waitFor();
check(/^ADJ\//.test((await page.locator('aside h2').innerText()).trim()), 'adjustment posted');

// Stock on hand is a read-only report.
await page.goto(`${B}/m/stock.quant`);
await page.getByRole('cell', { name: 'Steel bolt M8 × 40' }).waitFor();
check((await page.getByRole('cell', { name: '420.00' }).count()) === 1, 'stock on hand shows value 420.00');
check((await page.getByRole('button', { name: /New/ }).count()) === 0, 'no New button on stock on hand');
await page.getByRole('cell', { name: 'Steel bolt M8 × 40' }).click();
await page.locator('aside').getByText('Average cost').waitFor();
check((await page.locator('aside h2').innerText()).trim() === 'Steel bolt M8 × 40', 'stock record is titled by its product');
check((await page.locator('aside input, aside button.btn-primary').count()) === 0, 'stock record opens read-only');
await page.screenshot({ path: `${OUT}/s01-stock-on-hand.png` });

// Selling more than we have is explained, not silently allowed.
await page.goto(`${B}/m/sales.invoice?id=new`);
await page.getByRole('combobox', { name: 'Customer', exact: true }).fill('acme');
await page.getByRole('option', { name: 'Acme Industries' }).click();
await page.waitForFunction(() => document.querySelector('#f-placeOfSupply')?.value === '27');
await page.getByRole('button', { name: 'Add line' }).click();
await page.getByRole('combobox', { name: 'Product, line 1' }).fill('bolt');
await page.getByRole('option', { name: /Steel bolt/ }).click();
await page.waitForFunction(() => document.querySelector('[aria-label="Rate, line 1"]')?.value === '9.00');
await page.getByLabel('Qty, line 1').fill('150');
await page.keyboard.press('Control+s');
await page.getByText('Invoice created').waitFor();
await page.getByRole('button', { name: 'Post invoice' }).click();
await page.getByText(/Not enough stock\. Steel bolt M8 × 40: need 150, have 100 in Main warehouse/).waitFor();
check((await page.getByText('Draft', { exact: true }).count()) >= 1, 'shortage shown and the invoice stays a draft');
await page.screenshot({ path: `${OUT}/s02-shortage.png` });

// The company can allow selling into negative stock.
await page.goto(`${B}/settings/company`);
await page.getByLabel(/Allow sales when stock is short/).check();
await page.getByRole('button', { name: 'Save details' }).click();
await page.getByText('Saved', { exact: true }).waitFor();
await page.goto(`${B}/m/sales.invoice`);
await page.getByRole('cell', { name: 'Acme Industries' }).click();
await page.getByRole('button', { name: 'Post invoice' }).click();
await page.getByText('Invoice posted').waitFor();
check(true, 'with the setting on, the invoice posts');

// Ledger shows both movements with running balances.
await page.goto(`${B}/m/stock.move`);
await page.getByRole('cell', { name: 'Opening stock' }).waitFor();
check((await page.getByRole('cell', { name: 'Sale' }).count()) === 1 && (await page.getByRole('cell', { name: '-50' }).count()) === 1, 'ledger shows the sale and the running balance');
await page.screenshot({ path: `${OUT}/s03-stock-ledger.png` });

// Palette never offers to create document lines or ledger rows.
await page.keyboard.press('Control+k');
await page.keyboard.type('new');
await page.getByText('New invoice', { exact: true }).waitFor();
check((await page.getByText('New invoice line').count()) === 0 && (await page.getByText('New stock movement').count()) === 0, 'palette only offers real documents');

console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
