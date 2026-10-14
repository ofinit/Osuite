import { createPublicKey } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import fastifyCookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import Fastify, { type FastifyRequest } from 'fastify';
import pg from 'pg';
import { createBilling } from './billing.ts';
import { adminRoutes } from './admin-routes.ts';
import { createLicensing, HttpError } from './licensing.ts';
import { plans } from './schema.ts';
import { createStaffService } from './staff.ts';

const env = process.env;
const repoRoot = resolve(import.meta.dirname, '../../..');

function loadPrivateKey(): string {
  if (env.LICENSE_PRIVATE_KEY) return env.LICENSE_PRIVATE_KEY.replace(/\\n/g, '\n');
  const devKey = join(repoRoot, 'keys', 'license_private.pem');
  if (existsSync(devKey)) return readFileSync(devKey, 'utf8');
  throw new Error('LICENSE_PRIVATE_KEY is not set (run `pnpm keys:dev` for development)');
}

const PLANS: (typeof plans.$inferInsert)[] = [
  { id: 'trial', name: 'Free trial', seats: 2, modules: ['base'], priceMonthly: '0', priceYearly: '0' },
  { id: 'starter', name: 'Starter', seats: 1, modules: ['base'], priceMonthly: '799', priceYearly: '7990', cloudAddonMonthly: '499' },
  { id: 'business', name: 'Business', seats: 5, modules: ['base'], priceMonthly: '2499', priceYearly: '24990', cloudAddonMonthly: '999' },
  { id: 'enterprise', name: 'Enterprise', seats: 25, modules: ['base'], priceMonthly: '7999', priceYearly: '79990', cloudAddonMonthly: '2999' },
];

function migrationsFolder() {
  const c = [join(import.meta.dirname, 'migrations'), join(import.meta.dirname, '../migrations')];
  return c.find((p) => existsSync(join(p, 'meta', '_journal.json'))) ?? c[1]!;
}

async function main() {
  const privateKey = loadPrivateKey();
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  const production = env.NODE_ENV === 'production';

  const pool = new pg.Pool({
    connectionString: env.DATABASE_URL ?? 'postgres://osuite@127.0.0.1:54329/osuite_admin',
  });
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder: migrationsFolder() });
  await db.insert(plans).values(PLANS).onConflictDoNothing();

  const licensing = createLicensing(db, privateKey, publicKey);
  const billing = createBilling(db, licensing, env.RAZORPAY_WEBHOOK_SECRET);
  const staffService = createStaffService(db);

  const app = Fastify({ logger: { level: env.LOG_LEVEL ?? 'info' }, trustProxy: true });
  await staffService.bootstrapOwner(
    env.ADMIN_BOOTSTRAP_EMAIL ?? (production ? undefined : 'owner@osuite.local'),
    env.ADMIN_BOOTSTRAP_PASSWORD ?? (production ? undefined : 'owner-password'),
    (m) => app.log.warn(m),
  );
  await app.register(fastifyCookie);

  // Keep the raw body: webhook signatures are computed over the exact bytes.
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    (req as FastifyRequest & { rawBody?: string }).rawBody = body as string;
    try {
      done(null, body ? JSON.parse(body as string) : {});
    } catch {
      done(new HttpError(400, 'Invalid JSON'), undefined);
    }
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.message });
    app.log.error(err);
    return reply.status(500).send({ error: 'Internal error' });
  });

  type Body = Record<string, unknown>;

  // --------------------------------------------------------- public (apps)
  app.get('/health', async () => ({ ok: true }));
  app.post('/v1/activate', async (req) => ({ token: await licensing.activate(req.body as Body) }));
  app.post('/v1/trial', async (req) => ({ token: await licensing.startTrial(req.body as Body) }));
  app.post('/v1/checkin', async (req) => licensing.checkin(req.body as Body));
  app.get('/v1/plans', async () => db.select().from(plans).where(eq(plans.active, true)));

  // --------------------------------------------------------- webhooks
  app.post('/webhooks/razorpay', async (req) =>
    billing.razorpayWebhook(
      (req as FastifyRequest & { rawBody?: string }).rawBody ?? '',
      req.headers['x-razorpay-signature'] as string | undefined,
      req.headers['x-razorpay-event-id'] as string | undefined,
    ),
  );

  // --------------------------------------------------------- admin
  await app.register(adminRoutes, { db, licensing, staffService });

  // --------------------------------------------------------- admin web UI
  const webDist = env.ADMIN_WEB_DIST ?? join(import.meta.dirname, 'web');
  if (existsSync(join(webDist, 'index.html'))) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      const api = ['/admin/', '/v1/', '/webhooks/'].some((p) => req.url.startsWith(p));
      if (req.method === 'GET' && !api) return reply.sendFile('index.html');
      return reply.status(404).send({ error: 'Not found' });
    });
  }

  const port = Number(env.PORT ?? 47900);
  await app.listen({ host: env.HOST ?? '0.0.0.0', port });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
