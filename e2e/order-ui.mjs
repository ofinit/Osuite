// Browser walkthrough of sales orders, delivery challans and purchase orders
// against a FRESH product DB, server run with OSUITE_LICENSE=off and OSUITE_WEB_DIST=apps/web/dist.
// Usage: node e2e/order-ui.mjs <screenshot-dir>
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
const bolt = await api('POST', '/records/base.product', { name: 'Steel bolt M8', kind: 'goods', hsnCode: '7318', salePrice: '9', costPrice: '4', gstRate: '18' });
const adj = await api('POST', '/records/stock.adjustment', { reason: 'opening', lines: [{ productId: bolt.id, qty: '1000', unitCost: '4' }] });
await api('POST', `/records/stock.adjustment/${adj.id}/actions/post`);
const acme = await api('POST', '/records/base.contact', { name: 'Acme Industries', stateCode: '27', gstin: '27AAPFU0939F1ZV' });
const kcc = await api('POST', '/records/base.contact', { name: 'Kalyani Castings', stateCode: '29', isVendor: true });
const boltLine = (qty, unitPrice) => ({ productId: bolt.id, description: 'Steel bolt M8', hsnCode: '7318', qty, unitPrice, gstRate: '18' });
const so = await api('POST', '/records/sales.order', { customerId: acme.id, placeOfSupply: '27', reference: 'PO-4471', lines: [boltLine('200', '9')] });
const po = await api('POST', '/records/purchase.order', { vendorId: kcc.id, vendorState: '29', lines: [boltLine('500', '4')] });

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

// The Sales menu lists orders and challans.
await page.goto(B);
await page.getByRole('navigation').getByRole('link', { name: 'Sales orders' }).click();
await page.getByRole('cell', { name: 'Acme Industries' }).waitFor();
check((await page.getByRole('navigation').getByRole('link', { name: 'Delivery challans' }).count()) === 1, 'Sales menu has orders and delivery challans');

// Confirm, then deliver on a challan.
await page.goto(`${B}/m/sales.order?id=${so.id}`);
await page.getByRole('button', { name: 'Confirm order' }).click();
await page.getByText('Sales order confirmed').waitFor();
await page.screenshot({ path: `${OUT}/o01-order-confirmed.png` });
await page.getByRole('button', { name: 'Create delivery challan' }).click();
await page.waitForURL(/\/m\/sales\.delivery\?id=\d+/);
await page.getByRole('button', { name: 'Post challan' }).waitFor();
check(true, 'challan opened from the order');
await page.getByRole('button', { name: 'Post challan' }).click();
await page.getByText('Delivery challan posted').waitFor();
const dcId = Number(new URL(page.url()).searchParams.get('id'));
const dc = await api('GET', `/records/sales.delivery/${dcId}`);
check(/^DC\//.test(dc.number) && dc.lines[0].qty === '200.000', 'challan posted with all 200 bolts');
check((await page.getByRole('link', { name: 'Open order' }).count()) === 1, 'challan links back to its order');
await page.screenshot({ path: `${OUT}/o02-challan-posted.png` });

// The challan prints as a delivery challan, with the receiver's signature.
await page.goto(`${B}/print/sales.delivery/${dcId}`);
await page.getByText('Delivery Challan', { exact: true }).waitFor();
check((await page.getByText("Receiver's signature and date").count()) === 1 && (await page.getByText('Original for consignee').count()) === 1, 'challan print: consignee copy with receiver signature');
check((await page.getByText(so.number ?? (await api('GET', `/records/sales.order/${so.id}`)).number).count()) >= 1, 'and the order number');
await page.screenshot({ path: `${OUT}/o03-challan-print.png`, fullPage: true });

// Invoice the challan: the invoice opens, and posting it completes the order.
await page.goto(`${B}/m/sales.delivery?id=${dcId}`);
await page.getByRole('button', { name: 'Create invoice' }).click();
await page.waitForURL(/\/m\/sales\.invoice\?id=\d+/);
await page.getByRole('button', { name: 'Post invoice' }).click();
await page.getByText('Invoice posted').waitFor();
const stock = (await api('GET', `/records/stock.quant?f.productId=${bolt.id}`)).records[0];
check(stock.qty === '800.000', 'stock went down once (on the challan)');
await page.goto(`${B}/m/sales.order`);
await page.getByRole('cell', { name: 'Completed' }).waitFor();
check(true, 'order list shows it completed');
await page.screenshot({ path: `${OUT}/o04-orders.png` });

// Purchase order: confirm, print, receive.
await page.goto(`${B}/m/purchase.order?id=${po.id}`);
await page.getByRole('button', { name: 'Confirm order' }).click();
await page.getByText('Purchase order confirmed').waitFor();
await page.goto(`${B}/print/purchase.order/${po.id}`);
await page.getByText('Purchase Order', { exact: true }).waitFor();
check((await page.getByText('Kalyani Castings').count()) >= 1 && (await page.getByText('IGST').count()) >= 1, 'purchase order prints with the vendor and IGST (other state)');
await page.screenshot({ path: `${OUT}/o05-po-print.png`, fullPage: true });
await page.goto(`${B}/m/purchase.order?id=${po.id}`);
await page.getByRole('button', { name: 'Receive goods' }).click();
await page.waitForURL(/\/m\/purchase\.receipt\?id=\d+/);
await page.getByRole('button', { name: 'Post receipt' }).click();
await page.getByText('Goods receipt posted').waitFor();
const after = (await api('GET', `/records/stock.quant?f.productId=${bolt.id}`)).records[0];
check(after.qty === '1300.000', 'goods receipt brought 500 into stock');
await page.screenshot({ path: `${OUT}/o06-receipt-posted.png` });

console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
if (errors.length) process.exit(1);
