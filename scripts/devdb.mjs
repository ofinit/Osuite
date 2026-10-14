// Manages a project-local PostgreSQL cluster for development (mirrors the
// bundled-Postgres layout the desktop app uses in production).
//   node scripts/devdb.mjs start | stop | status
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dataDir = join(root, '.data', 'pg');
const logFile = join(root, '.data', 'pg.log');
const port = process.env.OSUITE_PG_PORT ?? '54329';
const pgBin =
  process.env.PG_BIN ??
  (process.platform === 'win32' ? 'C:\\Program Files\\PostgreSQL\\17\\bin' : '/usr/lib/postgresql/17/bin');
const exe = (name) => join(pgBin, process.platform === 'win32' ? `${name}.exe` : name);
const databases = ['osuite', 'osuite_admin'];

function run(name, args, opts = {}) {
  return spawnSync(exe(name), args, { encoding: 'utf8', ...opts });
}

function isRunning() {
  return run('pg_ctl', ['status', '-D', dataDir]).status === 0;
}

function start() {
  if (!existsSync(join(dataDir, 'PG_VERSION'))) {
    mkdirSync(dataDir, { recursive: true });
    console.log(`initdb -> ${dataDir}`);
    execFileSync(exe('initdb'), ['-D', dataDir, '-U', 'osuite', '--auth=trust', '-E', 'UTF8', '--locale=C'], {
      stdio: 'inherit',
    });
  }
  if (!isRunning()) {
    // stdio must be ignored: the postmaster inherits pg_ctl's handles on Windows,
    // so a piped stdout would never close and spawnSync would hang.
    const r = run('pg_ctl', ['start', '-D', dataDir, '-l', logFile, '-w', '-o', `-p ${port} -h 127.0.0.1`], {
      stdio: 'ignore',
    });
    if (r.status !== 0) {
      console.error(`pg_ctl start failed; see ${logFile}`);
      process.exit(1);
    }
  }
  for (const db of databases) {
    const exists = run('psql', ['-h', '127.0.0.1', '-p', port, '-U', 'osuite', '-d', 'postgres', '-tAc',
      `select 1 from pg_database where datname='${db}'`]).stdout.trim() === '1';
    if (!exists) {
      run('createdb', ['-h', '127.0.0.1', '-p', port, '-U', 'osuite', db]);
      console.log(`created database ${db}`);
    }
  }
  console.log(`postgres running: postgres://osuite@127.0.0.1:${port}/{${databases.join(',')}}`);
}

function stop() {
  if (isRunning()) run('pg_ctl', ['stop', '-D', dataDir, '-m', 'fast'], { stdio: 'inherit' });
  console.log('postgres stopped');
}

const cmd = process.argv[2] ?? 'start';
if (cmd === 'start') start();
else if (cmd === 'stop') stop();
else console.log(isRunning() ? 'running' : 'stopped');
