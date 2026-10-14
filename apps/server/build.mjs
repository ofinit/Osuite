// Bundles the server into a single CommonJS file (dist/osuite-server.cjs) plus
// its migrations and the built web UI. Used for the desktop sidecar and Docker.
import { build } from 'esbuild';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dirname;
const out = join(here, 'dist');
rmSync(out, { recursive: true, force: true });

await build({
  entryPoints: [join(here, 'src/main.ts')],
  outfile: join(out, 'osuite-server.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  minify: true,
  sourcemap: 'linked',
  // CJS has no import.meta; every use in the server is import.meta.dirname.
  define: { 'import.meta.dirname': '__dirname', 'process.env.NODE_ENV': '"production"' },
  external: ['pg-native'],
  logLevel: 'info',
});

cpSync(join(here, 'migrations'), join(out, 'migrations'), { recursive: true });
const web = join(here, '../web/dist');
if (existsSync(web)) cpSync(web, join(out, 'web'), { recursive: true });
else console.warn('web UI not built: run `pnpm --filter @osuite/web build` first');
