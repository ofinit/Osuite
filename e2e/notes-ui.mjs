// Browser walkthrough of credit notes, debit notes and manual journals against a
// FRESH product DB, server run with OSUITE_LICENSE=off and OSUITE_WEB_DIST=apps/web/dist.
// Usage: node e2e/notes-ui.mjs <screenshot-dir>   (uses installed Microsoft Edge)
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

await api('POST', '/setup', { companyName: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', adminName: 'Priya Sharma', login: 'priya', password: 'priya12345' });
({ token } = await api('POST', '/auth/login', { login: 'priya', password: 'priya12345' }));
const bolt = await api('POST', '/records/base.product', { name: 'Steel bolt M8', hsnCode: '7318', salePrice: '9', costPrice: '4', kind: 'goods' });
const acme = await api('POST', '/records/base.contact', { name: 'Acme Industries', stateCode: '27', gstin: '27AAPFU0939F1ZV' });
const kcc = await api('POST', '/records/base.contact', { name: 'Karnataka Copper Co', isVendor: true, isCustomer: false, stateCode: '29' });
const adj = await api('POST', '/records/stock.adjustment', { reason: 'opening', lines: [{ productId: bolt.id, qty: '100', unitCost: '4' }] });
await post('stock.adjustment', adj.id);
const inv = await api('POST', '/records/sales.invoice', { customerId: acme.id, placeOfSupply: '27', lines: [{ productId: bolt.id, description: 'Steel bolt M8', hsnCode: '7318', qty: '30', unitPrice: '9', gstRate: '18' }] });
const invPosted = await post('sales.invoice', inv.id);
const bill = await api('POST', '/records/purchase.bill', { vendorId: kcc.id, vendorState: '29', vendorBillNo: 'KCC/1', lines: [{ productId: bolt.id, description: 'Steel bolt M8', qty: '10', unitPrice: '5', gstRate: '18' }] });
await post('purchase.bill', bill.id);
await api('POST', '/records/account.account', { code: '6100', name: 'Rent', type: 'expense' });

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

// Credit note from the invoice.
await page.goto(`${B}/m/sales.invoice?id=${inv.id}`);
await page.getByRole('link', { name: 'Issue credit note' }).click();
await page.getByRole('heading', { name: 'New credit note' }).waitFor();
check((await page.getByRole('combobox', { name: 'Against invoice' }).inputValue()) === invPosted.number, 'credit note prefilled with the invoice');
check((await page.getByRole('combobox', { name: 'Customer', exact: true }).inputValue()) === 'Acme Industries', 'and its customer');
await page.keyboard.press('Control+s');
await page.getByText('Credit note created').waitFor();
await page.getByRole('button', { name: 'Copy items from invoice' }).click();
await page.getByLabel('Qty, line 1').waitFor();
check((await page.getByLabel('Qty, line 1').inputValue()) === '30.000', 'copied the invoice line');
await page.getByLabel('Qty, line 1').fill('10');
await page.getByText('₹106.00').waitFor(); // 90 + 8.10 + 8.10 = 106.20 -> 106
await page.keyboard.press('Control+s');
await page.getByText('Changes saved').waitFor();
await page.getByRole('button', { name: 'Post credit note' }).click();
await page.getByText('Credit note posted').waitFor();
check(/^CN\//.test((await page.locator('aside h2').innerText()).trim()), 'credit note posted');
check((await page.getByText('Applied to the original').count()) === 1, 'settlement shown after posting');
await page.screenshot({ path: `${OUT}/n01-credit-note.png` });
const cnUrl = page.url();
const due = (await api('GET', `/records/sales.invoice/${inv.id}`)).amountDue;
check(due === '213.00', 'invoice due reduced to 213');

await page.goto(`${B}/print/sales.credit_note/${cnUrl.split('id=')[1]}`);
await page.getByText('Credit Note', { exact: true }).waitFor();
check((await page.getByText(invPosted.number, { exact: true }).count()) === 1 && (await page.getByText('Scan to pay with UPI').count()) === 0, 'credit note prints with its invoice and no payment QR');
await page.screenshot({ path: `${OUT}/n02-credit-note-print.png`, fullPage: true });

// Debit note shortcut on the bill.
await page.goto(`${B}/m/purchase.bill?id=${bill.id}`);
await page.getByRole('link', { name: 'Issue debit note' }).click();
await page.getByRole('heading', { name: 'New debit note' }).waitFor();
check((await page.locator('#f-vendorState').inputValue()) === '29', 'debit note prefilled from the bill');

// Manual journal with a live balance check.
await page.goto(`${B}/m/account.manual`);
await page.getByText('No manual journals yet').waitFor();
await page.keyboard.press('n');
await page.getByRole('heading', { name: 'New manual journal' }).waitFor();
await page.locator('#f-narration').fill('October shop rent');
await page.getByRole('button', { name: 'Add line' }).click();
await page.getByRole('combobox', { name: 'Account, line 1' }).fill('rent');
await page.getByRole('option', { name: 'Rent' }).click();
await page.getByLabel('Debit, line 1').fill('25000');
await page.getByRole('button', { name: 'Add line' }).click();
await page.getByRole('combobox', { name: 'Account, line 2' }).fill('bank');
await page.getByRole('option', { name: 'Bank account' }).click();
await page.getByLabel('Credit, line 2').fill('24000');
await page.getByText('Credits short by').waitFor();
check((await page.getByText('1,000.00').count()) >= 1, 'summary shows the 1,000 difference');
await page.getByLabel('Credit, line 2').fill('25000');
await page.getByText('Balanced', { exact: true }).waitFor();
await page.keyboard.press('Control+s');
await page.getByText('Manual journal created').waitFor();
await page.getByRole('button', { name: 'Post journal' }).click();
await page.getByText('Manual journal posted').waitFor();
check(/^MJ\//.test((await page.locator('aside h2').innerText()).trim()), 'manual journal posted');
await page.screenshot({ path: `${OUT}/n03-manual-journal.png` });

console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
