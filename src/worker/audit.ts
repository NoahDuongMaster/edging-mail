import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { BatchQuery, Db } from './db';
import { auditLog, userSignIns } from './db/schema';

/** Who did it. `id` is null when no account is involved (setup runs before any exists; a failed sign-in of an unknown address is not recorded at all). */
export interface Actor {
  id: string | null;
  email: string;
}

/**
 * One audit-log row, as a query for `db.batch([...])` so it commits or fails together with the change it describes.
 * `detail` is small JSON for the admin's eyes: never a password, an `auth` value, a token or a mail address other than `target`.
 */
export const auditEntry = (db: Db, actor: Actor, action: string, target = '', detail: Record<string, unknown> = {}): BatchQuery =>
  db.insert(auditLog).values({
    at: Date.now(),
    actor_user_id: actor.id,
    actor_email: actor.email,
    action,
    target,
    detail: JSON.stringify(detail)
  });

/** The same row, written only while `condition` (an SQL predicate) holds when the statement runs: for the tail of a compare-and-set batch. */
export const auditEntryIf = (
  db: Db,
  condition: SQL,
  actor: Actor,
  action: string,
  target = '',
  detail: Record<string, unknown> = {}
): BatchQuery =>
  db
    .insert(auditLog)
    .select(
      sql`SELECT NULL, ${Date.now()}, ${actor.id}, ${actor.email}, ${action}, ${target}, ${JSON.stringify(detail)} WHERE ${condition}`
    );

const MAX_USER_AGENT = 300;
const MAX_IP = 64;

/**
 * One row of a person's own sign-in history (kind 'sign_in'), or a note of a security action (`kind`). A query for `db.batch`; with a
 * `guard` (an SQL predicate) it is written only while the guard holds when the statement runs: the tail of a compare-and-set batch.
 */
export const signInEntry = (db: Db, userId: string, request: Request, ok: boolean, kind = 'sign_in', guard?: SQL): BatchQuery => {
  const ip = request.headers.get('CF-Connecting-IP')?.trim().slice(0, MAX_IP) ?? null;
  const userAgent = request.headers.get('User-Agent')?.slice(0, MAX_USER_AGENT) ?? null;
  const at = Date.now();
  return guard === undefined
    ? db.insert(userSignIns).values({ user_id: userId, at, ip, user_agent: userAgent, ok: ok ? 1 : 0, kind })
    : db.insert(userSignIns).select(sql`SELECT NULL, ${userId}, ${at}, ${ip}, ${userAgent}, ${ok ? 1 : 0}, ${kind} WHERE ${guard}`);
};
