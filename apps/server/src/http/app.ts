import { existsSync } from 'node:fs';
import { Readable } from 'node:stream';
import fastifyStatic from '@fastify/static';
import { localToday, type SearchParams, type SessionUser } from '@osuite/kernel';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import type { Config } from '../config.ts';
import type { Db } from '../db/client.ts';
import { metadata } from '../registry.ts';
import { verifyAuditChain } from '../services/audit.ts';
import { dashboard } from '../modules/account/dashboard.ts';
import { dayBook, ledger } from '../modules/account/ledger.ts';
import { balanceSheet, checkDate, gstr1, gstr3b, profitAndLoss, trialBalance } from '../modules/account/reports.ts';
import { autoMatch, bookLine, importStatement, matchLine, reconcileView, unmatchLine } from '../modules/account/bank.ts';
import { closeYear, listYears, reopenYear } from '../modules/account/closing.ts';
import { applyCredit, availableCredit, reverseSettlementRow } from '../modules/account/credits.ts';
import { ageing } from '../modules/account/service.ts';
import { getCompany, updateCompany } from '../services/company.ts';
import type { AuthService, SetupInput } from '../services/auth.ts';
import type { BackupService } from '../services/backup.ts';
import type { EInvoiceService } from '../modules/einvoice/service.ts';
import type { LicenseManager } from '../services/license.ts';
import { RecordError, type RecordService } from '../services/records.ts';

declare module 'fastify' {
  interface FastifyRequest {
    user: SessionUser | null;
  }
}

export interface AppDeps {
  cfg: Config;
  db: Db;
  auth: AuthService;
  records: RecordService;
  license: LicenseManager;
  backups: BackupService;
  einvoice: EInvoiceService;
  onShutdown: () => Promise<void>;
}

type Req = FastifyRequest<{ Params: Record<string, string>; Querystring: Record<string, string>; Body: unknown }>;

const bearer = (req: FastifyRequest) => {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : undefined;
};

function requireUser(req: FastifyRequest): SessionUser {
  if (!req.user) throw new RecordError(401, 'Please sign in');
  return req.user;
}

function requireAdmin(req: FastifyRequest): SessionUser {
  const u = requireUser(req);
  if (!u.isAdmin) throw new RecordError(403, 'Administrator access required');
  return u;
}

function parseId(v: string | undefined): number {
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n <= 0) throw new RecordError(400, 'Invalid id');
  return n;
}

/** Query string -> SearchParams. Filters use "f.<field>=<value>". */
function searchParams(q: Record<string, string>): SearchParams {
  const filters: SearchParams['filters'] = {};
  for (const [k, v] of Object.entries(q)) {
    if (!k.startsWith('f.')) continue;
    filters[k.slice(2)] = v === 'null' ? null : v === 'true' ? true : v === 'false' ? false : v;
  }
  return {
    q: q.q,
    sort: q.sort,
    limit: q.limit ? Number(q.limit) : undefined,
    offset: q.offset ? Number(q.offset) : undefined,
    includeArchived: q.archived === 'true',
    filters,
  };
}

