// Desktop mode: the server owns a private PostgreSQL cluster inside the data
// directory, listening on loopback only with a generated password.
import { execFileSync, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

export interface EmbeddedPg {
  databaseUrl: string;
  stop(): void;
}

const DB_NAME = 'osuite';
const SUPERUSER = 'osuite';

export async function startEmbeddedPg(pgBin: string, dataDir: string, port: number): Promise<EmbeddedPg> {
  const exe = (name: string) => join(pgBin, process.platform === 'win32' ? `${name}.exe` : name);
  const clusterDir = join(dataDir, 'pg');
  const passFile = join(dataDir, 'pg.secret');
  const logFile = join(dataDir, 'pg.log');

  if (!existsSync(join(clusterDir, 'PG_VERSION'))) {
    const password = randomBytes(24).toString('base64url');
    writeFileSync(passFile, password, { mode: 0o600 });
    const pwTmp = join(dataDir, 'pg.pwinit');
    writeFileSync(pwTmp, password, { mode: 0o600 });
    try {
      execFileSync(
        exe('initdb'),
        ['-D', clusterDir, '-U', SUPERUSER, '--auth=scram-sha-256', `--pwfile=${pwTmp}`, '-E', 'UTF8', '--locale=C'],
        { stdio: 'ignore', windowsHide: true },
      );
    } finally {
      rmSync(pwTmp, { force: true });
    }
  }
  const password = readFileSync(passFile, 'utf8').trim();
  // stdout must not be a pipe: the postmaster inherits pg_ctl's handles on Windows,
  // so a pipe would never close. pg_ctl's own messages go to a file instead.
  const ctlLog = join(dataDir, 'pg_ctl.log');
  const ctl = (args: string[]) => {
    const fd = openSync(ctlLog, 'w');
    try {
      return spawnSync(exe('pg_ctl'), args, { stdio: ['ignore', fd, fd], windowsHide: true });
    } finally {
      closeSync(fd);
    }
  };
  const ctlOutput = () => {
    try {
      return readFileSync(ctlLog, 'utf8').trim();
    } catch {
      return '';
    }
  };

  // A cluster left running (e.g. after a crash) keeps the port it started on.
  let pgPort = port;
  if (ctl(['status', '-D', clusterDir]).status === 0) {
    const pidLines = readFileSync(join(clusterDir, 'postmaster.pid'), 'utf8').split(/\r?\n/);
    pgPort = Number(pidLines[3]) || port;
  } else {
    // stdio must be ignored: the postmaster inherits pg_ctl's handles on Windows.
    const r = ctl(['start', '-D', clusterDir, '-l', logFile, '-w', '-t', '60', '-o', `-p ${port} -h 127.0.0.1`]);
    if (r.status !== 0) throw new Error(`PostgreSQL failed to start (${r.error?.message ?? `exit ${r.status}`}): ${ctlOutput() || `see ${logFile}`}`);
  }

  const auth = `${SUPERUSER}:${encodeURIComponent(password)}@127.0.0.1:${pgPort}`;
  const admin = new pg.Client({ connectionString: `postgres://${auth}/postgres` });
  await admin.connect();
  try {
    const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [DB_NAME]);
    if (!rowCount) await admin.query(`create database ${DB_NAME}`);
  } finally {
    await admin.end();
  }

  return {
    databaseUrl: `postgres://${auth}/${DB_NAME}`,
    stop: () => void ctl(['stop', '-D', clusterDir, '-m', 'fast', '-w']),
  };
}
