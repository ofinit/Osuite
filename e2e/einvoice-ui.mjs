// Browser walkthrough of e-invoicing with the simulator against a FRESH product
// DB, server run with OSUITE_LICENSE=off and OSUITE_WEB_DIST=apps/web/dist.
// Usage: node e2e/einvoice-ui.mjs <screenshot-dir>
import jsQR from 'jsqr';
import { chromium } from 'playwright-core';
import { PNG } from 'pngjs';

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
await api('PUT', '/company', { name: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', street: '14 MG Road', city: 'Pune', pincode: '411030' });
const bolt = await api('POST', '/records/base.product', { name: 'Steel bolt M8', kind: 'goods', hsnCode: '7318', salePrice: '9' });
const adj = await api('POST', '/records/stock.adjustment', { reason: 'opening', lines: [{ productId: bolt.id, qty: '10000', unitCost: '4' }] });
await api('POST', `/records/stock.adjustment/${adj.id}/actions/post`);
const kc = await api('POST', '/records/base.contact', { name: 'Karnataka Components Pvt Ltd', gstin: '29AABCT1332L1ZA', stateCode: '29', city: 'Bengaluru' });
const inv = await api('POST', '/records/sales.invoice', {
  customerId: kc.id,
  placeOfSupply: '29',
  lines: [{ productId: bolt.id, description: 'Steel bolt M8', hsnCode: '7318', qty: '1000', uom: 'NOS', unitPrice: '9', gstRate: '18' }],
});
await api('POST', `/records/sales.invoice/${inv.id}/actions/post`);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })).newPage();
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

// Turn it on.
await page.goto(B);
await page.getByRole('link', { name: 'E-invoicing' }).click();
await page.getByLabel('Generate e-invoices for B2B invoices and credit notes').check();
await page.getByText('The simulator works offline').waitFor();
await page.getByRole('button', { name: 'Save' }).click();
await page.getByText('E-invoicing settings saved.').waitFor();
check(true, 'e-invoicing turned on with the simulator');

// The invoice says what is missing; fix the customer's address.
await page.goto(`${B}/m/sales.invoice?id=${inv.id}`);
const panel = page.getByRole('region', { name: 'E-invoice' });
await panel.getByText('Fix these before generating:').waitFor();
check((await panel.getByText('The customer: a 6-digit PIN code is required.').count()) === 1, 'missing PIN code reported');
check(await panel.getByRole('button', { name: 'Generate e-invoice' }).isDisabled(), 'generate disabled until fixed');
await page.screenshot({ path: `${OUT}/e01-einvoice-problems.png` });
await api('PATCH', `/records/base.contact/${kc.id}`, { street: '5 Residency Road', pincode: '560025' });
await page.reload();
await panel.getByText('Ready: all details the portal checks are present.').waitFor();

// Generate the e-invoice, then the e-way bill.
await panel.getByRole('button', { name: 'Generate e-invoice' }).click();
await page.getByText('Simulated e-invoice generated').waitFor();
await panel.getByText('Simulated: not registered with the GST portal.', { exact: false }).waitFor();
const doc = await api('GET', `/records/sales.invoice/${inv.id}`);
check((await panel.getByText(doc.irn).count()) === 1, 'IRN shown on the invoice');
await panel.getByRole('button', { name: 'E-way bill' }).click();
await panel.getByLabel('Distance (km)').fill('840');
await panel.getByLabel('Vehicle number').fill('MH12AB1234');
await panel.getByRole('button', { name: 'Generate e-way bill' }).click();
await page.getByText(/E-way bill \d{12} generated/).waitFor();
check((await panel.getByText(/valid until/).count()) === 1, 'e-way bill shown with validity');
await page.screenshot({ path: `${OUT}/e02-einvoice-done.png` });

// The print carries the IRN and a QR code holding the signed payload.
await page.goto(`${B}/print/sales.invoice/${inv.id}`);
await page.getByText('SIMULATED E-INVOICE: not registered with the GST portal').waitFor();
await page.getByText(doc.irn).waitFor();
const img = page.getByAltText('E-invoice QR code signed by the IRP');
await img.waitFor();
const png = PNG.sync.read(await img.screenshot({ scale: 'device' }));
const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height)?.data;
check(decoded === doc.irnSignedQr, 'printed QR scans to the signed e-invoice data');
await page.screenshot({ path: `${OUT}/e03-einvoice-print.png`, fullPage: true });

console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