export async function buildApp(deps: AppDeps) {
  const { cfg, auth, records, license } = deps;
  const app = Fastify({
    logger: { level: cfg.dev ? 'info' : 'warn' },
    bodyLimit: 5 * 1024 * 1024,
  });

  app.decorateRequest('user', null);

  // While a restore swaps the database, other API calls wait outside.
  let maintenance = false;
  const inflight = new Set<FastifyRequest>();
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    if (maintenance && req.url !== '/api/health') return reply.status(503).send({ error: 'A backup is being restored. Try again in a minute.' });
    inflight.add(req);
  });
  app.addHook('onResponse', async (req) => {
    inflight.delete(req);
  });
  const quiesce = async () => {
    maintenance = true;
    // The restore request itself is in flight.
    for (let i = 0; i < 150 && inflight.size > 1; i++) await new Promise((r) => setTimeout(r, 100));
    return () => {
      maintenance = false;
    };
  };
  app.addContentTypeParser('application/octet-stream', (_req, payload, done) => done(null, payload));

  app.addHook('onRequest', async (req) => {
    if (req.url.startsWith('/api/')) req.user = await auth.authenticate(bearer(req));
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof RecordError) {
      return reply.status(err.status).send({ error: err.message, fieldErrors: err.fieldErrors });
    }
    const e = err as { statusCode?: number; message: string };
    if (e.statusCode && e.statusCode < 500) return reply.status(e.statusCode).send({ error: e.message });
    app.log.error(err);
    return reply.status(500).send({ error: 'Something went wrong. The error has been logged.' });
  });

  /** Blocks writes when the licence is read-only. */
  const writable = () => {
    const s = license.status();
    if (!s.writable) throw new RecordError(403, s.message ?? 'Read-only mode');
  };

  // ------------------------------------------------------------- session
  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/bootstrap', async (req) => ({
    needsSetup: await auth.needsSetup(),
    user: req.user,
    company: await getCompany(deps.db),
    license: license.status(),
  }));

  app.post('/api/setup', async (req: Req) => {
    await auth.setup(req.body as SetupInput);
    return { ok: true };
  });

  app.post('/api/auth/login', async (req: Req) => {
    const { login, password } = (req.body ?? {}) as { login: string; password: string };
    return auth.login(login, password);
  });

  app.post('/api/auth/logout', async (req) => {
    const token = bearer(req);
    if (token) await auth.logout(token);
    return { ok: true };
  });

  app.get('/api/meta', async (req) => {
    requireUser(req);
    return metadata();
  });

  // ------------------------------------------------------------- records
  app.get('/api/records/:model', async (req: Req) => {
    requireUser(req);
    return records.search(req.params.model!, searchParams(req.query));
  });

  app.get('/api/records/:model/name-search', async (req: Req) => {
    requireUser(req);
    return records.nameSearch(req.params.model!, req.query.q ?? '', Number(req.query.limit ?? 8), searchParams(req.query).filters);
  });

  app.get('/api/records/:model/:id', async (req: Req) => {
    requireUser(req);
    return records.read(req.params.model!, parseId(req.params.id));
  });

  app.get('/api/records/:model/:id/history', async (req: Req) => {
    requireUser(req);
    return records.history(req.params.model!, parseId(req.params.id));
  });

  app.post('/api/records/:model', async (req: Req, reply: FastifyReply) => {
    const u = requireUser(req);
    writable();
    return reply.status(201).send(await records.create(req.params.model!, req.body, u.id));
  });

  app.patch('/api/records/:model/:id', async (req: Req) => {
    const u = requireUser(req);
    writable();
    return records.update(req.params.model!, parseId(req.params.id), req.body, u.id);
  });

  app.post('/api/records/:model/:id/actions/:action', async (req: Req) => {
    const u = requireUser(req);
    writable();
    return records.action(req.params.model!, parseId(req.params.id), req.params.action!, u.id);
  });

  app.post('/api/records/:model/set-active', async (req: Req) => {
    const u = requireUser(req);
    writable();
    const { ids, active } = (req.body ?? {}) as { ids: unknown; active: unknown };
    if (!Array.isArray(ids) || typeof active !== 'boolean') throw new RecordError(400, 'Expected { ids, active }');
    const changed = await records.setActive(req.params.model!, ids.map((i) => parseId(String(i))), active, u.id);
    return { changed };
  });

  app.delete('/api/records/:model/:id', async (req: Req, reply: FastifyReply) => {
    const u = requireUser(req);
    writable();
    await records.remove(req.params.model!, parseId(req.params.id), u.id);
    return reply.status(204).send();
  });

  // ------------------------------------------------------------- reports
  app.get('/api/dashboard', async (req: Req) => {
    requireUser(req);
    return dashboard(deps.db);
  });

  app.get('/api/reports/ageing', async (req: Req) => {
    requireUser(req);
    const direction = req.query.direction === 'outbound' ? 'outbound' : 'inbound';
    const asOf = /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf ?? '') ? req.query.asOf : undefined;
    return ageing(deps.db, direction, asOf);
  });

  app.get('/api/reports/trial-balance', async (req: Req) => {
    requireUser(req);
    return trialBalance(deps.db, checkDate(req.query.asOf, localToday()));
  });

  app.get('/api/reports/profit-loss', async (req: Req) => {
    requireUser(req);
    const to = checkDate(req.query.to, localToday());
    // Default: the current Indian financial year to date.
    const fyStart = `${Number(to.slice(5, 7)) >= 4 ? to.slice(0, 4) : Number(to.slice(0, 4)) - 1}-04-01`;
    return profitAndLoss(deps.db, checkDate(req.query.from, fyStart), to);
  });

  app.get('/api/reports/balance-sheet', async (req: Req) => {
    requireUser(req);
    return balanceSheet(deps.db, checkDate(req.query.asOf, localToday()));
  });

  app.get('/api/reports/ledger', async (req: Req) => {
    requireUser(req);
    const to = checkDate(req.query.to, localToday());
    const fyStart = `${Number(to.slice(5, 7)) >= 4 ? to.slice(0, 4) : Number(to.slice(0, 4)) - 1}-04-01`;
    const optId = (v: string | undefined) => (v ? parseId(v) : undefined);
    return ledger(deps.db, { accountId: optId(req.query.accountId), partnerId: optId(req.query.partnerId), from: checkDate(req.query.from, fyStart), to });
  });

  app.get('/api/reports/day-book', async (req: Req) => {
    requireUser(req);
    const to = checkDate(req.query.to, localToday());
    return dayBook(deps.db, checkDate(req.query.from, to), to);
  });

  app.get('/api/reports/gstr-1', async (req: Req) => {
    requireUser(req);
    return gstr1(deps.db, req.query.month);
  });

  app.get('/api/reports/gstr-3b', async (req: Req) => {
    requireUser(req);
    return gstr3b(deps.db, req.query.month);
  });

  // ------------------------------------------------------------- e-invoicing
  app.get('/api/einvoice/settings', async (req: Req) => {
    requireUser(req);
    return { ...(await deps.einvoice.getSettings()), providers: await deps.einvoice.providerList() };
  });

  app.put('/api/einvoice/settings', async (req: Req) => {
    requireAdmin(req);
    writable();
    return deps.einvoice.saveSettings((req.body ?? {}) as Record<string, never>);
  });

  app.get('/api/einvoice/:model/:id', async (req: Req) => {
    requireUser(req);
    return deps.einvoice.preview(req.params.model!, parseId(req.params.id));
  });

  app.post('/api/einvoice/:model/:id/generate', async (req: Req) => {
    const u = requireUser(req);
    writable();
    return deps.einvoice.generate(req.params.model!, parseId(req.params.id), u.id);
  });

  app.post('/api/einvoice/:model/:id/cancel', async (req: Req) => {
    const u = requireUser(req);
    writable();
    return deps.einvoice.cancel(req.params.model!, parseId(req.params.id), (req.body ?? {}) as Record<string, string>, u.id);
  });

  app.post('/api/einvoice/:model/:id/ewaybill', async (req: Req) => {
    const u = requireUser(req);
    writable();
    return deps.einvoice.eWayBill(req.params.model!, parseId(req.params.id), (req.body ?? {}) as never, u.id);
  });

  app.post('/api/einvoice/:model/:id/ewaybill/cancel', async (req: Req) => {
    const u = requireUser(req);
    writable();
    return deps.einvoice.cancelEWayBill(req.params.model!, parseId(req.params.id), (req.body ?? {}) as Record<string, string>, u.id);
  });

  // ------------------------------------------------------------- backups
  app.get('/api/backups', async (req: Req) => {
    requireAdmin(req);
    return deps.backups.status();
  });

  app.post('/api/backups', async (req: Req, reply: FastifyReply) => {
    requireAdmin(req);
    return reply.status(201).send(await deps.backups.backupNow());
  });

  app.put('/api/backups/settings', async (req: Req) => {
    requireAdmin(req);
    return deps.backups.saveSettings((req.body ?? {}) as Record<string, never>);
  });

  app.post('/api/backups/upload', async (req: Req, reply: FastifyReply) => {
    requireAdmin(req);
    if (!(req.body instanceof Readable)) throw new RecordError(400, 'Send the backup file as application/octet-stream');
    return reply.status(201).send(await deps.backups.upload(req.body));
  });

  app.post('/api/backups/:name/restore', async (req: Req) => {
    const u = requireAdmin(req);
    writable();
    return deps.backups.restore(req.params.name!, { id: u.id, name: u.name }, quiesce);
  });

  app.delete('/api/backups/:name', async (req: Req, reply: FastifyReply) => {
    requireAdmin(req);
    await deps.backups.remove(req.params.name!);
    return reply.status(204).send();
  });

  app.get('/api/backups/:name/download', async (req: Req, reply: FastifyReply) => {
    requireAdmin(req);
    const stream = deps.backups.open(req.params.name!);
    return reply
      .header('content-type', 'application/octet-stream')
      .header('content-disposition', `attachment; filename="${req.params.name}"`)
      .send(stream);
  });

  // ------------------------------------------------------------- bank reconciliation
  app.post('/api/bank/statements', async (req: Req, reply: FastifyReply) => {
    const u = requireUser(req);
    writable();
    const body = (req.body ?? {}) as { bankAccountId: number; rows: unknown; closingBalance?: string | null };
    return reply.status(201).send(await deps.db.transaction((tx) => importStatement(tx, body, u.id)));
  });

  app.get('/api/bank/statements/:id', async (req: Req) => {
    requireUser(req);
    return reconcileView(deps.db, parseId(req.params.id));
  });

  app.post('/api/bank/statements/:id/auto-match', async (req: Req) => {
    const u = requireUser(req);
    writable();
    return deps.db.transaction((tx) => autoMatch(tx, parseId(req.params.id), u.id));
  });

  app.post('/api/bank/lines/:id/match', async (req: Req) => {
    const u = requireUser(req);
    writable();
    const { entryLineId } = (req.body ?? {}) as { entryLineId: number };
    await deps.db.transaction((tx) => matchLine(tx, parseId(req.params.id), Number(entryLineId), u.id));
    return { ok: true };
  });

  app.post('/api/bank/lines/:id/unmatch', async (req: Req) => {
    const u = requireUser(req);
    writable();
    await deps.db.transaction((tx) => unmatchLine(tx, parseId(req.params.id), u.id));
    return { ok: true };
  });

  app.post('/api/bank/lines/:id/book', async (req: Req) => {
    const u = requireUser(req);
    writable();
    return deps.db.transaction((tx) => bookLine(tx, parseId(req.params.id), (req.body ?? {}) as Record<string, unknown>, u.id));
  });

  // ------------------------------------------------------------- credit & closing
  app.get('/api/credits', async (req: Req) => {
    requireUser(req);
    const direction = req.query.direction === 'outbound' ? 'outbound' : 'inbound';
    return availableCredit(deps.db, direction, parseId(req.query.partnerId));
  });

  app.post('/api/credits/apply', async (req: Req) => {
    const u = requireUser(req);
    writable();
    const b = (req.body ?? {}) as { direction?: string; partnerId?: number; docId?: number };
    const direction = b.direction === 'outbound' ? 'outbound' : 'inbound';
    return deps.db.transaction((tx) =>
      applyCredit(tx, { direction, partnerId: parseId(String(b.partnerId)), docId: b.docId ? parseId(String(b.docId)) : undefined }, u.id),
    );
  });

  app.post('/api/credits/:id/reverse', async (req: Req) => {
    const u = requireUser(req);
    writable();
    await deps.db.transaction((tx) => reverseSettlementRow(tx, parseId(req.params.id), u.id));
    return { ok: true };
  });

  app.get('/api/closing/years', async (req) => {
    requireUser(req);
    return listYears(deps.db);
  });

  app.post('/api/closing/years/:fy/close', async (req: Req) => {
    const u = requireAdmin(req);
    writable();
    return deps.db.transaction((tx) => closeYear(tx, req.params.fy!, u.id));
  });

  app.post('/api/closing/years/:fy/reopen', async (req: Req) => {
    const u = requireAdmin(req);
    writable();
    return deps.db.transaction((tx) => reopenYear(tx, req.params.fy!, u.id));
  });

  // ------------------------------------------------------------- company
  app.get('/api/company', async (req) => {
    requireUser(req);
    return getCompany(deps.db);
  });

  app.put('/api/company', async (req: Req) => {
    requireAdmin(req);
    writable();
    return updateCompany(deps.db, req.body);
  });

  // ------------------------------------------------------------- users
  app.get('/api/users', async (req) => {
    requireAdmin(req);
    return { users: await auth.listUsers(), seats: license.seats() ?? null };
  });

  app.post('/api/users', async (req: Req, reply: FastifyReply) => {
    requireAdmin(req);
    writable();
    const body = (req.body ?? {}) as { name: string; login: string; password: string; isAdmin?: boolean };
    return reply.status(201).send(await auth.createUser(body, license.seats()));
  });

  app.post('/api/users/:id/set-active', async (req: Req) => {
    const u = requireAdmin(req);
    writable();
    const { active } = (req.body ?? {}) as { active: boolean };
    await auth.setUserActive(parseId(req.params.id), !!active, u.id, license.seats());
    return { ok: true };
  });

  // ------------------------------------------------------------- licence
  // Activation endpoints are reachable before sign-in only while no admin
  // exists yet; afterwards they require an administrator.
  const licenseAdmin = async (req: FastifyRequest) => {
    if (!(await auth.needsSetup())) requireAdmin(req);
  };

  app.get('/api/license', async () => ({ ...license.status(), fingerprint: license.fingerprint }));

  app.post('/api/license/activate', async (req: Req) => {
    await licenseAdmin(req);
    return license.activate((req.body as { key: string })?.key);
  });

  app.post('/api/license/trial', async (req: Req) => {
    await licenseAdmin(req);
    return license.startTrial(req.body as { name: string; email: string; phone?: string; company: string });
  });

  app.post('/api/license/checkin', async (req) => {
    requireAdmin(req);
    return license.checkin();
  });

  app.get('/api/audit/verify', async (req) => {
    requireAdmin(req);
    return verifyAuditChain(deps.db);
  });

  // ------------------------------------------------------------- system
  app.post('/api/system/shutdown', async (req, reply) => {
    if (!cfg.shutdownToken || req.headers['x-shutdown-token'] !== cfg.shutdownToken)
      throw new RecordError(403, 'Forbidden');
    reply.send({ ok: true });
    setImmediate(() => void deps.onShutdown());
  });

  // ------------------------------------------------------------- web UI
  if (cfg.webDist && existsSync(cfg.webDist)) {
    await app.register(fastifyStatic, { root: cfg.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/')) return reply.sendFile('index.html');
      return reply.status(404).send({ error: 'Not found' });
    });
  }

  return app;
}
