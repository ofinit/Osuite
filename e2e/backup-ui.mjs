// Browser walkthrough of the backup and restore against a FRESH
// product DB, server run with OSUITE_LICENSE=off and OSUITE_WEB_DIST=apps/web/dist,
// OSUITE_DATA_DIR=.data/e2e-backup.
// Usage: node e2e/backup-ui.mjs <screenshot-dir>
import { rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright-core';

const OUT = process.argv[2];
const B = 'http://127.0.0.1:47800';
const dataDir = resolve(import.meta.dirname, '../.data/e2e-backup');
rmSync(join(dataDir, 'backups'), { recursive: true, force: true });
rmSync(join(dataDir, 'backup.json'), { force: true });
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
const acme = await api('POST', '/records/base.contact', { name: 'Acme Industries', stateCode: '27' });
await api('POST', '/records/base.contact', { name: 'Before Backup Ltd' });
const contacts = async () => (await api('GET', '/records/base.contact')).total;

const browser = await chromium.launch({ channel: 'msedge', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
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
const signIn = async () => {
  await page.getByLabel('Login').fill('priya');
  await page.getByLabel('Password').fill('priya12345');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.getByRole('navigation', { name: 'Main' }).waitFor();
  token = await page.evaluate(() => localStorage.getItem('osuite.token'));
};
await page.goto(B);
await page.evaluate((t) => localStorage.setItem('osuite.token', t), token);

// Back up from the sidebar.
await page.goto(B);
await page.getByRole('link', { name: 'Backups' }).click();
await page.getByText('No backups yet.').waitFor();
await page.getByRole('button', { name: 'Back up now' }).click();
await page.getByText(/^Backup taken/).waitFor();
check((await page.getByRole('cell', { name: 'Manual' }).count()) === 1, 'manual backup listed');

// Schedule with a copy folder.
await page.getByPlaceholder(/OSuite backups/).fill(join(dataDir, 'copies'));
await page.getByRole('button', { name: 'Save schedule' }).click();
await page.getByText('Backup settings saved.').waitFor();
await page.screenshot({ path: `${OUT}/k01-backups.png` });

// Change data, then restore from the list.
await api('POST', '/records/base.contact', { name: 'After Backup Ltd' });
check((await contacts()) === 3, 'three contacts before restoring');
await page.getByRole('row', { name: /Manual/ }).getByRole('button', { name: 'Restore' }).click();
await page.getByText('Backup restored (Ofin Demo Traders). Sign in to continue.').waitFor();
await page.screenshot({ path: `${OUT}/k02-restored-sign-in.png` });
await signIn();
check((await contacts()) === 2, 'restore took the data back to the backup');

// Download a backup, then restore it from the file.
await page.goto(`${B}/settings/backups`);
const [download] = await Promise.all([
  page.waitForEvent('download'),
  page.getByRole('row', { name: /Manual/ }).getByRole('button', { name: /^Download/ }).click(),
]);
const file = join(dataDir, 'downloaded.osbak');
await download.saveAs(file);
await api('POST', '/records/base.contact', { name: 'Another One Ltd' });
await page.getByLabel('Backup file').setInputFiles(file);
await page.getByText('Backup restored (Ofin Demo Traders). Sign in to continue.').waitFor();
await signIn();
check((await contacts()) === 2, 'restore from a downloaded file');
await page.goto(`${B}/settings/backups`);
await page.getByRole('cell', { name: 'From a file' }).waitFor();
check((await page.getByRole('row', { name: /From a file/ }).getByText('Ofin Demo Traders').count()) === 1, 'restored upload now shows its company');
check((await page.getByRole('cell', { name: 'Before a restore' }).count()) === 2, 'each restore kept a safety backup');
await page.screenshot({ path: `${OUT}/k03-backups-after.png` });
void acme;

console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
