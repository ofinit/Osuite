// Browser walkthrough of user roles against a FRESH product DB, server run with
// OSUITE_LICENSE=off and OSUITE_WEB_DIST=apps/web/dist.
// Usage: node e2e/roles-ui.mjs <screenshot-dir>
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
const adminToken = token;
const bolt = await api('POST', '/records/base.product', { name: 'Steel bolt M8', kind: 'goods', hsnCode: '7318', salePrice: '9', costPrice: '4', gstRate: '18' });
const adj = await api('POST', '/records/stock.adjustment', { reason: 'opening', lines: [{ productId: bolt.id, qty: '100', unitCost: '4' }] });
await api('POST', `/records/stock.adjustment/${adj.id}/actions/post`);
const acme = await api('POST', '/records/base.contact', { name: 'Acme Industries', stateCode: '27' });
const inv = await api('POST', '/records/sales.invoice', {
  customerId: acme.id,
  placeOfSupply: '27',
  lines: [{ productId: bolt.id, description: 'Steel bolt M8', hsnCode: '7318', qty: '10', unitPrice: '9', gstRate: '18' }],
});
await api('POST', `/records/sales.invoice/${inv.id}/actions/post`);

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
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
const signInAs = async (t) => {
  await page.goto(B);
  await page.evaluate((v) => localStorage.setItem('osuite.token', v), t);
  await page.goto(B);
};

// The administrator adds a billing clerk.
await signInAs(adminToken);
await page.getByRole('link', { name: 'Users and roles' }).click();
await page.getByRole('heading', { name: 'Users' }).waitFor();
await page.getByRole('button', { name: 'Add user' }).click();
await page.getByLabel('Name').fill('Sunita Clerk');
await page.getByLabel('Login').fill('sunita');
await page.getByLabel('Temporary password').fill('sunita12345');
await page.getByLabel('Role').selectOption({ label: 'Sales and billing' });
await page.getByRole('button', { name: 'Add user' }).click();
await page.getByRole('cell', { name: 'Sunita Clerk' }).waitFor();
check((await page.getByRole('combobox', { name: 'Role of Sunita Clerk' }).inputValue()) !== '', 'clerk added with a role');
await page.screenshot({ path: `${OUT}/r01-users.png` });

// Roles are records the administrator can open and change.
await page.getByRole('link', { name: 'Roles', exact: true }).click();
await page.getByRole('cell', { name: 'Sales and billing' }).click();
await page.getByLabel('Accounts & reports').waitFor();
check((await page.getByLabel('Accounts & reports').evaluate((el) => el.selectedOptions[0]?.text)) === 'No access', 'role form shows what each area allows');
await page.screenshot({ path: `${OUT}/r02-role.png` });

// The clerk's view.
token = null;
const clerk = await api('POST', '/auth/login', { login: 'sunita', password: 'sunita12345' });
await signInAs(clerk.token);
await page.getByRole('heading', { name: /Sunita/ }).waitFor();
const nav = page.getByRole('navigation', { name: 'Main' });
await nav.getByRole('link', { name: 'Invoices' }).waitFor();
await page.getByText('Customers owe you').waitFor();
check((await nav.getByRole('link', { name: 'Invoices' }).count()) === 1, 'clerk sees Sales');
check((await nav.getByRole('link', { name: 'Profit & loss' }).count()) === 0 && (await nav.getByRole('link', { name: 'Bills' }).count()) === 0, 'but not accounts or purchases');
check((await page.getByRole('link', { name: 'Users and roles' }).count()) === 0, 'and no settings');
check((await page.getByText('Customers owe you').count()) === 1 && (await page.getByText(/Profit in FY|Loss in FY/).count()) === 0, 'dashboard has no profit figure');
check((await page.getByRole('link', { name: 'New bill' }).count()) === 0 && (await page.getByRole('link', { name: 'New invoice' }).count()) === 1, 'quick buttons follow the role');
await page.screenshot({ path: `${OUT}/r03-clerk-home.png` });

await page.goto(`${B}/m/sales.invoice?id=${inv.id}`);
await page.getByRole('link', { name: 'Print' }).waitFor();
check((await page.getByRole('button', { name: 'Cancel invoice' }).count()) === 0, 'no cancel button on a posted invoice');
check((await page.getByRole('link', { name: 'Issue credit note' }).count()) === 1, 'but a credit note can be raised');
await page.goto(`${B}/m/purchase.bill`);
await page.getByText('Your role does not include bills').waitFor();
check(true, 'opening bills directly explains the role');
await page.screenshot({ path: `${OUT}/r04-clerk-no-bills.png` });

console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
if (errors.length) process.exit(1);
