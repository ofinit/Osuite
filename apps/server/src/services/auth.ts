import type { Company, SessionUser } from '@osuite/kernel';
import {
  fakePasswordCheck,
  hashPassword,
  newSessionToken,
  pgError,
  tokenHash,
  verifyPassword,
} from '@osuite/server-kit';
import { and, count, eq, gt, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { sessions, settings, users } from '../db/tables.ts';
import { toIso } from '../util/time.ts';
import { RecordError } from './records.ts';

const SESSION_DAYS = 30;
const MIN_PASSWORD = 8;

const toSessionUser = (u: typeof users.$inferSelect): SessionUser => ({
  id: u.id,
  login: u.login,
  name: u.name,
  isAdmin: u.isAdmin,
});

export interface SetupInput {
  companyName: string;
  gstin?: string;
  stateCode?: string;
  adminName: string;
  login: string;
  password: string;
}

function checkPassword(password: unknown) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD)
    throw new RecordError(422, 'Password too short', { password: `At least ${MIN_PASSWORD} characters` });
}

function checkLogin(login: unknown): string {
  const l = typeof login === 'string' ? login.trim().toLowerCase() : '';
  if (!/^[a-z0-9._@-]{3,120}$/.test(l))
    throw new RecordError(422, 'Invalid login', { login: '3+ characters: letters, digits, . _ @ -' });
  return l;
}

export function createAuthService(db: Db) {
  async function activeUserCount() {
    const [r] = await db.select({ n: count() }).from(users).where(eq(users.active, true));
    return r?.n ?? 0;
  }

  return {
    async needsSetup(): Promise<boolean> {
      return (await db.select({ n: count() }).from(users))[0]!.n === 0;
    },


    /** First-run wizard: creates the company profile and the admin user. */
    async setup(input: SetupInput): Promise<void> {
      const companyName = input.companyName?.trim();
      if (!companyName) throw new RecordError(422, 'Company name is required', { companyName: 'Required' });
      if (!input.adminName?.trim()) throw new RecordError(422, 'Your name is required', { adminName: 'Required' });
      const login = checkLogin(input.login);
      checkPassword(input.password);
      const passwordHash = await hashPassword(input.password);
      await db.transaction(async (tx) => {
        // Serialise concurrent setup attempts; only the first one wins.
        await tx.execute(sql`lock table users in exclusive mode`);
        const [{ n }] = (await tx.select({ n: count() }).from(users)) as [{ n: number }];
        if (n > 0) throw new RecordError(409, 'Setup has already been completed');
        await tx.insert(users).values({ login, name: input.adminName.trim(), passwordHash, isAdmin: true });
        const company: Company = {
          name: companyName,
          gstin: input.gstin?.trim().toUpperCase() || undefined,
          stateCode: input.stateCode || undefined,
        };
        await tx.insert(settings).values({ key: 'company', value: company });
      });
    },

    async login(login: string, password: string): Promise<{ token: string; user: SessionUser }> {
      const [user] = await db
        .select()
        .from(users)
        .where(and(eq(users.login, String(login ?? '').trim().toLowerCase()), eq(users.active, true)));
      // Hash anyway so timing does not reveal whether the login exists.
      const ok = user ? await verifyPassword(String(password ?? ''), user.passwordHash) : await fakePasswordCheck();
      if (!user || !ok) throw new RecordError(401, 'Incorrect login or password');
      const token = newSessionToken();
      await db.insert(sessions).values({
        tokenHash: tokenHash(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString(),
      });
      return { token, user: toSessionUser(user) };
    },

    async authenticate(token: string | undefined): Promise<SessionUser | null> {
      if (!token) return null;
      const [row] = await db
        .select({ user: users })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .where(
          and(eq(sessions.tokenHash, tokenHash(token)), gt(sessions.expiresAt, new Date().toISOString()), eq(users.active, true)),
        );
      return row ? toSessionUser(row.user) : null;
    },

    async logout(token: string): Promise<void> {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash(token)));
    },

    async listUsers() {
      const rows = await db.select().from(users).orderBy(users.name);
      return rows.map((u) => ({ ...toSessionUser(u), active: u.active, createdAt: toIso(u.createdAt) as string }));
    },

    activeUserCount,

    async createUser(input: { name: string; login: string; password: string; isAdmin?: boolean }, seats?: number) {
      if (!input.name?.trim()) throw new RecordError(422, 'Name is required', { name: 'Required' });
      const login = checkLogin(input.login);
      checkPassword(input.password);
      if (seats !== undefined && (await activeUserCount()) >= seats)
        throw new RecordError(402, `Your plan includes ${seats} user${seats === 1 ? '' : 's'}. Upgrade to add more.`);
      try {
        const [u] = await db
          .insert(users)
          .values({ login, name: input.name.trim(), passwordHash: await hashPassword(input.password), isAdmin: !!input.isAdmin })
          .returning();
        return toSessionUser(u!);
      } catch (err) {
        if (pgError(err).code === '23505')
          throw new RecordError(409, 'Login already exists', { login: 'Already taken' });
        throw err;
      }
    },

    async setUserActive(id: number, active: boolean, actingUserId: number, seats?: number) {
      if (id === actingUserId && !active) throw new RecordError(422, 'You cannot deactivate yourself');
      if (active && seats !== undefined && (await activeUserCount()) >= seats)
        throw new RecordError(402, `Your plan includes ${seats} users. Upgrade to add more.`);
      await db.update(users).set({ active }).where(eq(users.id, id));
      if (!active) await db.delete(sessions).where(eq(sessions.userId, id));
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
