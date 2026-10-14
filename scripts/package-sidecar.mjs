// Packages the bundled server as a single executable (Node SEA) for the Tauri
// desktop shell, and stages its resources.
//   node scripts/package-sidecar.mjs [--with-postgres]
// Prerequisite: pnpm --filter @osuite/web build && pnpm --filter @osuite/server build
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = join(root, 'apps/server/dist');
const tauri = join(root, 'apps/desktop/src-tauri');
const binDir = join(tauri, 'binaries');
const resDir = join(tauri, 'resources');
const work = join(root, '.data', 'sea');

if (!existsSync(join(dist, 'osuite-server.cjs'))) throw new Error('Run `pnpm --filter @osuite/server build` first');

// Tauri sidecars are named <name>-<target triple><ext>.
const triple = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
}[`${process.platform}-${process.arch}`];
if (!triple) throw new Error(`Unsupported platform ${process.platform}-${process.arch}`);
const exeName = `osuite-server-${triple}${process.platform === 'win32' ? '.exe' : ''}`;

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
mkdirSync(binDir, { recursive: true });

const blob = join(work, 'sea-prep.blob');
const seaConfig = join(work, 'sea-config.json');
writeFileSync(
  seaConfig,
  JSON.stringify({ main: join(dist, 'osuite-server.cjs'), output: blob, disableExperimentalSEAWarning: true }),
);
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

const exe = join(binDir, exeName);
copyFileSync(process.execPath, exe);
// The copied node.exe's Authenticode signature is invalidated here; release
// builds re-sign the sidecar with our own certificate.
const { inject } = await import('postject');
await inject(exe, 'NODE_SEA_BLOB', readFileSync(blob), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
  machoSegmentName: process.platform === 'darwin' ? 'NODE_SEA' : undefined,
});
console.log(`sidecar: ${exe}`);

// Resources the shell points the sidecar at (OSUITE_MIGRATIONS / OSUITE_WEB_DIST).
rmSync(join(resDir, 'migrations'), { recursive: true, force: true });
rmSync(join(resDir, 'web'), { recursive: true, force: true });
cpSync(join(dist, 'migrations'), join(resDir, 'migrations'), { recursive: true });
cpSync(join(dist, 'web'), join(resDir, 'web'), { recursive: true });

if (process.argv.includes('--with-postgres')) {
  // Stages the PostgreSQL runtime (bin/lib/share) from a local install.
  // Release CI should instead download a pinned, checksummed binary archive.
  const pgHome = process.env.PG_HOME ?? 'C:\\Program Files\\PostgreSQL\\17';
  const target = join(resDir, 'pgsql');
  rmSync(target, { recursive: true, force: true });
  for (const d of ['bin', 'lib', 'share']) cpSync(join(pgHome, d), join(target, d), { recursive: true });
  console.log(`postgres runtime: ${target}`);
}
console.log(`resources: ${resDir}`);
