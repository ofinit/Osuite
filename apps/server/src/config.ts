import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const env = process.env;
const repoRoot = resolve(import.meta.dirname, '../../..');

export interface Config {
  host: string;
  port: number;
  dataDir: string;
  /** Set when the server owns a bundled PostgreSQL (desktop mode). */
  pgBin?: string;
  pgPort: number;
  /** Folder with pg_dump / pg_restore for backups. */
  pgTools?: string;
  databaseUrl: string;
  webDist?: string;
  licenseServer: string;
  licenseEnforced: boolean;
  /** Shared secret the desktop shell uses to request a clean shutdown. */
  shutdownToken?: string;
  dev: boolean;
}

function defaultDataDir(dev: boolean): string {
  if (dev) return join(repoRoot, '.data');
  if (process.platform === 'win32') return join(env.PROGRAMDATA ?? 'C:\\ProgramData', 'OSuite');
  return join(homedir(), '.osuite');
}

/** The PostgreSQL 17 install the dev cluster runs from (scripts/devdb.mjs). */
function devPgBin(): string | undefined {
  const p = process.platform === 'win32' ? 'C:\\Program Files\\PostgreSQL\\17\\bin' : '/usr/lib/postgresql/17/bin';
  return existsSync(p) ? p : undefined;
}

export function loadConfig(): Config {
  // Literal process.env.NODE_ENV so the bundler can inline it.
  const dev = process.env.NODE_ENV !== 'production';
  const dataDir = resolve(env.OSUITE_DATA_DIR ?? defaultDataDir(dev));
  mkdirSync(dataDir, { recursive: true });
  const pgPort = Number(env.OSUITE_PG_PORT ?? 54329);
  return {
    host: env.OSUITE_HOST ?? '127.0.0.1',
    port: Number(env.OSUITE_PORT ?? 47800),
    dataDir,
    pgBin: env.OSUITE_PG_BIN,
    pgPort,
    pgTools: env.OSUITE_PG_BIN ?? env.PG_BIN ?? (dev ? devPgBin() : undefined),
    databaseUrl: env.DATABASE_URL ?? `postgres://osuite@127.0.0.1:${pgPort}/osuite`,
    webDist: env.OSUITE_WEB_DIST ?? (dev ? undefined : join(import.meta.dirname, 'web')),
    // Production talks to the hosted admin API; development to the local one.
    licenseServer: (env.OSUITE_LICENSE_SERVER ?? (dev ? 'http://127.0.0.1:47900' : 'https://osuite.business')).replace(/\/+$/, ''),
    licenseEnforced: env.OSUITE_LICENSE !== 'off',
    shutdownToken: env.OSUITE_SHUTDOWN_TOKEN,
    dev,
  };
}
