import { accessField, AREAS, FULL_ACCESS, NO_ACCESS, type Access, type AccessLevel, type Company, type SessionUser } from '@osuite/kernel';
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
import { sessions, settings, tableFor, users } from '../db/tables.ts';
import { toIso } from '../util/time.ts';
import { RecordError } from './records.ts';

const SESSION_DAYS = 30;
const MIN_PASSWORD = 8;

type RoleRow = Record<string, unknown> | null | undefined;

/** A role's level per area. Administrators may do everything; a user without a role, nothing. */
function accessOf(isAdmin: boolean, role: RoleRow): Access {
  if (isAdmin) return FULL_ACCESS;
  if (!role) return NO_ACCESS;
  return Object.fromEntries(AREAS.map(([a]) => [a, (role[accessField(a)] as AccessLevel) ?? 'none'])) as Access;
}

const toSessionUser = (u: typeof users.$inferSelect, role?: RoleRow): SessionUser => ({
  id: u.id,
  login: u.login,
  name: u.name,
  isAdmin: u.isAdmin,
  roleId: u.isAdmin ? null : (u.roleId ?? null),
  roleName: u.isAdmin ? null : role ? String(role.name) : null,
  access: accessOf(u.isAdmin, role),
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
  const roles = () => tableFor('base.role');

  /** Non-administrators need an existing, active role. */
  async function checkRole(roleId: unknown): Promise<number> {
    const id = Number(roleId);
    const r = roles();
    const [role] = Number.isSafeInteger(id) && id > 0 ? await db.select({ id: r.id }).from(r).where(and(eq(r.id, id), eq(r.active, true))) : [];
    if (!role) throw new RecordError(422, 'Choose a role', { roleId: 'Choose what this user may do' });
    return id;
  }

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
      const [row] = await db
        .select({ user: users, role: roles() })
        .from(users)
        .leftJoin(roles(), eq(roles().id, users.roleId))
        .where(and(eq(users.login, String(login ?? '').trim().toLowerCase()), eq(users.active, true)));
      const user = row?.user;
      // Hash anyway so timing does not reveal whether the login exists.
      const ok = user ? await verifyPassword(String(password ?? ''), user.passwordHash) : await fakePasswordCheck();
      if (!user || !ok) throw new RecordError(401, 'Incorrect login or password');
      const token = newSessionToken();
      await db.insert(sessions).values({
        tokenHash: tokenHash(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000).toISOString(),
      });
      return { token, user: toSessionUser(user, row.role) };
    },

    async authenticate(token: string | undefined): Promise<SessionUser | null> {
      if (!token) return null;
      const [row] = await db
        .select({ user: users, role: roles() })
        .from(sessions)
        .innerJoin(users, eq(users.id, sessions.userId))
        .leftJoin(roles(), eq(roles().id, users.roleId))
        .where(
          and(eq(sessions.tokenHash, tokenHash(token)), gt(sessions.expiresAt, new Date().toISOString()), eq(users.active, true)),
        );
      return row ? toSessionUser(row.user, row.role) : null;
    },

    async logout(token: string): Promise<void> {
      await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash(token)));
    },

    async listUsers() {
      const rows = await db.select({ user: users, role: roles() }).from(users).leftJoin(roles(), eq(roles().id, users.roleId)).orderBy(users.name);
      return rows.map(({ user: u, role }) => ({ ...toSessionUser(u, role), active: u.active, createdAt: toIso(u.createdAt) as string }));
    },

    activeUserCount,

    async createUser(input: { name: string; login: string; password: string; isAdmin?: boolean; roleId?: number | null }, seats?: number) {
      if (!input.name?.trim()) throw new RecordError(422, 'Name is required', { name: 'Required' });
      const login = checkLogin(input.login);
      checkPassword(input.password);
      const roleId = input.isAdmin ? null : await checkRole(input.roleId);
      if (seats !== undefined && (await activeUserCount()) >= seats)
        throw new RecordError(402, `Your plan includes ${seats} user${seats === 1 ? '' : 's'}. Upgrade to add more.`);
      try {
        const [u] = await db
          .insert(users)
          .values({ login, name: input.name.trim(), passwordHash: await hashPassword(input.password), isAdmin: !!input.isAdmin, roleId })
          .returning();
        const [role] = roleId ? await db.select().from(roles()).where(eq(roles().id, roleId)) : [];
        return toSessionUser(u!, role);
      } catch (err) {
        if (pgError(err).code === '23505')
          throw new RecordError(409, 'Login already exists', { login: 'Already taken' });
        throw err;
      }
    },

    /** Changes what a user may do: administrator, or a role. */
    async setUserAccess(id: number, input: { isAdmin?: boolean; roleId?: number | null }, actingUserId: number) {
      const [user] = await db.select().from(users).where(eq(users.id, id));
      if (!user) throw new RecordError(404, 'User not found');
      const isAdmin = !!input.isAdmin;
      if (id === actingUserId && !isAdmin) throw new RecordError(422, 'You cannot remove your own administrator access');
      const roleId = isAdmin ? null : await checkRole(input.roleId);
      await db.update(users).set({ isAdmin, roleId }).where(eq(users.id, id));
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
