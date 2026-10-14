// Browser walkthrough of bank reconciliation against a FRESH product DB, server
// run with OSUITE_LICENSE=off and OSUITE_WEB_DIST=apps/web/dist.
// Usage: node e2e/bank-ui.mjs <screenshot-dir>   (uses installed Microsoft Edge)
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
const dmy = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`;

await api('POST', '/setup', { companyName: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', adminName: 'Priya Sharma', login: 'priya', password: 'priya12345' });
({ token } = await api('POST', '/auth/login', { login: 'priya', password: 'priya12345' }));
const svc = await api('POST', '/records/base.product', { name: 'Consulting', kind: 'service', hsnCode: '9983', salePrice: '1000' });
const acme = await api('POST', '/records/base.contact', { name: 'Acme Industries', stateCode: '27' });
const inv = await api('POST', '/records/sales.invoice', { customerId: acme.id, placeOfSupply: '27', lines: [{ productId: svc.id, description: 'Consulting', qty: '1', unitPrice: '1000', gstRate: '18' }] });
await post('sales.invoice', inv.id);
const rc = await api('POST', '/records/account.payment', { direction: 'inbound', partnerId: acme.id, amount: '1180', mode: 'upi', reference: 'UTR4471002', lines: [{ invoiceId: inv.id, amount: '1180' }] });
const receipt = await post('account.payment', rc.id);
await api('POST', '/records/account.account', { code: '6200', name: 'Bank charges', type: 'expense' });

// An HDFC-style export: account details above the header, a footer line.
const today = dmy(new Date());
const csv = `Account Number : 50200012345678
Statement From : ${today} To : ${today}

Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance
${today},"UPI-ACME INDUSTRIES-acme@okicici-UTR4471002",UTR4471002,${today},,"1,180.00","1,180.00"
${today},CHGS INCL GST,,${today},59.00,,"1,121.00"
Statement Summary,,,,,,
`;

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
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

await page.goto(B);
await page.getByRole('navigation').getByRole('link', { name: 'Bank reconciliation' }).click();
await page.getByRole('heading', { name: 'Bank reconciliation' }).waitFor();
await page.locator('input[type=file]').setInputFiles({ name: 'hdfc.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
await page.getByText('2 lines read, 1 skipped').waitFor();
check((await page.getByRole('combobox', { name: 'Withdrawal', exact: true }).locator('option:checked').innerText()) === 'Withdrawal Amt.', 'HDFC columns detected');
check((await page.getByLabel('Closing balance on the bank').inputValue()) === '1121.00', 'closing balance taken from the last line');
await page.screenshot({ path: `${OUT}/b01-import.png`, fullPage: true });
await page.getByRole('button', { name: 'Import 2 lines' }).click();

await page.getByText('0 of 2').waitFor();
await page.getByText('reference matches').waitFor();
check(true, 'statement imported; the receipt is suggested with a reference match');
await page.getByRole('button', { name: 'Auto-match' }).click();
await page.getByText('Matched 1 line.').waitFor();
check((await page.getByRole('button', { name: 'Unmatch' }).count()) === 1 && (await page.getByText(receipt.number).first().isVisible()), 'receipt matched by its UTR');

await page.getByRole('button', { name: 'Book to an account…' }).click();
await page.getByRole('combobox', { name: /Account for CHGS/ }).fill('charges');
await page.getByRole('option', { name: 'Bank charges' }).click();
await page.getByRole('button', { name: 'Book and match' }).click();
await page.getByText('2 of 2').waitFor();
check(true, 'bank charges booked and matched; statement fully reconciled');
check((await page.getByRole('definition').filter({ hasText: '1,121.00' }).count()) === 2, 'bank and books both at 1,121.00');
await page.screenshot({ path: `${OUT}/b02-reconciled.png` });

await page.goto(`${B}/bank`);
await page.getByRole('link', { name: /Main bank account/ }).waitFor();
check(true, 'statement listed on the bank page');

console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
