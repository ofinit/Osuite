// Runs every end-to-end suite, each against fresh databases (Windows dev box).
//   node scripts/run-e2e.mjs [screenshot-dir] [suite-name-filter ...]
// Builds the web UIs first, then for each suite: reset DBs, start the services
// it needs, run it, stop the services.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const shots = resolve(process.argv[2] ?? join(root, '.data', 'e2e-shots'));
mkdirSync(shots, { recursive: true });
const sh = (cmd, cwd = root) => execFileSync(cmd, { cwd, stdio: 'inherit', shell: true });

const SERVER = { name: 'server', cwd: 'apps/server', port: 47800, ready: 'OSUITE_READY' };
const ADMIN = { name: 'admin', cwd: 'apps/admin-api', port: 47900, ready: 'Server listening' };

const only = process.argv.slice(3);
const ALL = [
  { file: 'e2e/walkthrough.mjs', services: [[ADMIN, {}], [SERVER, { OSUITE_WEB_DIST: join(root, 'apps/web/dist') }]] },
  { file: 'e2e/admin-walkthrough.mjs', services: [[ADMIN, { ADMIN_WEB_DIST: join(root, 'apps/admin-web/dist') }]] },
  { file: 'e2e/invoice-api.mjs', services: [[SERVER, { OSUITE_LICENSE: 'off' }]] },
  { file: 'e2e/purchase-api.mjs', services: [[SERVER, { OSUITE_LICENSE: 'off' }]] },
  { file: 'e2e/stock-api.mjs', services: [[SERVER, { OSUITE_LICENSE: 'off' }]] },
  { file: 'e2e/payments-api.mjs', services: [[SERVER, { OSUITE_LICENSE: 'off' }]] },
  { file: 'e2e/accounting-api.mjs', services: [[SERVER, { OSUITE_LICENSE: 'off' }]] },
  { file: 'e2e/notes-api.mjs', services: [[SERVER, { OSUITE_LICENSE: 'off' }]] },
  { file: 'e2e/bank-api.mjs', services: [[SERVER, { OSUITE_LICENSE: 'off' }]] },
  { file: 'e2e/closing-api.mjs', services: [[SERVER, { OSUITE_LICENSE: 'off' }]] },
  { file: 'e2e/ledger-api.mjs', services: [[SERVER, { OSUITE_LICENSE: 'off' }]] },
  { file: 'e2e/dashboard-api.mjs', services: [[SERVER, { OSUITE_LICENSE: 'off' }]] },
  { file: 'e2e/backup-api.mjs', services: [[SERVER, { OSUITE_LICENSE: 'off', OSUITE_DATA_DIR: join(root, '.data/e2e-backup') }]] },
  { file: 'e2e/purchase-ui.mjs', services: [[SERVER, { OSUITE_LICENSE: 'off', OSUITE_WEB_DIST: join(root, 'apps/web/dist') }]] },
  { file: 'e2e/stock-ui.mjs', services: [[SERVER, { OSUITE_LICENSE: 'off', OSUITE_WEB_DIST: join(root, 'apps/web/dist') }]] },
  { file: 'e2e/payments-ui.mjs', services: [[SERVER, { OSUITE_LICENSE: 'off', OSUITE_WEB_DIST: join(root, 'apps/web/dist') }]] },
  { file: 'e2e/accounting-ui.mjs', services: [[SERVER, { OSUITE_LICENSE: 'off', OSUITE_WEB_DIST: join(root, 'apps/web/dist') }]] },
  { file: 'e2e/notes-ui.mjs', services: [[SERVER, { OSUITE_LICENSE: 'off', OSUITE_WEB_DIST: join(root, 'apps/web/dist') }]] },
  { file: 'e2e/bank-ui.mjs', services: [[SERVER, { OSUITE_LICENSE: 'off', OSUITE_WEB_DIST: join(root, 'apps/web/dist') }]] },
  { file: 'e2e/closing-ui.mjs', services: [[SERVER, { OSUITE_LICENSE: 'off', OSUITE_WEB_DIST: join(root, 'apps/web/dist') }]] },
  { file: 'e2e/ledger-ui.mjs', services: [[SERVER, { OSUITE_LICENSE: 'off', OSUITE_WEB_DIST: join(root, 'apps/web/dist') }]] },
  { file: 'e2e/dashboard-ui.mjs', services: [[SERVER, { OSUITE_LICENSE: 'off', OSUITE_WEB_DIST: join(root, 'apps/web/dist') }]] },
  { file: 'e2e/backup-ui.mjs', services: [[SERVER, { OSUITE_LICENSE: 'off', OSUITE_WEB_DIST: join(root, 'apps/web/dist'), OSUITE_DATA_DIR: join(root, '.data/e2e-backup') }]] },
  { file: 'e2e/grid-stress.mjs', services: [[SERVER, { OSUITE_LICENSE: 'off', OSUITE_WEB_DIST: join(root, 'apps/web/dist') }]] },
  { file: 'e2e/invoice-ui.mjs', services: [[SERVER, { OSUITE_LICENSE: 'off', OSUITE_WEB_DIST: join(root, 'apps/web/dist') }]] },
];
const SUITES = only.length ? ALL.filter((s) => only.some((o) => s.file.includes(o))) : ALL;

function start(svc, env) {
  const log = join(root, '.data', `${svc.name}.log`);
  writeFileSync(log, '');
  const child = spawn('npx tsx src/main.ts', {
    cwd: join(root, svc.cwd),
    shell: true,
    env: { ...process.env, RAZORPAY_WEBHOOK_SECRET: 'whsec_test', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  const ready = new Promise((res, rej) => {
    const onData = (d) => {
      out += d;
      writeFileSync(log, out);
      if (out.includes(svc.ready)) res();
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('exit', (code) => rej(new Error(`${svc.name} exited (${code}); see ${log}`)));
    setTimeout(() => rej(new Error(`${svc.name} did not start in 60s; see ${log}`)), 60_000);
  });
  return { child, ready };
}

const stop = (child) => {
  try {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    // already gone
  }
};

sh('pnpm --filter @osuite/web build');
sh('pnpm --filter @osuite/admin-web build');

const results = [];
for (const suite of SUITES) {
  console.log(`\n=== ${suite.file}`);
  sh('powershell -NoProfile -ExecutionPolicy Bypass -File scripts/reset-dev.ps1');
  const running = suite.services.map(([svc, env]) => start(svc, env));
  let ok = false;
  try {
    await Promise.all(running.map((r) => r.ready));
    execFileSync(process.execPath, [suite.file, shots], { cwd: root, stdio: 'inherit' });
    ok = true;
  } catch (err) {
    console.error(String(err.message ?? err).split('\n')[0]);
  } finally {
    running.forEach((r) => stop(r.child));
  }
  results.push([suite.file, ok]);
}

console.log('\n=== summary');
for (const [file, ok] of results) console.log(`${ok ? 'PASS' : 'FAIL'}  ${file}`);
console.log(`screenshots: ${shots}`);
process.exit(results.every(([, ok]) => ok) ? 0 : 1);
