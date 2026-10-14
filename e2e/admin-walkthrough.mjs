// Browser walkthrough of the admin panel against a FRESH admin DB, with the
// admin API serving the built admin web (ADMIN_WEB_DIST=apps/admin-web/dist).
// Start the admin API with RAZORPAY_WEBHOOK_SECRET=whsec_test (webhook checks).
// Usage: node e2e/admin-walkthrough.mjs <screenshot-dir>   (uses installed Microsoft Edge)
import { createHmac } from 'node:crypto';
import { chromium } from 'playwright-core';

const OUT = process.argv[2];
const A = 'http://127.0.0.1:47900';
const post = (path, body) =>
  fetch(A + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => {
    const data = await r.json();
    if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(data)}`);
    return data;
  });
const webhook = (evt, eventId) => {
  const body = JSON.stringify(evt);
  return fetch(A + '/webhooks/razorpay', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-razorpay-signature': createHmac('sha256', 'whsec_test').update(body).digest('hex'),
      'x-razorpay-event-id': eventId,
    },
    body,
  }).then((r) => r.json());
};
const payload = (token) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
const check = (cond, msg) => {
  if (!cond) throw new Error(`CHECK FAILED: ${msg}`);
  console.log(`ok  ${msg}`);
};

// Two customers start trials from their desktop apps.
const fpKaveri = 'a'.repeat(32);
const kaveri = await post('/v1/trial', { name: 'Meena Rao', email: 'meena@kaveriagro.in', company: 'Kaveri Agro Foods', fingerprint: fpKaveri, hostname: 'KAVERI-PC' });
await post('/v1/trial', { name: 'Arjun Shah', email: 'arjun@sunrisepharma.in', company: 'Sunrise Pharma', fingerprint: 'b'.repeat(32), hostname: 'SUNRISE-01' });

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => void (d.type() === 'prompt' ? d.accept('REVOKE') : d.accept()));
const shot = (n, p = page) => p.screenshot({ path: `${OUT}/${n}.png` });
// A failed top-level await surfaces as an uncaught exception, not a rejection.
const onFailure = async (e) => {
  console.error(e.message);
  await page.screenshot({ path: `${OUT}/FAILED.png` }).catch(() => {});
  process.exit(1);
};
process.on('unhandledRejection', onFailure);
process.on('uncaughtException', onFailure);

// Sign in.
await page.goto(A);
await page.getByLabel('Email').fill('owner@osuite.local');
await page.getByLabel('Password').fill('wrong-password');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByText('Incorrect email or password').waitFor();
await page.getByLabel('Password').fill('owner-password');
await page.getByRole('button', { name: 'Sign in' }).click();
await page.getByText('Monthly recurring revenue').waitFor();
await shot('a01-dashboard-trials');

// New customer, then issue a yearly cloud licence.
await page.getByRole('link', { name: 'Customers' }).click();
await page.getByRole('button', { name: 'Add customer' }).click();
await page.getByLabel('Contact name').fill('Ravi Kumar');
await page.getByLabel('Email').fill('ravi@acme.in');
await page.getByLabel('Company').fill('Acme Industries');
await page.getByRole('button', { name: 'Add customer' }).click();
await page.getByRole('heading', { name: 'Acme Industries' }).waitFor();
await page.getByLabel('Plan').selectOption('business');
await page.getByLabel('Hosting').selectOption('cloud');
await page.getByText('per year, before GST').waitFor();
await shot('a02-issue-licence');
await page.getByRole('button', { name: 'Issue licence' }).click();
await page.getByText('Licence key', { exact: true }).waitFor();
const key = (await page.locator('dd span.tracking-wider').innerText()).trim();
check(/^OSX(-[A-Z2-9]{4}){4}$/.test(key), `licence issued with key ${key}`);

// The customer activates it; staff then frees the computer.
await post('/v1/activate', { key, fingerprint: 'c'.repeat(32), hostname: 'ACME-ACCOUNTS', appVersion: '0.1.0' });
await page.reload();
await page.getByRole('cell', { name: /ACME-ACCOUNTS/ }).waitFor();
check((await page.getByText('1 of 1 in use').count()) === 1, 'activation shows on licence page');
await page.getByRole('button', { name: 'Remove' }).click();
await page.getByText('0 of 1 in use').waitFor();
check(true, 'computer removed');
await page.getByRole('button', { name: '+ 1 month' }).click();
await page.getByText('Renewed').first().waitFor();
const acmeUrl = page.url();
const acmeId = acmeUrl.split('/').pop();
const renewed = await page.evaluate((id) => fetch(`/admin/licenses/${id}`).then((r) => r.json()), acmeId);
check(renewed.license.billingCycle === 'yearly', 'manual renewal keeps yearly billing');
await shot('a03-licence-detail');

// Convert a trial; the customer's next check-in picks up the paid plan.
await page.getByRole('link', { name: 'Licences' }).click();
await page.getByRole('tab', { name: 'Trial' }).click();
await page.getByRole('link', { name: 'Kaveri Agro Foods' }).click();
await page.getByRole('heading', { name: 'Convert to paid' }).waitFor();
await page.getByLabel('Plan').selectOption('starter');
await page.getByRole('button', { name: 'Convert to paid' }).click();
await page.getByText('Converted from trial').waitFor();
const refreshed = await post('/v1/checkin', { token: kaveri.token, fingerprint: fpKaveri });
check(payload(refreshed.token).plan === 'starter', 'trial install receives the paid plan on check-in');

// A Razorpay payment for the other trial converts it to the plan in the notes.
const sunrise = (await page.evaluate(() => fetch('/admin/licenses?q=sunrise').then((r) => r.json())))[0];
await webhook(
  { event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_sunrise', notes: { license_id: sunrise.id, plan_id: 'business', cycle: 'yearly' } } }, payment: { entity: { id: 'pay_1' } } } },
  'evt_sunrise_1',
);
const sunriseAfter = await page.evaluate((id) => fetch(`/admin/licenses/${id}`).then((r) => r.json()), sunrise.id);
check(sunriseAfter.license.planId === 'business' && sunriseAfter.license.billingCycle === 'yearly', 'payment converts a trial to the paid plan');

// Revoking holds even if a payment arrives afterwards.
await page.goto(acmeUrl);
await page.getByRole('button', { name: 'Revoke' }).click();
await page.getByText('This licence is revoked').waitFor();
const beforePay = await page.evaluate((id) => fetch(`/admin/licenses/${id}`).then((r) => r.json()), acmeId);
await webhook(
  { event: 'subscription.charged', payload: { subscription: { entity: { id: 'sub_acme', notes: { license_id: acmeId } } }, payment: { entity: { id: 'pay_2' } } } },
  'evt_acme_1',
);
const afterPay = await page.evaluate((id) => fetch(`/admin/licenses/${id}`).then((r) => r.json()), acmeId);
check(
  afterPay.license.status === 'revoked' && afterPay.license.currentPeriodEnd === beforePay.license.currentPeriodEnd,
  'payment does not revive a revoked licence',
);

// Owner edits a price.
await page.getByRole('link', { name: 'Plans' }).click();
const starterMonthly = page.getByLabel('Starter priceMonthly');
await starterMonthly.fill('899');
const [saveRes] = await Promise.all([
  page.waitForResponse((r) => r.url().endsWith('/admin/plans/starter') && r.request().method() === 'PATCH'),
  page.getByRole('row', { name: /Starter/ }).getByRole('button', { name: 'Save' }).click(),
]);
check(saveRes.ok(), `plan save request succeeded (${saveRes.status()} ${saveRes.ok() ? '' : await saveRes.text()})`);
await page.reload();
check((await page.getByLabel('Starter priceMonthly').inputValue()) === '899', 'plan price saved');
await shot('a04-plans');

// Owner adds staff; staff cannot change plans or see the team.
await page.getByRole('link', { name: 'Team' }).click();
await page.getByRole('button', { name: 'Add person' }).click();
await page.getByLabel('Name').fill('Support Desk');
await page.getByLabel('Email').fill('support@osuite.local');
await page.getByLabel('Temporary password').fill('support-pass-1');
await page.getByRole('button', { name: 'Add person' }).click();
await page.getByText('support@osuite.local').waitFor();
await page.getByRole('link', { name: 'Overview' }).click();
await page.getByText('Monthly recurring revenue').waitFor();
await shot('a05-dashboard-paying');

const staffCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const sp = await staffCtx.newPage();
await sp.goto(A);
await sp.getByLabel('Email').fill('support@osuite.local');
await sp.getByLabel('Password').fill('support-pass-1');
await sp.getByRole('button', { name: 'Sign in' }).click();
await sp.getByText('Monthly recurring revenue').waitFor();
check((await sp.getByRole('link', { name: 'Team' }).count()) === 0, 'staff do not see Team');
await sp.getByRole('link', { name: 'Plans' }).click();
await sp.getByText('Only the owner can change plans.').waitFor();
check((await sp.locator('table input').count()) === 0, 'staff see plans read-only');
const forbidden = await sp.evaluate(() => fetch('/admin/plans/starter', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: '{"priceMonthly":"1"}' }).then((r) => r.status));
check(forbidden === 403, 'API rejects plan edits from staff');

const mobile = await browser.newContext({ viewport: { width: 390, height: 844 } });
const mp = await mobile.newPage();
await mp.goto(A);
await mp.getByLabel('Email').fill('owner@osuite.local');
await mp.getByLabel('Password').fill('owner-password');
await mp.getByRole('button', { name: 'Sign in' }).click();
await mp.getByText('Monthly recurring revenue').waitFor();
check(!(await mp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)), 'no horizontal overflow on phone');
await shot('a06-mobile', mp);

console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
