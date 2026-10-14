// Browser walkthrough of accounting reports against a FRESH product DB, server
// run with OSUITE_LICENSE=off and OSUITE_WEB_DIST=apps/web/dist.
// Usage: node e2e/accounting-ui.mjs <screenshot-dir>   (uses installed Microsoft Edge)
import { readFileSync } from 'node:fs';
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
  return r.json();
};
const post = (model, id) => api('POST', `/records/${model}/${id}/actions/post`);
const check = (cond, msg) => {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  console.log(`ok  ${msg}`);
};

// Same scenario as accounting-api.mjs: profit 40.95, trial balance 1,129.05.
await api('POST', '/setup', { companyName: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', adminName: 'Priya Sharma', login: 'priya', password: 'priya12345' });
({ token } = await api('POST', '/auth/login', { login: 'priya', password: 'priya12345' }));
const bolt = await api('POST', '/records/base.product', { name: 'Steel bolt M8', hsnCode: '7318', salePrice: '9', costPrice: '4', kind: 'goods' });
const acme = await api('POST', '/records/base.contact', { name: 'Acme Industries', stateCode: '27', gstin: '27AAPFU0939F1ZV' });
const kcc = await api('POST', '/records/base.contact', { name: 'Karnataka Copper Co', isVendor: true, isCustomer: false, stateCode: '29' });
const adj = await api('POST', '/records/stock.adjustment', { reason: 'opening', lines: [{ productId: bolt.id, qty: '100', unitCost: '4' }] });
await post('stock.adjustment', adj.id);
const bill = await api('POST', '/records/purchase.bill', {
  vendorId: kcc.id, vendorState: '29', vendorBillNo: 'KCC/1',
  lines: [
    { productId: bolt.id, description: 'Steel bolt M8', qty: '50', unitPrice: '5.50', discountPct: '10', gstRate: '18' },
    { description: 'Freight', hsnCode: '9965', qty: '1', unitPrice: '100', gstRate: '18' },
  ],
});
await post('purchase.bill', bill.id);
const inv = await api('POST', '/records/sales.invoice', { customerId: acme.id, placeOfSupply: '27', customerGstin: '27AAPFU0939F1ZV', lines: [{ productId: bolt.id, description: 'Steel bolt M8', hsnCode: '7318', qty: '30', unitPrice: '9', gstRate: '18' }] });
await post('sales.invoice', inv.id);
const rc = await api('POST', '/records/account.payment', { direction: 'inbound', partnerId: acme.id, amount: '319', mode: 'bank', lines: [{ invoiceId: inv.id, amount: '319' }] });
await post('account.payment', rc.id);
const py = await api('POST', '/records/account.payment', { direction: 'outbound', partnerId: kcc.id, amount: '410', mode: 'cash', lines: [{ billId: bill.id, amount: '410' }] });
await post('account.payment', py.id);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
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

// Trial balance, then drill into an account.
await page.goto(B);
await page.getByRole('navigation').getByRole('link', { name: 'Trial balance' }).click();
await page.getByText('Debits equal credits.').waitFor();
check((await page.getByRole('cell', { name: '1,129.05' }).count()) === 2, 'trial balance totals 1,129.05 on both sides');
await page.screenshot({ path: `${OUT}/a01-trial-balance.png` });
await page.getByRole('link', { name: /Stock-in-hand/ }).click();
await page.getByRole('heading', { name: /Stock-in-hand/ }).waitFor();
await page.getByRole('cell', { name: '129.50' }).first().waitFor();
check((await page.locator('tbody tr').count()) === 4, 'stock account drills into its ledger: opening and 3 items');

// P&L and balance sheet.
await page.goto(`${B}/reports/profit-loss`);
await page.getByText('Net profit').waitFor();
check((await page.getByText('₹40.95').count()) === 1, 'P&L shows net profit ₹40.95');
await page.screenshot({ path: `${OUT}/a02-profit-loss.png` });
await page.goto(`${B}/reports/balance-sheet`);
await page.getByText('Assets equal liabilities plus equity.').waitFor();
check((await page.getByRole('cell', { name: '489.55' }).count()) === 1, 'balance sheet balances at 489.55');
await page.screenshot({ path: `${OUT}/a03-balance-sheet.png` });

// GST returns.
await page.goto(`${B}/reports/gstr-3b`);
await page.getByRole('cell', { name: /Outward taxable supplies/ }).waitFor();
check((await page.getByRole('cell', { name: '62.55' }).count()) >= 1 && (await page.getByRole('cell', { name: '24.30' }).count()) >= 2, 'GSTR-3B shows output CGST/SGST and IGST credit');
await page.goto(`${B}/reports/gstr-1`);
await page.getByRole('cell', { name: '27AAPFU0939F1ZV' }).waitFor();
const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'CSV' }).first().click()]);
const csv = readFileSync(await dl.path(), 'utf8');
check(csv.startsWith('gstin,customer,number,date') && csv.includes('27AAPFU0939F1ZV') && csv.includes('270.00'), 'GSTR-1 B2B downloads as CSV');
await page.screenshot({ path: `${OUT}/a04-gstr1.png`, fullPage: true });

// Chart of accounts accepts new accounts; journal stays read-only.
await page.goto(`${B}/m/account.account`);
await page.getByRole('cell', { name: 'Sundry debtors' }).waitFor();
await page.keyboard.press('n');
await page.getByRole('heading', { name: 'New account' }).waitFor();
await page.locator('#f-code').fill('6100');
await page.locator('#f-name').fill('Rent');
await page.locator('#f-type').selectOption('expense');
await page.keyboard.press('Control+s');
await page.getByText('Account created').waitFor();
check(true, 'a custom expense account can be added');
await page.goto(`${B}/m/account.entry`);
await page.getByRole('heading', { name: 'Journal entries' }).waitFor();
await page.getByRole('cell', { name: /^JV\/\d{2}-\d{2}\/0005$/ }).waitFor();
check((await page.getByRole('button', { name: /New/ }).count()) === 0 && (await page.locator('tbody tr').count()) === 5, 'five automatic journal entries, no manual New');

console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
