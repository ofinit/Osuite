// Database backups (pg_dump custom format) kept in the data folder, optionally
// copied to a second folder, taken daily, and restored safely: the current data
// is backed up first, the backup is restored into a scratch database and checked,
// and only then swapped in for the live one.
import { spawn } from 'node:child_process';
import { copyFileSync, createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { Readable } from 'node:stream';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import type { Config } from '../config.ts';
import { migrationCount, runMigrations, type Db } from '../db/client.ts';
import { appendAudit, verifyAuditChain } from './audit.ts';
import { RecordError } from './errors.ts';

export type BackupKind = 'auto' | 'manual' | 'before-restore' | 'uploaded';

export interface BackupInfo {
  name: string;
  kind: BackupKind;
  createdAt: string;
  size: number;
  company: string | null;
  /** Number of schema migrations the backup was taken at. */
  schema: number | null;
}

export interface BackupSettings {
  /** Take a backup automatically once a day. */
  auto: boolean;
  /** Automatic backups to keep; older ones are deleted. */
  keep: number;
  /** Also copy every backup here: another drive, a USB disk or a synced folder. */
  copyTo: string | null;
}

const DEFAULTS: BackupSettings = { auto: true, keep: 10, copyTo: null };
const EXT = '.osbak';
const NAME = /^osuite-(auto|manual|before-restore|uploaded)-(\d{8}-\d{6})(?:-\d+)?\.osbak$/;
const DAY = 24 * 60 * 60 * 1000;

function stamp(d = new Date()) {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Runs a PostgreSQL client tool; resolves with stdout, rejects with its stderr. */
function runTool(exe: string, args: string[], env: NodeJS.ProcessEnv): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d: Buffer) => (out += d.toString()));
    child.stderr.on('data', (d: Buffer) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => (code === 0 ? resolve(out) : reject(new Error(err.trim() || `${exe} exited with ${code}`))));
  });
}

