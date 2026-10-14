// Stress test for the lines grid: rapid typing right after adding lines must
// never lose a cell value (regression for a lost-update race). FRESH DB, server
// run with OSUITE_LICENSE=off and OSUITE_WEB_DIST=apps/web/dist.
// Usage: node e2e/grid-stress.mjs <screenshot-dir>
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
const check = (cond, msg) => {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  console.log(`ok  ${msg}`);
};

await api('POST', '/setup', { companyName: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', adminName: 'Priya Sharma', login: 'priya', password: 'priya12345' });
({ token } = await api('POST', '/auth/login', { login: 'priya', password: 'priya12345' }));
await api('POST', '/records/base.contact', { name: 'Kaveri Agro Foods', stateCode: '29' });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const onFailure = async (e) => {
  console.error(e.message);
  await page.screenshot({ path: `${OUT}/FAILED.png` }).catch(() => {});
  process.exit(1);
};
process.on('unhandledRejection', onFailure);
process.on('uncaughtException', onFailure);
await page.goto(B);
await page.evaluate((t) => localStorage.setItem('osuite.token', t), token);
await page.goto(`${B}/m/sales.invoice?id=new`);
await page.getByRole('combobox', { name: 'Customer', exact: true }).fill('kaveri');
await page.getByRole('option', { name: 'Kaveri Agro Foods' }).click();

const N = 12;
for (let i = 1; i <= N; i++) {
  // No waits: type into the new row while its first cell is still taking focus.
  await page.getByRole('button', { name: 'Add line' }).click();
  await page.getByLabel(`Description, line ${i}`, { exact: true }).fill(`Item ${i}`);
  await page.getByLabel(`Rate, line ${i}`, { exact: true }).fill(String(i * 100));
}
const descriptions = [];
for (let i = 1; i <= N; i++) descriptions.push(await page.getByLabel(`Description, line ${i}`, { exact: true }).inputValue());
check(descriptions.every((d, i) => d === `Item ${i + 1}`), `all ${N} descriptions kept while typing fast`);
// Taxable 100 + 200 + ... + 1200 = 7,800; IGST 18% = 1,404; total 9,204
await page.getByText('₹9,204.00').waitFor();
await page.keyboard.press('Control+s');
await page.getByText('Invoice created').waitFor();
const id = Number(new URL(page.url()).searchParams.get('id'));
const saved = await api('GET', `/records/sales.invoice/${id}`);
check(saved.lines.length === N && saved.totalAmount === '9204.00', `saved with ${N} lines and the right total`);
await browser.close();
