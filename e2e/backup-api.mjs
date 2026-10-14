// API checks for backup and restore against a FRESH product DB, server run with
// OSUITE_LICENSE=off and OSUITE_DATA_DIR=.data/e2e-backup.   Usage: node e2e/backup-api.mjs
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const B = 'http://127.0.0.1:47800/api';
const dataDir = resolve(import.meta.dirname, '../.data/e2e-backup');
const copyDir = join(dataDir, 'copies');
rmSync(join(dataDir, 'backups'), { recursive: true, force: true });
rmSync(join(dataDir, 'backup.json'), { force: true });
rmSync(copyDir, { recursive: true, force: true });

let token;
async function api(method, path, body, raw) {
  const r = await fetch(B + path, {
    method,
    headers: {
      ...(raw ? { 'content-type': 'application/octet-stream' } : body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: raw ?? (body ? JSON.stringify(body) : undefined),
  });
  if (path.endsWith('/download')) return { status: r.status, bytes: new Uint8Array(await r.arrayBuffer()) };
  const t = await r.text();
  return { status: r.status, body: t ? JSON.parse(t) : null };
}
let failed = 0;
const check = (cond, msg, extra) => {
  console.log(`${cond ? 'ok ' : 'FAIL'} ${msg}${cond || extra === undefined ? '' : `  -> ${JSON.stringify(extra).slice(0, 500)}`}`);
  if (!cond) failed++;
};
const create = async (model, values) => {
  const r = await api('POST', `/records/${model}`, values);
  if (r.status !== 201) throw new Error(`${model}: ${JSON.stringify(r.body)}`);
  return r.body;
};
const post = async (model, id) => (await api('POST', `/records/${model}/${id}/actions/post`)).body;
const login = async (l = 'admin', p = 'admin1234') => (token = (await api('POST', '/auth/login', { login: l, password: p })).body.token);
const invoiceCount = async () => (await api('GET', '/records/sales.invoice')).body.total;

await api('POST', '/setup', { companyName: 'Ofin Demo Traders', gstin: '27AAPFU0939F1ZV', stateCode: '27', adminName: 'Admin', login: 'admin', password: 'admin1234' });
await login();
const svc = await create('base.product', { name: 'Consulting', kind: 'service', hsnCode: '9983', salePrice: '1000' });
const acme = await create('base.contact', { name: 'Acme Industries', stateCode: '27' });
const invoice = async () =>
  post('sales.invoice', (await create('sales.invoice', { customerId: acme.id, placeOfSupply: '27', lines: [{ productId: svc.id, description: 'Consulting', qty: '1', unitPrice: '1000', gstRate: '18' }] })).id);
await invoice();

// ---------------------------------------------------------------- backing up
let r = await api('GET', '/backups');
check(r.status === 200 && r.body.available && r.body.backups.length === 0 && r.body.settings.auto === true, 'backups available, none yet, daily on by default', r.body);
r = await api('POST', '/backups');
const first = r.body;
check(r.status === 201 && /^osuite-manual-\d{8}-\d{6}\.osbak$/.test(first.name) && first.company === 'Ofin Demo Traders' && first.size > 1000, 'manual backup taken', r.body);
check(first.schema > 0, 'backup records its schema version', first.schema);
await invoice();
check((await invoiceCount()) === 2, 'second invoice after the backup');

// ---------------------------------------------------------------- restoring
r = await api('POST', `/backups/${first.name}/restore`);
check(r.status === 200 && r.body.company === 'Ofin Demo Traders' && /^osuite-before-restore-/.test(r.body.safetyBackup), 'restore succeeds after a safety backup', r.body);
const safety = r.body.safetyBackup;
check((await api('GET', '/backups')).status === 401, 'sessions are not restored: sign in again');
await login();
check((await invoiceCount()) === 1, 'data is back to the backup (one invoice)');
r = await api('GET', '/audit/verify');
check(r.body.ok, 'audit chain intact after restore', r.body);
const next = await invoice();
check(next.number.endsWith('/0002'), 'numbering continues from the backup', next.number);

r = await api('POST', `/backups/${safety}/restore`);
check(r.status === 200, 'restore the safety backup', r.body);
await login();
check((await invoiceCount()) === 2, 'undo: both original invoices are back');

// ---------------------------------------------------------------- download / upload
r = await api('GET', '/backups');
check(r.body.backups.map((b) => b.kind).sort().join() === 'before-restore,before-restore,manual', 'list shows the manual and safety backups', r.body.backups);
const dl = await api('GET', `/backups/${first.name}/download`);
check(dl.status === 200 && dl.bytes.length === first.size, 'download returns the whole file', dl.bytes.length);
r = await api('POST', '/backups/upload', null, dl.bytes);
check(r.status === 201 && r.body.kind === 'uploaded', 'uploaded backup accepted', r.body);
const uploaded = r.body.name;
r = await api('POST', '/backups/upload', null, new TextEncoder().encode('definitely not a backup'));
check(r.status === 400 && /not an OSuite backup/.test(r.body.error), 'garbage upload refused', r.body);
check((await api('GET', '/backups')).body.backups.length === 4, 'refused upload left nothing behind');
r = await api('POST', `/backups/${uploaded}/restore`);
await login();
check(r.status === 200 && (await invoiceCount()) === 1, 'uploaded backup restores', r.body);

// ---------------------------------------------------------------- traffic during a restore
{
  const statuses = [];
  let done = false;
  const restoring = api('POST', `/backups/${first.name}/restore`).then((x) => ((done = true), x));
  const reader = async () => {
    while (!done) {
      statuses.push((await api('GET', '/records/sales.invoice')).status);
      await new Promise((res) => setTimeout(res, 20));
    }
  };
  await Promise.all([reader(), reader(), reader()]);
  r = await restoring;
  check(r.status === 200, 'restore under concurrent reads succeeds', r.body);
  check(statuses.every((s) => [200, 401, 503].includes(s)), 'concurrent requests get 200, 401 or 503, never an error', [...new Set(statuses)]);
  await login();
  check((await api('GET', '/health')).status === 200 && (await invoiceCount()) === 1, 'server healthy after the swap');
}

// ---------------------------------------------------------------- guards
check((await api('POST', '/backups/..%2F..%2Fpg.secret/restore')).status === 400, 'path tricks refused');
check((await api('GET', '/backups/osuite-manual-20000101-000000.osbak/download')).status === 404, 'unknown backup is 404');
await create('base.contact', { name: 'x' }); // keep a write after restore working
const clerk = await api('POST', '/users', { name: 'Clerk', login: 'clerk', password: 'clerk12345', isAdmin: false });
check(clerk.status === 201, 'clerk created', clerk.body);
const adminToken = token;
await login('clerk', 'clerk12345');
check((await api('GET', '/backups')).status === 403 && (await api('POST', '/backups')).status === 403, 'non-admins cannot back up or restore');
token = adminToken;

// ---------------------------------------------------------------- settings and copies
check((await api('PUT', '/backups/settings', { copyTo: 'relative\\folder' })).status === 400, 'relative copy folder refused');
check((await api('PUT', '/backups/settings', { keep: 0 })).status === 400, 'keep must be at least 1');
r = await api('PUT', '/backups/settings', { copyTo: copyDir, keep: 5 });
check(r.status === 200 && r.body.copyTo === copyDir && r.body.keep === 5, 'settings saved', r.body);
const second = (await api('POST', '/backups')).body;
check(existsSync(join(copyDir, second.name)), 'backup copied to the second folder', readdirSync(copyDir));
r = await api('DELETE', `/backups/${second.name}`);
check(r.status === 204 && !(await api('GET', '/backups')).body.backups.some((b) => b.name === second.name), 'backup deleted');
mkdirSync(copyDir, { recursive: true });

console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed');
process.exit(failed ? 1 : 0);
