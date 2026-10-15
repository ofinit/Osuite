// The marketing website shows prices and business details from the admin panel
// and picks up changes WITHOUT a rebuild. Runs the built site (apps/site/dist,
// built against this admin API) with `astro preview` on :4321 and a FRESH admin DB.
// Usage: node e2e/site-ui.mjs <screenshot-dir>
import { execFileSync, spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const OUT = process.argv[2];
const ADMIN = 'http://127.0.0.1:47900';
const SITE = 'http://127.0.0.1:4321';
const root = resolve(import.meta.dirname, '..');
const check = (cond, msg) => {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  console.log(`ok  ${msg}`);
};
let cookie = '';
async function admin(method, path, body) {
  const r = await fetch(ADMIN + path, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = r.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  if (!r.ok) throw new Error(`${path}: ${await r.text()}`);
  return r.json();
}

// Starting values, then a build of the site against them.
await admin('POST', '/admin/auth/login', { email: 'owner@osuite.local', password: 'owner-password' });
await admin('PATCH', '/admin/plans/business', { priceYearly: '24990', priceMonthly: '2499', tagline: 'For a trading business with a small team.' });
await admin('PUT', '/admin/business', { supportEmail: 'support@osuite.business', city: 'Pune', supportHours: 'Monday to Saturday, 10 am to 7 pm' });
execFileSync('npx astro build', { cwd: join(root, 'apps/site'), shell: true, stdio: 'ignore', env: { ...process.env, SITE_API: ADMIN } });
const preview = spawn('npx astro preview --host 127.0.0.1 --port 4321', { cwd: join(root, 'apps/site'), shell: true, stdio: 'ignore' });
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(SITE)).ok) break;
  } catch {}
  await new Promise((r) => setTimeout(r, 500));
}

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const stop = () => {
  try {
    execFileSync('taskkill', ['/PID', String(preview.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {}
};
const onFailure = async (e) => {
  console.error(e.message);
  await page.screenshot({ path: `${OUT}/FAILED.png` }).catch(() => {});
  stop();
  process.exit(1);
};
process.on('unhandledRejection', onFailure);
process.on('uncaughtException', onFailure);

const priceCell = () => page.locator('.card[data-plan-col="business"] [data-plan-field="priceYearly"]');
await page.goto(`${SITE}/pricing`);
await priceCell().waitFor();
check((await priceCell().innerText()) === '₹24,990', 'built page shows the price from the admin panel');
const footEmail = async () => page.locator('.foot-contact [data-biz="supportEmail"]').innerText();
check((await footEmail()) === 'support@osuite.business', 'footer shows the support email');

// Change things in the admin panel; the built site is not touched.
await admin('PATCH', '/admin/plans/business', { priceYearly: '27990', tagline: 'For growing teams that bill every day.' });
await admin('PUT', '/admin/business', { supportEmail: 'help@osuite.business', phone: '+91 20 1111 2222' });
await page.reload();
await page.waitForFunction(() => document.querySelector('.card[data-plan-col="business"] [data-plan-field="priceYearly"]')?.textContent === '₹27,990');
check(true, 'new price appears after a reload, without rebuilding');
check((await page.locator('.card[data-plan-col="business"] [data-plan-field="tagline"]').innerText()) === 'For growing teams that bill every day.', 'new plan text appears');
await page.waitForFunction(() => document.querySelector('.foot-contact [data-biz="supportEmail"]')?.textContent === 'help@osuite.business');
check((await footEmail()) === 'help@osuite.business', 'footer email follows the admin panel');
check((await page.locator('.foot-contact a[data-biz-href="mailto:supportEmail"]').getAttribute('href')) === 'mailto:help@osuite.business', 'and so does its link');
await page.goto(`${SITE}/contact`);
await page.locator('.ways-list').getByText('+91 20 1111 2222').waitFor();
check(true, 'a phone number added later appears on the contact page');

// Clearing an optional detail removes its line; a plan no longer offered disappears.
await admin('PUT', '/admin/business', { supportHours: '' });
await admin('PATCH', '/admin/plans/enterprise', { active: false });
await page.goto(`${SITE}/pricing`);
await page.waitForFunction(() => document.querySelector('.card[data-plan-col="business"] [data-plan-field="priceYearly"]')?.textContent === '₹27,990');
await page.waitForTimeout(500);
check((await page.locator('[data-plan-col="enterprise"]').count()) === 1 && (await page.locator('[data-plan-col="enterprise"]:visible').count()) === 0, 'a plan taken off sale disappears');
check(await page.locator('.foot-contact [data-biz-if="supportHours"]').isHidden(), 'clearing an optional detail removes its line');
check((await page.locator('.foot-meta [data-biz="legalName"]').innerText()).length > 0, 'required details are never blanked');

// The live invoice on the home page uses OSuite's own GST code.
await page.goto(SITE);
const sheet = page.locator('[data-live-invoice]');
await sheet.getByText('IGST 18%').waitFor();
await page.getByRole('radio', { name: 'Maharashtra' }).check();
await sheet.getByText('CGST 9%').waitFor();
check((await sheet.locator('[data-out="total"]').innerText()) === '8,260.00', 'same state: CGST + SGST, same total');
await page.locator('input[data-live="qty"]').fill('125000');
await sheet.getByText('Rupees Twenty Lakh Sixty Five Thousand Only').waitFor();
check(true, 'amount in words in lakh');
await page.screenshot({ path: `${OUT}/site-home.png` });

console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
stop();
process.exit(errors.length ? 1 : 0);
