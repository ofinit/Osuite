// Captures the product screenshots used on the marketing website from the real
// app, against a FRESH product DB filled with a fictitious demo company.
// Run through the e2e runner, which starts the server and resets the DB:
//   node scripts/run-e2e.mjs .data/e2e-shots capture-screens
// Output: apps/site/src/assets/screens/*.png (2x). Re-run before each release so
// the website always shows the shipping product.
import { copyFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';
import { isValidGstin } from '../packages/kernel/src/india.ts';

const OUT = resolve(import.meta.dirname, '../apps/site/src/assets/screens');
mkdirSync(OUT, { recursive: true });
const B = 'http://127.0.0.1:47800';
let token;
async function api(method, path, body) {
  const r = await fetch(`${B}/api${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  const data = t ? JSON.parse(t) : null;
  if (r.status >= 400) throw new Error(`${method} ${path}: ${t}`);
  return data;
}
const create = (model, values) => api('POST', `/records/${model}`, values);
const act = (model, id, action) => api('POST', `/records/${model}/${id}/actions/${action}`);
const post = async (model, values) => act(model, (await create(model, values)).id, 'post');

const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const daysAgo = (n) => new Date(Date.parse(`${today}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
// A fixed seed so every capture shows the same company.
let seed = 7;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const pick = (a) => a[Math.floor(rand() * a.length)];

// ---------------------------------------------------------------- the demo company
await api('POST', '/setup', {
  companyName: 'Shree Ganesh Industrial Supplies',
  gstin: '27AAPFU0939F1ZV',
  stateCode: '27',
  adminName: 'Priya Sharma',
  login: 'priya',
  password: 'priya12345',
});
({ token } = await api('POST', '/auth/login', { login: 'priya', password: 'priya12345' }));
await api('PUT', '/company', {
  name: 'Shree Ganesh Industrial Supplies',
  gstin: '27AAPFU0939F1ZV',
  stateCode: '27',
  pan: 'AAPFU0939F',
  street: 'Plot 42, MIDC Bhosari',
  city: 'Pune',
  pincode: '411026',
  phone: '020 2712 4455',
  email: 'accounts@shreeganesh.example',
  bankAccountName: 'Shree Ganesh Industrial Supplies',
  bankAccountNumber: '50200012345678',
  bankIfsc: 'HDFC0000123',
  bankName: 'HDFC Bank',
  bankBranch: 'Bhosari',
  upiId: 'shreeganesh@okhdfc',
  invoiceTerms: 'Goods once sold will not be taken back.\nInterest @18% p.a. on bills unpaid after 30 days.',
});
await api('PUT', '/einvoice/settings', { enabled: true, provider: 'simulator' });

const products = [];
for (const p of [
  { name: 'Hex bolt M10 x 50, zinc plated', kind: 'goods', hsnCode: '73181500', uom: 'NOS', salePrice: '14', costPrice: '9', gstRate: '18', reorderLevel: '500', open: '6000' },
  { name: 'Hex nut M10', kind: 'goods', hsnCode: '73181600', uom: 'NOS', salePrice: '4', costPrice: '2.4', gstRate: '18', reorderLevel: '1000', open: '15000' },
  { name: 'Anchor fastener 12 mm', kind: 'goods', hsnCode: '73181900', uom: 'NOS', salePrice: '38', costPrice: '24', gstRate: '18', reorderLevel: '200', open: '2400' },
  { name: 'HSS drill bit set, 13 pc', kind: 'goods', hsnCode: '82075000', uom: 'BOX', salePrice: '1450', costPrice: '980', gstRate: '18', reorderLevel: '20', open: '140' },
  { name: 'Angle grinder 4 inch, 850 W', kind: 'goods', hsnCode: '84672900', uom: 'NOS', salePrice: '3250', costPrice: '2390', gstRate: '18', reorderLevel: '10', open: '60' },
  { name: 'Cutting wheel 4 inch', kind: 'goods', hsnCode: '68042200', uom: 'NOS', salePrice: '42', costPrice: '27', gstRate: '18', reorderLevel: '300', open: '3000' },
  { name: 'Safety gloves, cut resistant', kind: 'goods', hsnCode: '61169200', uom: 'NOS', salePrice: '185', costPrice: '120', gstRate: '5', reorderLevel: '100', open: '900' },
  { name: 'Welding electrode E6013, 3.15 mm', kind: 'goods', hsnCode: '83111000', uom: 'KGS', salePrice: '210', costPrice: '158', gstRate: '18', reorderLevel: '300', open: '320' },
  { name: 'Site installation and testing', kind: 'service', hsnCode: '998719', uom: 'HRS', salePrice: '950', gstRate: '18' },
]) {
  const { open, ...fields } = p;
  products.push({ ...(await create('base.product', fields)), open });
}
const goods = products.filter((p) => p.kind === 'goods');
await post('stock.adjustment', { reason: 'opening', date: daysAgo(360), lines: goods.map((p) => ({ productId: p.id, qty: String(Number(p.open) * 5), unitCost: p.costPrice })) });

// Demo GSTINs with a correct check character, so the GST returns treat them as registered.
const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const gstin = (first14) => first14 + [...CHARS].find((c) => isValidGstin(first14 + c));

const customers = [];
for (const c of [
  { name: 'Kalyani Forge Components', gstin: gstin('27AABCK1234M1Z'), stateCode: '27', street: 'Gat 112, Chakan', city: 'Pune', pincode: '410501' },
  { name: 'Deccan Engineering Works', gstin: gstin('27AAACD4567N1Z'), stateCode: '27', street: 'Sector 10, PCNTDA', city: 'Pimpri', pincode: '411019' },
  { name: 'Karnataka Components Pvt Ltd', gstin: gstin('29AABCT1332L1Z'), stateCode: '29', street: '5 Residency Road', city: 'Bengaluru', pincode: '560025' },
  { name: 'Sabarmati Fabricators', gstin: gstin('24AAJFS7788K1Z'), stateCode: '24', street: 'GIDC Vatva', city: 'Ahmedabad', pincode: '382445' },
  { name: 'Konkan Marine Services', gstin: gstin('27AAGCK2211P1Z'), stateCode: '27', street: 'Mirkarwada Jetty', city: 'Ratnagiri', pincode: '415612' },
  { name: 'Walk-in customer', stateCode: '27', city: 'Pune' },
]) {
  customers.push(await create('base.contact', c));
}
const vendors = [];
for (const v of [
  { name: 'Sundram Fasteners Distributors', isVendor: true, gstin: gstin('33AACCS1119L1Z'), stateCode: '33', street: 'Ambattur Industrial Estate', city: 'Chennai', pincode: '600058' },
  { name: 'Pune Tools Agency', isVendor: true, gstin: gstin('27AADFP5521Q1Z'), stateCode: '27', street: 'Budhwar Peth', city: 'Pune', pincode: '411002' },
]) {
  vendors.push(await create('base.contact', v));
}

// ---------------------------------------------------------------- a year of trading
const line = (p, qty) => ({ productId: p.id, description: p.name, hsnCode: p.hsnCode, qty: String(qty), uom: p.uom, unitPrice: p.salePrice, gstRate: p.gstRate });
// Order sizes follow price: a few grinders, hundreds of nuts.
const qtyFor = (p) => {
  const price = Number(p.salePrice);
  if (price >= 1000) return 2 + Math.floor(rand() * 6);
  if (price >= 100) return 10 + Math.floor(rand() * 40);
  return 100 + Math.floor(rand() * 600);
};
const invoices = [];
for (let month = 11; month >= 0; month--) {
  const sold = new Map();
  const count = 7 + Math.floor(rand() * 5) + Math.floor((11 - month) / 3);
  for (let i = 0; i < count; i++) {
    const day = Math.min(month * 30 + Math.floor(rand() * 28), 364);
    const c = pick(customers);
    const a = pick(goods);
    const lines = [line(a, qtyFor(a))];
    const b = pick(goods);
    if (rand() > 0.4 && b !== a) lines.push(line(b, qtyFor(b)));
    if (rand() > 0.75) lines.push(line(products.at(-1), 2 + Math.floor(rand() * 6)));
    for (const l of lines) if (l.productId !== products.at(-1).id) sold.set(l.productId, (sold.get(l.productId) ?? 0) + Number(l.qty));
    const inv = await post('sales.invoice', { customerId: c.id, placeOfSupply: c.stateCode, date: daysAgo(day), dueDate: daysAgo(Math.max(day - 30, 0)), lines });
    invoices.push(inv);
    // Older invoices are paid; the last two months are partly outstanding, as in any trading business.
    const paid = c.name === 'Walk-in customer' || day > 60 || (day > 25 && rand() > 0.4);
    if (paid) {
      await post('account.payment', { direction: 'inbound', partnerId: c.id, amount: inv.totalAmount, mode: pick(['bank', 'upi', 'cheque']), date: daysAgo(Math.max(day - 25, 0)), lines: [{ invoiceId: inv.id, amount: inv.totalAmount }] });
    } else if (day > 10 && rand() > 0.5) {
      const part = (Number(inv.totalAmount) / 2).toFixed(2);
      await post('account.payment', { direction: 'inbound', partnerId: c.id, amount: part, mode: 'upi', date: daysAgo(day - 7), lines: [{ invoiceId: inv.id, amount: part }] });
    }
  }
  // Restock what was sold, at cost, split between the two suppliers; pay after about 30 days.
  const byVendor = [[], []];
  for (const [productId, qty] of sold) {
    const p = goods.find((g) => g.id === productId);
    byVendor[p.hsnCode.startsWith('7318') ? 0 : 1].push({ productId, description: p.name, hsnCode: p.hsnCode, qty: String(qty), uom: p.uom, unitPrice: p.costPrice, gstRate: p.gstRate });
  }
  for (const [i, lines] of byVendor.entries()) {
    if (!lines.length) continue;
    const v = vendors[i];
    const day = Math.min(month * 30 + 3, 364);
    const bill = await post('purchase.bill', { vendorId: v.id, vendorState: v.stateCode, vendorBillNo: `${i ? 'PTA' : 'SFD'}/${26 * 100 + 12 - month}${i}`, date: daysAgo(day), dueDate: daysAgo(Math.max(day - 30, 0)), lines });
    if (day > 35) {
      await post('account.payment', { direction: 'outbound', partnerId: v.id, amount: bill.totalAmount, mode: 'bank', date: daysAgo(day - 30), lines: [{ billId: bill.id, amount: bill.totalAmount }] });
    }
  }
}
// Stock running low on one item, so the dashboard has something to flag.
const electrodes = goods.find((p) => p.name.startsWith('Welding'));
const left = (await api('GET', `/records/stock.quant?f.productId=${electrodes.id}`)).records.reduce((n, q) => n + Number(q.qty), 0);
await post('stock.adjustment', { reason: 'damage', lines: [{ productId: electrodes.id, qty: String(-(left - 180)) }] });

// Today's documents for the close-up screens.
const kc = customers.find((c) => c.name.startsWith('Karnataka'));
const showcase = await post('sales.invoice', {
  customerId: kc.id,
  placeOfSupply: '29',
  reference: 'PO/KC/2026/0418',
  dueDate: daysAgo(-30),
  lines: [line(goods[0], 500), line(goods[1], 500), line(goods[2], 120), line(products.at(-1), 6)],
});
await api('POST', `/einvoice/sales.invoice/${showcase.id}/generate`, {});
await api('POST', `/einvoice/sales.invoice/${showcase.id}/ewaybill`, { distanceKm: 840, transMode: '1', vehicleNo: 'MH12QW4521' });
const quote = await create('sales.quotation', {
  customerId: customers[1].id,
  placeOfSupply: '27',
  reference: 'Enquiry 18 Oct',
  lines: [line(goods[4], 4), line(goods[5], 200), line(goods[6], 50), line(products.at(-1), 8)],
});
await act('sales.quotation', quote.id, 'send');
const cnFor = invoices.find((i) => i.customerId.id === customers[0].id && i.lines?.length !== 0) ?? invoices[0];
const creditNote = await post('sales.credit_note', { invoiceId: cnFor.id, customerId: cnFor.customerId.id, placeOfSupply: cnFor.placeOfSupply, reason: 'return', lines: [line(goods.find((g) => g.id === (cnFor.lines?.[0]?.productId?.id ?? goods[0].id)) ?? goods[0], 5)] });

// A bank statement for the last month, imported and auto-matched against the books.
const bankAccount = (await api('GET', '/records/account.bank_account')).records[0];
const recentPayments = (await api('GET', '/records/account.payment?limit=200')).records
  .filter((p) => p.state === 'posted' && p.date >= daysAgo(30) && !String(p.partnerId.display).startsWith('Walk-in'))
  .slice(0, 9);
const statementRows = recentPayments.map((p) => ({
  date: p.date,
  description: `${p.direction === 'inbound' ? 'NEFT CR' : 'NEFT DR'}-${String(p.partnerId.display).toUpperCase()}-${p.number}`,
  reference: p.number,
  amount: p.direction === 'inbound' ? String(p.amount) : String(-Number(p.amount)),
}));
statementRows.push({ date: daysAgo(2), description: 'CHGS INCL GST', reference: null, amount: '-59.00' });
const statement = await api('POST', '/bank/statements', { bankAccountId: bankAccount.id, rows: statementRows });
await api('POST', `/bank/statements/${statement.statementId}/auto-match`);

// ---------------------------------------------------------------- capture
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.goto(B);
await page.evaluate((t) => localStorage.setItem('osuite.token', t), token);
const settle = () => page.waitForLoadState('networkidle').then(() => page.waitForTimeout(400));
const shot = async (name, target = page) => {
  await settle();
  await target.screenshot({ path: join(OUT, `${name}.png`), animations: 'disabled' });
  console.log(`ok  ${name}`);
};
const go = async (path) => {
  await page.goto(`${B}${path}`);
  await settle();
};

await go('/');
await page.getByRole('region', { name: 'Key figures' }).waitFor();
await shot('dashboard');

await go(`/m/sales.invoice?id=${showcase.id}`);
await page.getByRole('region', { name: 'E-invoice' }).waitFor();
await shot('invoice-einvoice');

await go('/m/sales.invoice?id=new');
await page.getByRole('combobox', { name: 'Customer' }).fill('kalyani');
await page.getByRole('option', { name: /Kalyani/ }).click();
await page.getByRole('button', { name: 'Add line' }).click();
await page.getByRole('combobox', { name: 'Product, line 1' }).fill('anchor');
await page.getByRole('option', { name: /Anchor/ }).waitFor();
await page.keyboard.press('Enter');
await page.getByLabel('Qty, line 1').fill('240');
await page.keyboard.press('Enter');
await page.getByRole('combobox', { name: 'Product, line 2' }).fill('drill');
await page.getByRole('option', { name: /drill/i }).waitFor();
await page.keyboard.press('Enter');
await page.getByLabel('Qty, line 2').fill('6');
await shot('invoice-entry');

for (const [name, path, sel] of [
  ['print-invoice', `/print/sales.invoice/${showcase.id}`, 'article'],
  ['print-quotation', `/print/sales.quotation/${quote.id}`, 'article'],
  ['print-proforma', `/print/sales.quotation/${quote.id}?as=proforma`, 'article'],
  ['print-credit-note', `/print/sales.credit_note/${creditNote.id}`, 'article'],
  ['print-statement', `/print/statement/${kc.id}`, '.mx-auto'],
]) {
  await go(path);
  const sheet = page.locator(sel).first();
  await sheet.waitFor();
  await shot(name, sheet);
}

for (const [name, path, wait] of [
  ['quotations', '/m/sales.quotation', 'Quotations'],
  ['invoices', '/m/sales.invoice', 'Invoices'],
  ['receivables', '/reports/receivables', 'Receivables'],
  ['gstr-1', '/reports/gstr-1', 'GSTR-1'],
  ['gstr-3b', '/reports/gstr-3b', 'GSTR-3B'],
  ['profit-loss', '/reports/profit-loss', 'Profit & loss'],
  ['balance-sheet', '/reports/balance-sheet', 'Balance sheet'],
  ['day-book', '/reports/day-book', 'Day book'],
  ['stock', '/m/stock.quant', 'Stock on hand'],
  ['closing', '/closing', 'Year-end closing'],
  ['backups', '/settings/backups', 'Backups'],
  ['einvoice-settings', '/settings/einvoice', 'E-invoicing'],
  ['bills', '/m/purchase.bill', 'Bills'],
  ['payments', '/m/account.payment?f.direction=inbound', /Payments/],
  ['stock-ledger', '/m/stock.move', /Stock/],
  ['trial-balance', '/reports/trial-balance', 'Trial balance'],
  ['bank', `/bank/${statement.statementId}`, /./],
]) {
  await go(path);
  await page.getByRole('heading', { name: wait }).first().waitFor();
  await shot(name);
}

await go(`/reports/ledger?partner=${kc.id}`);
await page.getByRole('heading', { name: /Statement/ }).waitFor();
await shot('statement');

await go('/');
await page.keyboard.press('Control+k');
await page.getByRole('dialog').waitFor();
await page.keyboard.type('kalyani');
await page.waitForTimeout(500);
await shot('command-palette');

// ---------------------------------------------------------------- the moving picture
// A short screen recording of an invoice being entered at a human pace: the real
// app, used on the website as a muted loop.
const VIDEO_DIR = resolve(import.meta.dirname, '../.data/capture-video');
rmSync(VIDEO_DIR, { recursive: true, force: true });
const rec = await browser.newContext({ viewport: { width: 1280, height: 800 }, recordVideo: { dir: VIDEO_DIR, size: { width: 1280, height: 800 } } });
const vp = await rec.newPage();
vp.on('dialog', (d) => void d.accept());
await vp.goto(B);
await vp.evaluate((t) => localStorage.setItem('osuite.token', t), token);
await vp.goto(`${B}/m/sales.invoice?id=new`);
await vp.waitForLoadState('networkidle');
await vp.waitForTimeout(700);
const typeSlow = async (locator, text) => {
  await locator.click();
  await locator.pressSequentially(text, { delay: 110 });
};
await typeSlow(vp.getByRole('combobox', { name: 'Customer' }), 'karna');
await vp.getByRole('option', { name: 'Karnataka Components Pvt Ltd' }).first().click();
await vp.waitForTimeout(500);
await vp.getByRole('button', { name: 'Add line' }).click();
await typeSlow(vp.getByRole('combobox', { name: 'Product, line 1' }), 'hex bolt');
await vp.getByRole('option', { name: /Hex bolt/ }).waitFor();
await vp.keyboard.press('Enter');
await vp.waitForTimeout(300);
await vp.getByLabel('Qty, line 1').fill('');
await typeSlow(vp.getByLabel('Qty, line 1'), '500');
await vp.keyboard.press('Enter');
await typeSlow(vp.getByRole('combobox', { name: 'Product, line 2' }), 'anchor');
await vp.getByRole('option', { name: /Anchor/ }).waitFor();
await vp.keyboard.press('Enter');
await vp.waitForTimeout(300);
await vp.getByLabel('Qty, line 2').fill('');
await typeSlow(vp.getByLabel('Qty, line 2'), '120');
await vp.waitForTimeout(1600);
await vp.keyboard.press('Control+s');
await vp.getByText('Invoice created').waitFor();
await vp.waitForTimeout(800);
await vp.getByRole('button', { name: 'Post invoice' }).click();
await vp.getByText('Invoice posted').waitFor();
await vp.waitForTimeout(2200);
const videoPath = await vp.video().path();
await rec.close();
const MEDIA = resolve(import.meta.dirname, '../apps/site/public/media');
mkdirSync(MEDIA, { recursive: true });
copyFileSync(videoPath, join(MEDIA, 'invoice-entry.webm'));
console.log(`ok  invoice-entry.webm (${Math.round(statSync(join(MEDIA, 'invoice-entry.webm')).size / 1024)} KB)`);

console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
if (errors.length) process.exit(1);
