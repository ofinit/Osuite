// Browser walkthrough of company settings, the invoice print with payment
// details, and purchase bills. FRESH product DB, server run with
// OSUITE_LICENSE=off and OSUITE_WEB_DIST=apps/web/dist.
// Usage: node e2e/purchase-ui.mjs <screenshot-dir>   (uses installed Microsoft Edge)
import jsQR from 'jsqr';
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';

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
await api('POST', '/records/base.contact', { name: 'Acme Industries', stateCode: '27', city: 'Pune' }, token);
await api('POST', '/records/base.contact', { name: 'Karnataka Copper Co', isVendor: true, isCustomer: false, stateCode: '29' }, token);
const wire = await api('POST', '/records/base.product', { name: 'Copper wire 2.5 mm (90 m)', hsnCode: '8544', salePrice: '2450', costPrice: '1980', gstRate: '18' }, token);
const opening = await api('POST', '/records/stock.adjustment', { reason: 'opening', lines: [{ productId: wire.id, qty: '10', unitCost: '1980' }] }, token);
await api('POST', `/records/stock.adjustment/${opening.id}/actions/post`, undefined, token);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
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

// A small PNG logo, rendered by the browser itself.
await page.setContent('<div id="l" style="width:160px;height:48px;background:#23408e;color:#fff;font:bold 22px sans-serif;display:grid;place-items:center">OFIN</div>');
const logo = await page.locator('#l').screenshot({ type: 'png' });

// Company settings.
await page.goto(`${B}/settings/company`);
await page.getByLabel('Street', { exact: true }).fill('21 Laxmi Road');
await page.getByLabel('City').fill('Pune');
await page.getByLabel('PIN code').fill('411030');
await page.getByLabel('Phone').fill('020 2445 6677');
await page.getByLabel('Email').fill('accounts@ofindemo.in');
await page.getByLabel('Account number').fill('50200012345678');
await page.getByLabel('IFSC').fill('HDFC123');
await page.getByLabel('Bank', { exact: true }).fill('HDFC Bank');
await page.getByLabel('UPI ID').fill('ofindemo@okhdfc');
await page.getByLabel('Invoice terms').fill('Goods once sold will not be taken back.\nInterest @18% p.a. on overdue amounts.');
await page.locator('input[type=file]').setInputFiles({ name: 'logo.png', mimeType: 'image/png', buffer: logo });
await page.getByAltText('Company logo').waitFor();
await page.getByRole('button', { name: 'Save details' }).click();
await page.getByText('Invalid IFSC').waitFor();
check(true, 'invalid IFSC is flagged on its field');
await page.getByLabel('IFSC').fill('hdfc0000123');
await page.getByRole('button', { name: 'Save details' }).click();
await page.getByText('Saved', { exact: true }).waitFor();
check((await page.getByLabel('IFSC').inputValue()) === 'HDFC0000123', 'company details saved (IFSC normalised)');
await page.screenshot({ path: `${OUT}/p01-company.png`, fullPage: true });

// Invoice print carries address, bank details, UPI QR and terms.
const inv = await api('POST', '/records/sales.invoice', { customerId: 1, placeOfSupply: '27', lines: [{ productId: 1, description: 'Copper wire 2.5 mm (90 m)', hsnCode: '8544', qty: '2', unitPrice: '2450', gstRate: '18' }] }, token);
await api('POST', `/records/sales.invoice/${inv.id}/actions/post`, undefined, token);
await page.goto(`${B}/print/sales.invoice/${inv.id}`);
await page.getByText('Tax Invoice', { exact: true }).waitFor();
await page.getByAltText(/UPI QR code/).waitFor();
check((await page.getByText('21 Laxmi Road').count()) === 1 && (await page.getByText('Pune 411030, Maharashtra').count()) === 1, 'print shows the supplier address');
check((await page.getByText('HDFC0000123').count()) === 1 && (await page.getByText('Scan to pay with UPI').count()) === 1, 'print shows bank details and a UPI QR');
check((await page.getByText('Goods once sold will not be taken back.', { exact: false }).count()) === 1, 'print shows company terms');
const png = PNG.sync.read(await page.getByAltText(/UPI QR code/).screenshot({ scale: 'device' }));
const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data;
check(
  decoded === `upi://pay?pa=ofindemo@okhdfc&pn=Ofin%20Demo%20Traders&am=5782.00&cu=INR&tn=Invoice%20${encodeURIComponent((await page.getByText(/^INV\//).first().innerText()).trim())}`,
  `UPI QR scans to the payment link (${decoded})`,
);
await page.screenshot({ path: `${OUT}/p02-invoice-print.png`, fullPage: true });

// Purchase bill: vendor-only picker, cost price, IGST from another state.
await page.goto(`${B}/m/purchase.bill?id=new`);
await page.getByRole('combobox', { name: 'Vendor', exact: true }).click();
await page.getByRole('option', { name: 'Karnataka Copper Co' }).waitFor();
check((await page.getByRole('option', { name: 'Acme Industries' }).count()) === 0, 'vendor picker hides customers');
await page.getByRole('option', { name: 'Karnataka Copper Co' }).click();
await page.waitForFunction(() => document.querySelector('#f-vendorState')?.value === '29');
await page.getByLabel('Vendor bill no.').fill('KCC/2026/118');
await page.getByRole('button', { name: 'Add line' }).click();
await page.getByRole('combobox', { name: 'Product, line 1' }).fill('copper');
await page.getByRole('option', { name: /Copper wire/ }).click();
await page.waitForFunction(() => document.querySelector('[aria-label="Rate, line 1"]')?.value === '1980.00');
check(true, "bill line takes the product's cost price");
await page.getByLabel('Qty, line 1').fill('10');
await page.getByText('Inter-state supply').waitFor();
await page.getByText('₹23,364.00').waitFor(); // 19,800 + 18% IGST 3,564
check(true, 'vendor in another state gives IGST live');
await page.keyboard.press('Control+s');
await page.getByText('Bill created').waitFor();
await page.getByRole('button', { name: 'Post bill' }).click();
await page.getByText('Bill posted').waitFor();
check(/^BILL\/\d{2}-\d{2}\/0001$/.test((await page.locator('aside h2').innerText()).trim()), 'bill posted with its own number');
await page.screenshot({ path: `${OUT}/p03-bill.png` });

console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
