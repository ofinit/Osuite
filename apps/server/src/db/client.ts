import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';

export function connect(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  // Idle connections can be dropped by the server (a restore swaps the database); the pool replaces them.
  pool.on('error', () => {});
  const db = drizzle(pool);
  return { pool, db };
}

export type Db = ReturnType<typeof connect>['db'];
/** A database handle or an open transaction. */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0] | Db;

function migrationsFolder(): string {
  // Bundled build ships migrations next to main.js; dev runs from src/db.
  const candidates = [
    process.env.OSUITE_MIGRATIONS,
    join(import.meta.dirname, 'migrations'),
    join(import.meta.dirname, '../../migrations'),
  ].filter((p): p is string => !!p);
  const found = candidates.find((p) => existsSync(join(p, 'meta', '_journal.json')));
  if (!found) throw new Error('Migrations folder not found');
  return found;
}

/** Migrations this build knows; a backup with more came from a newer version. */
export function migrationCount(): number {
  const journal = JSON.parse(readFileSync(join(migrationsFolder(), 'meta', '_journal.json'), 'utf8')) as { entries: unknown[] };
  return journal.entries.length;
}

export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder: migrationsFolder() });
}
