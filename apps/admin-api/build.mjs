// Bundles the admin API into dist/admin-api.cjs, plus migrations and the built
// admin web UI (served from dist/web), for Docker.
import { build } from 'esbuild';
import { cpSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const here = import.meta.dirname;
const out = join(here, 'dist');
rmSync(out, { recursive: true, force: true });

await build({
  entryPoints: [join(here, 'src/main.ts')],
  outfile: join(out, 'admin-api.cjs'),
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: 'linked',
  define: { 'import.meta.dirname': '__dirname' },
  external: ['pg-native'],
  logLevel: 'info',
});
cpSync(join(here, 'migrations'), join(out, 'migrations'), { recursive: true });
const web = join(here, '../admin-web/dist');
if (existsSync(web)) cpSync(web, join(out, 'web'), { recursive: true });
else console.warn('admin web not built: run `pnpm --filter @osuite/admin-web build` first');
