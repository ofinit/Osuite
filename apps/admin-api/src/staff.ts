import {
  fakePasswordCheck,
  hashPassword,
  newSessionToken,
  pgError,
  tokenHash,
  verifyPassword,
} from '@osuite/server-kit';
import { and, count, eq, gt, lt } from 'drizzle-orm';
import { HttpError, type Db } from './licensing.ts';
import { staff, staffSessions } from './schema.ts';

const SESSION_HOURS = 12;
const MIN_PASSWORD = 10;

export type Staff = typeof staff.$inferSelect;
export interface StaffUser {
  id: number;
  email: string;
  name: string;
  role: 'owner' | 'staff';
}

const toUser = (s: Staff): StaffUser => ({ id: s.id, email: s.email, name: s.name, role: s.role });

function checkPassword(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < MIN_PASSWORD)
    throw new HttpError(400, `Password must be at least ${MIN_PASSWORD} characters`);
  return pw;
}

function checkEmail(email: unknown): string {
  const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new HttpError(400, 'A valid email is required');
  return e;
}

export function createStaffService(db: Db) {
  return {
    sessionHours: SESSION_HOURS,

    /** Creates the first owner from env when no staff exist yet. */
    async bootstrapOwner(email: string | undefined, password: string | undefined, log: (m: string) => void) {
      const [{ n }] = (await db.select({ n: count() }).from(staff)) as [{ n: number }];
      if (n > 0) return;
      if (!email || !password) {
        log('No staff accounts yet: set ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD to create the owner.');
        return;
      }
      await db.insert(staff).values({
        email: checkEmail(email),
        name: 'Owner',
        passwordHash: await hashPassword(checkPassword(password)),
        role: 'owner',
      });
      log(`Created owner account ${email}. Change its password after signing in.`);
    },

    async login(email: unknown, password: unknown): Promise<{ token: string; user: StaffUser }> {
      const e = typeof email === 'string' ? email.trim().toLowerCase() : '';
      const [s] = await db.select().from(staff).where(and(eq(staff.email, e), eq(staff.active, true)));
      const ok = s ? await verifyPassword(String(password ?? ''), s.passwordHash) : await fakePasswordCheck();
      if (!s || !ok) throw new HttpError(401, 'Incorrect email or password');
      const token = newSessionToken();
      await db.delete(staffSessions).where(lt(staffSessions.expiresAt, new Date()));
      await db.insert(staffSessions).values({
        tokenHash: tokenHash(token),
        staffId: s.id,
        expiresAt: new Date(Date.now() + SESSION_HOURS * 3_600_000),
      });
      await db.update(staff).set({ lastLoginAt: new Date() }).where(eq(staff.id, s.id));
      return { token, user: toUser(s) };
    },

    async authenticate(token: string | undefined): Promise<StaffUser | null> {
      if (!token) return null;
      const [row] = await db
        .select({ s: staff })
        .from(staffSessions)
        .innerJoin(staff, eq(staff.id, staffSessions.staffId))
        .where(and(eq(staffSessions.tokenHash, tokenHash(token)), gt(staffSessions.expiresAt, new Date()), eq(staff.active, true)));
      return row ? toUser(row.s) : null;
    },

    async logout(token: string | undefined) {
      if (token) await db.delete(staffSessions).where(eq(staffSessions.tokenHash, tokenHash(token)));
    },

    async list() {
      const rows = await db.select().from(staff).orderBy(staff.name);
      return rows.map((s) => ({ ...toUser(s), active: s.active, lastLoginAt: s.lastLoginAt, createdAt: s.createdAt }));
    },

    async create(input: { email?: string; name?: string; password?: string; role?: string }) {
      const name = input.name?.trim();
      if (!name) throw new HttpError(400, 'Name is required');
      try {
        const [s] = await db
          .insert(staff)
          .values({
            email: checkEmail(input.email),
            name,
            passwordHash: await hashPassword(checkPassword(input.password)),
            role: input.role === 'owner' ? 'owner' : 'staff',
          })
          .returning();
        return toUser(s!);
      } catch (err) {
        if (pgError(err).code === '23505') throw new HttpError(409, 'Someone already uses that email');
        throw err;
      }
    },

    async setActive(id: number, active: boolean, actingId: number) {
      if (id === actingId && !active) throw new HttpError(400, 'You cannot deactivate your own account');
      await db.update(staff).set({ active }).where(eq(staff.id, id));
      if (!active) await db.delete(staffSessions).where(eq(staffSessions.staffId, id));
    },

    async changePassword(id: number, current: unknown, next: unknown) {
      const [s] = await db.select().from(staff).where(eq(staff.id, id));
      if (!s || !(await verifyPassword(String(current ?? ''), s.passwordHash)))
        throw new HttpError(400, 'Current password is incorrect');
      await db
        .update(staff)
        .set({ passwordHash: await hashPassword(checkPassword(next)) })
        .where(eq(staff.id, id));
    },
  };
}

export type StaffService = ReturnType<typeof createStaffService>;