export function createBackupService(cfg: Config, db: Db, pool: pg.Pool, log: (m: string) => void) {
  const dir = join(cfg.dataDir, 'backups');
  const settingsPath = join(cfg.dataDir, 'backup.json');
  const url = new URL(cfg.databaseUrl);
  const dbName = decodeURIComponent(url.pathname.slice(1));
  const scratchName = `${dbName}_restore`;
  const oldName = `${dbName}_replaced`;
  // Connection details go through the environment so the password is not on a command line.
  const pgEnv = {
    PGHOST: url.hostname,
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
  };
  const tool = (name: string) => {
    if (!cfg.pgTools) throw new RecordError(503, 'Backups are not available: PostgreSQL tools were not found');
    return join(cfg.pgTools, process.platform === 'win32' ? `${name}.exe` : name);
  };
  const adminClient = async () => {
    const c = new pg.Client({ ...pgEnv, host: pgEnv.PGHOST, port: Number(pgEnv.PGPORT), user: pgEnv.PGUSER, password: pgEnv.PGPASSWORD, database: 'postgres' });
    await c.connect();
    return c;
  };

  let busy: string | null = null;
  let timer: NodeJS.Timeout | undefined;
  const exclusive = async <T>(what: string, fn: () => Promise<T>): Promise<T> => {
    if (busy) throw new RecordError(409, `Please wait: ${busy} is in progress`);
    busy = what;
    try {
      return await fn();
    } finally {
      busy = null;
    }
  };

  function settings(): BackupSettings {
    try {
      return { ...DEFAULTS, ...(JSON.parse(readFileSync(settingsPath, 'utf8')) as Partial<BackupSettings>) };
    } catch {
      return { ...DEFAULTS };
    }
  }

  function saveSettings(input: Partial<BackupSettings>): BackupSettings {
    const next = { ...settings(), ...input };
    if (typeof next.auto !== 'boolean') throw new RecordError(400, 'Invalid automatic backup setting');
    if (!Number.isInteger(next.keep) || next.keep < 1 || next.keep > 365) throw new RecordError(400, 'Keep between 1 and 365 automatic backups');
    next.copyTo = next.copyTo?.trim() || null;
    if (next.copyTo) {
      if (!isAbsolute(next.copyTo)) throw new RecordError(400, 'Give the full path of the folder, such as D:\\Backups');
      try {
        mkdirSync(next.copyTo, { recursive: true });
        const probe = join(next.copyTo, '.osuite-write-test');
        writeFileSync(probe, 'ok');
        rmSync(probe);
      } catch {
        throw new RecordError(400, `Cannot write to ${next.copyTo}`);
      }
    }
    writeFileSync(settingsPath, JSON.stringify(next, null, 2));
    return next;
  }

  const metaPath = (name: string) => join(dir, `${name}.json`);
  const pathOf = (name: string) => {
    if (!NAME.test(name)) throw new RecordError(400, 'Invalid backup name');
    const p = join(dir, name);
    if (!existsSync(p)) throw new RecordError(404, 'Backup not found');
    return p;
  };

  function list(): BackupInfo[] {
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((f) => NAME.test(f))
      .map((name) => {
        const st = statSync(join(dir, name));
        let meta: Partial<BackupInfo> = {};
        try {
          meta = JSON.parse(readFileSync(metaPath(name), 'utf8')) as Partial<BackupInfo>;
        } catch {
          /* uploaded or older file: no sidecar */
        }
        return {
          name,
          kind: NAME.exec(name)![1] as BackupKind,
          createdAt: meta.createdAt ?? st.mtime.toISOString(),
          size: st.size,
          company: meta.company ?? null,
          schema: meta.schema ?? null,
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.name.localeCompare(a.name));
  }

  function freshName(kind: BackupKind) {
    mkdirSync(dir, { recursive: true });
    const base = `osuite-${kind}-${stamp()}`;
    let name = `${base}${EXT}`;
    for (let i = 2; existsSync(join(dir, name)); i++) name = `${base}-${i}${EXT}`;
    return name;
  }

  async function companyName(client: pg.Pool) {
    try {
      return ((await client.query<{ name: string }>("select value->>'name' as name from settings where key = 'company'")).rows[0]?.name as string | undefined) ?? null;
    } catch {
      return null;
    }
  }

  async function schemaOf(client: pg.Pool) {
    try {
      return Number((await client.query<{ n: string }>('select count(*) as n from drizzle.__drizzle_migrations')).rows[0]?.n ?? 0);
    } catch {
      return 0;
    }
  }

  function prune() {
    const s = settings();
    const limits: Partial<Record<BackupKind, number>> = { auto: s.keep, 'before-restore': 3 };
    for (const [kind, keep] of Object.entries(limits)) {
      for (const b of list().filter((x) => x.kind === kind).slice(keep)) {
        rmSync(join(dir, b.name), { force: true });
        rmSync(metaPath(b.name), { force: true });
      }
    }
  }

  async function dump(kind: BackupKind): Promise<BackupInfo> {
    const name = freshName(kind);
    const file = join(dir, name);
    try {
      await runTool(tool('pg_dump'), ['--format=custom', '--no-owner', '--no-privileges', '--exclude-table-data=sessions', `--file=${file}`, dbName], pgEnv);
    } catch (e) {
      rmSync(file, { force: true });
      throw new RecordError(500, `Backup failed: ${(e as Error).message}`);
    }
    const info: BackupInfo = {
      name,
      kind,
      createdAt: new Date().toISOString(),
      size: statSync(file).size,
      company: await companyName(pool),
      schema: await schemaOf(pool),
    };
    writeFileSync(metaPath(name), JSON.stringify(info));
    const { copyTo } = settings();
    if (copyTo) {
      try {
        mkdirSync(copyTo, { recursive: true });
        copyFileSync(file, join(copyTo, name));
      } catch (e) {
        log(`Backup copy to ${copyTo} failed: ${(e as Error).message}`);
      }
    }
    prune();
    return info;
  }

  /** Accepts an uploaded backup file after checking it is an OSuite backup. */
  async function upload(stream: Readable): Promise<BackupInfo> {
    return exclusive('an upload', async () => {
      const name = freshName('uploaded');
      const file = join(dir, name);
      await pipeline(stream, createWriteStream(file));
      try {
        const toc = await runTool(tool('pg_restore'), ['--list', file], {});
        if (!/TABLE public audit_log /.test(toc) || !/TABLE public settings /.test(toc)) throw new Error('not an OSuite backup');
      } catch {
        rmSync(file, { force: true });
        throw new RecordError(400, 'This file is not an OSuite backup');
      }
      return list().find((b) => b.name === name)!;
    });
  }

  /**
   * Replaces the live data with a backup. `quiesce` stops other requests and
   * resolves once those in flight have finished.
   */
  async function restore(name: string, by: { id: number; name: string }, quiesce: () => Promise<() => void>) {
    const file = pathOf(name);
    return exclusive('a restore', async () => {
      // 1. Restore into a scratch database and check it before touching live data.
      const admin = await adminClient();
      let restoredCompany: string | null;
      try {
        await admin.query(`drop database if exists "${scratchName}" with (force)`);
        await admin.query(`create database "${scratchName}"`);
        try {
          await runTool(tool('pg_restore'), ['--no-owner', '--no-privileges', '--exit-on-error', `--dbname=${scratchName}`, file], pgEnv);
        } catch (e) {
          throw new RecordError(400, `This backup could not be restored: ${(e as Error).message.split('\n')[0]}`);
        }
        const scratch = new pg.Pool({ ...pgEnv, host: pgEnv.PGHOST, port: Number(pgEnv.PGPORT), user: pgEnv.PGUSER, password: pgEnv.PGPASSWORD, database: scratchName, max: 2 });
        try {
          const schema = await schemaOf(scratch);
          if (schema === 0) throw new RecordError(400, 'This file is not an OSuite backup');
          if (schema > migrationCount()) throw new RecordError(400, 'This backup was made by a newer version of OSuite. Update OSuite, then restore it.');
          const chain = await verifyAuditChain(drizzle(scratch));
          if (!chain.ok) throw new RecordError(400, 'This backup’s edit log has been tampered with, so it cannot be restored');
          restoredCompany = await companyName(scratch);
          // An uploaded file has no details until now: remember them for the list.
          if (!existsSync(metaPath(name))) {
            const info: BackupInfo = { name, kind: NAME.exec(name)![1] as BackupKind, createdAt: statSync(file).mtime.toISOString(), size: statSync(file).size, company: restoredCompany, schema };
            writeFileSync(metaPath(name), JSON.stringify(info));
          }
        } finally {
          await scratch.end();
        }
      } catch (e) {
        await admin.query(`drop database if exists "${scratchName}" with (force)`).catch(() => {});
        await admin.end();
        throw e;
      }

      // 2. Safety net, then swap the databases while nothing else is running.
      let safety: BackupInfo;
      try {
        safety = await dump('before-restore');
      } catch (e) {
        await admin.query(`drop database if exists "${scratchName}" with (force)`).catch(() => {});
        await admin.end();
        throw e;
      }
      const resume = await quiesce();
      try {
        await admin.query(`drop database if exists "${oldName}" with (force)`);
        await admin.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [dbName]);
        await admin.query(`alter database "${dbName}" rename to "${oldName}"`);
        await admin.query(`alter database "${scratchName}" rename to "${dbName}"`);
        await admin.query(`drop database "${oldName}" with (force)`);
        // Flush the pool's connections to the old database.
        for (let i = 0; i < 2; i++) await Promise.allSettled(Array.from({ length: 12 }, () => pool.query('select 1')));
        await runMigrations(db);
        await db.transaction((tx) => appendAudit(tx, { userId: null, model: 'system.database', recordId: 1, action: 'restore', changes: { backup: { from: null, to: name }, by: { from: null, to: by.name } } }));
      } finally {
        await admin.end();
        resume();
      }
      return { restored: name, company: restoredCompany, safetyBackup: safety.name };
    });
  }

  function remove(name: string) {
    rmSync(pathOf(name));
    rmSync(metaPath(name), { force: true });
  }

  /** Takes the daily backup if the last one is a day old. */
  async function autoTick() {
    if (!cfg.pgTools || !settings().auto || busy) return;
    const last = list().find((b) => b.kind === 'auto');
    if (last && Date.now() - Date.parse(last.createdAt) < DAY) return;
    if (!(await companyName(pool))) return; // nothing to back up before setup
    try {
      await exclusive('a backup', () => dump('auto'));
      log('Automatic backup taken');
    } catch (e) {
      log(`Automatic backup failed: ${(e as Error).message}`);
    }
  }

  return {
    available: () => !!cfg.pgTools,
    status: () => ({ available: !!cfg.pgTools, folder: dir, busy, settings: settings(), backups: list() }),
    saveSettings,
    backupNow: () => exclusive('a backup', () => dump('manual')),
    upload,
    restore,
    remove: (name: string) => exclusive('a deletion', async () => remove(name)),
    open: (name: string) => createReadStream(pathOf(name)),
    start() {
      setTimeout(() => void autoTick(), 60_000).unref();
      timer = setInterval(() => void autoTick(), 60 * 60 * 1000);
      timer.unref();
    },
    stop: () => clearInterval(timer),
  };
}

export type BackupService = ReturnType<typeof createBackupService>;
