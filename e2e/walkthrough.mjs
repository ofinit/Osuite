// Browser walkthrough against a FRESH install (empty DBs, server serving the web build).
// Usage: node e2e/walkthrough.mjs <screenshot-dir>   (uses the installed Microsoft Edge)
import { chromium } from 'playwright-core';
const OUT = process.argv[2];
const B = 'http://127.0.0.1:47800';
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` });
// A failed top-level await surfaces as an uncaught exception, not a rejection.
const onFailure = async (e) => {
  console.error(e.message);
  await page.screenshot({ path: `${OUT}/FAILED.png` }).catch(() => {});
  process.exit(1);
};
process.on('unhandledRejection', onFailure);
process.on('uncaughtException', onFailure);

await page.goto(B);
await page.getByLabel('Company name').fill('Ofin Demo Traders');
await page.getByLabel('GSTIN (optional)').fill('27aapfu0939f1zv');
await page.getByLabel('Your name').fill('Priya Sharma');
await page.getByLabel('Login').fill('priya');
await page.getByLabel('Password').fill('priya12345');
await shot('01-setup');
await page.getByRole('button', { name: 'Create company' }).click();
await page.getByText('Activate OSuite').waitFor();
await page.getByLabel('Work email').fill('priya@ofindemo.in');
await shot('02-activate');
await page.getByRole('button', { name: 'Start 14-day trial' }).click();
await page.getByText('Good ', { exact: false }).first().waitFor();
await shot('03-home');

// Seed data through the API with the session token.
const token = await page.evaluate(() => localStorage.getItem('osuite.token'));
const api = (path, body) => fetch(B + '/api' + path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify(body) }).then((r) => r.json());
const companies = [
  ['Acme Industries', 'Pune', '27', '27AAPFU0939F1ZV'], ['Shree Ganesh Traders', 'Ahmedabad', '24', ''], ['Kaveri Agro Foods', 'Mysuru', '29', ''],
  ['Lakshmi Steel Works', 'Coimbatore', '33', ''], ['Northwind Distributors', 'Delhi', '07', ''], ['Sunrise Pharma', 'Hyderabad', '36', ''],
  ['Bharat Electricals', 'Kolkata', '19', ''], ['Coastal Marine Exports', 'Kochi', '32', ''], ['Himalaya Packaging', 'Dehradun', '05', ''],
];
for (const [name, city, stateCode, gstin] of companies)
  await api('/records/base.contact', { name, city, stateCode, gstin, phone: '98' + String(Math.floor(Math.random() * 1e8)).padStart(8, '0'), email: name.split(' ')[0].toLowerCase() + '@example.in', creditLimit: String(Math.floor(Math.random() * 900000) + 100000) });
const cat = await api('/records/base.product_category', { name: 'Fasteners' });
await api('/records/base.product_category', { name: 'Electrical' });
for (const [name, sku, hsn, price] of [['Steel bolt M8 × 40', 'BLT-M8-40', '7318', '4.50'], ['Hex nut M8', 'NUT-M8', '7318', '1.20'], ['Copper wire 2.5 mm (90 m)', 'CW-25-90', '8544', '2450'], ['Installation service', 'SVC-INST', '9987', '1500']])
  await api('/records/base.product', { name, sku, hsnCode: hsn, salePrice: price, categoryId: cat.id, kind: sku.startsWith('SVC') ? 'service' : 'goods' });

// Keyboard-driven creation.
await page.getByRole('link', { name: 'Contacts' }).first().click();
await page.getByRole('table').waitFor();
await page.keyboard.press('n');
await page.getByLabel('Name').fill('Ravi Kumar');
await page.getByLabel('Type').selectOption('person');
await page.getByRole('combobox', { name: 'Company' }).fill('acm');
await page.getByRole('option', { name: 'Acme Industries' }).waitFor();
await page.keyboard.press('Enter');
await page.getByLabel('GSTIN').fill('29AAPFU0939F1ZV');
await page.getByLabel('PIN code').fill('12');
await page.keyboard.press('Control+s');
await page.getByText('Please fix the highlighted fields').waitFor();
await shot('04-validation');
await page.getByLabel('GSTIN').fill('');
await page.getByLabel('PIN code').fill('411001');
await page.getByLabel('City').fill('Pune');
await page.keyboard.press('Control+s');
await page.getByText('Contact created').waitFor();
await shot('05-created');
await page.getByLabel('City').fill('Mumbai');
await page.keyboard.press('Control+s');
await page.getByText('Changes saved').waitFor();
await page.getByRole('tab', { name: 'history' }).click();
await page.getByText('Edited').waitFor();
await shot('06-history');
await page.keyboard.press('Escape');
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
await shot('07-list-keyboard');
await page.keyboard.press('Control+k');
await page.keyboard.type('steel');
await page.getByText('Lakshmi Steel Works').waitFor();
await shot('08-palette');
await page.keyboard.press('Escape');
await page.goto(B + '/m/base.product');
await page.getByText('Copper wire').waitFor();
await page.getByText('Copper wire').click();
await page.getByText('Pricing & tax').waitFor();
await page.waitForTimeout(300);
await shot('09-products-panel');
await page.goto(B + '/settings/license');
await page.getByText('Trial ends').waitFor();
await shot('10-license');

const dark = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
const dp = await dark.newPage();
await dp.goto(B);
await dp.evaluate((t) => localStorage.setItem('osuite.token', t), token);
await dp.goto(B + '/m/base.contact?id=1');
await dp.getByText('Tax & credit').waitFor();
await dp.waitForTimeout(300);
await dp.screenshot({ path: `${OUT}/11-dark.png` });

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mp = await mobile.newPage();
await mp.goto(B);
await mp.evaluate((t) => localStorage.setItem('osuite.token', t), token);
await mp.goto(B + '/m/base.contact');
await mp.getByRole('table').waitFor();
await mp.screenshot({ path: `${OUT}/12-mobile.png` });
const overflow = await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
console.log('mobile horizontal page overflow:', overflow);
console.log('console errors:', errors.length ? errors : 'none');
await browser.close();
