import { loadConfig } from './config.ts';
import { connect, runMigrations } from './db/client.ts';
import { buildApp } from './http/app.ts';
import { startEmbeddedPg, type EmbeddedPg } from './runtime/embedded-pg.ts';
import { createAuthService } from './services/auth.ts';
import { createBackupService } from './services/backup.ts';
import { createLicenseManager } from './services/license.ts';
import { createRecordService } from './services/records.ts';

async function main() {
  const cfg = loadConfig();

  let embedded: EmbeddedPg | undefined;
  if (cfg.pgBin) {
    embedded = await startEmbeddedPg(cfg.pgBin, cfg.dataDir, cfg.pgPort);
    cfg.databaseUrl = embedded.databaseUrl;
  }

  const { pool, db } = connect(cfg.databaseUrl);
  await runMigrations(db);

  const license = createLicenseManager(cfg, (m) => app.log.warn(m));
  const backups = createBackupService(cfg, db, pool, (m) => app.log.warn(m));
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    license.stop();
    backups.stop();
    await app.close();
    await pool.end();
    embedded?.stop();
    process.exit(0);
  };

  const app = await buildApp({
    cfg,
    db,
    auth: createAuthService(db),
    records: createRecordService(db),
    license,
    backups,
    onShutdown: shutdown,
  });

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await app.listen({ host: cfg.host, port: cfg.port });
  license.startBackgroundCheckins();
  backups.start();
  // Machine-readable line the desktop shell waits for.
  console.log(`OSUITE_READY http://${cfg.host === '0.0.0.0' ? '127.0.0.1' : cfg.host}:${cfg.port}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
