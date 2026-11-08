import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { auditEntryIf } from '../audit';
import { batchChanges, getDb } from '../db';
import type { Db } from '../db';
import { twoFactorChallenges, users } from '../db/schema';
import { currentUser } from '../auth/middleware';
import { userById } from '../auth/accounts';
import { dropLockedDeletions } from '../auth/keys';
import type { UserRow } from '../auth/accounts';
import { apiError, failed } from '../errors';
import { closeSockets } from '../realtime';
import { alertOtherAdmins, pushAlertToAdmins } from '../security';
import type { AppEnv } from '../types';
import { jsonObject } from '../utils';
import { createVerifier, isAuthValue, KDF_VERSION } from '../../shared/crypto/server';
import { accountOpsExhausted } from './limits';
import { viewOf } from './user-view';

// Reissue of a temporary password (addendum 4.10; crypto-review.md 14.2): the SECOND route under /api/admin that receives a credential, and
// only for an account nobody has opened yet. The admin's browser derived `auth` from a new temporary password and the person's primary address,
// exactly as at account creation; the server returns no password. The person must still have the password an admin chose (must_change_password)
// and no keys: a person who chose their own password, or has keys, must never get a password back that an administrator knows. The condition is
// part of the UPDATE, so a sign-in that completes at the same moment wins and the reissue changes nothing.

export const reissueRoutes = new Hono<AppEnv>();

const TEMP_PASSWORD_HOURS = 72;

/**
 * The write of a reissue, from the row as the caller READ it. The conditions are part of the UPDATE (still the temporary password, still no keys,
 * still active), so a person who completed their first sign-in after the row was read wins and nothing changes. True when this call changed the row.
 */
export async function applyReissue(
  db: Db,
  target: UserRow,
  by: { id: string; email: string },
  auth: string,
  now: number
): Promise<boolean> {
  const stamp = sql`EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${target.id} AND ${users.updated_at} = ${now})`;
  const changes = await batchChanges(db, [
    // The new verifier and salt replace the old ones in this one statement: the previous temporary password stops working at once, and
    // every session (one opened with it may be waiting at the key-setup step) ends.
    db
      .update(users)
      .set({
        ...(await createVerifier(auth)),
        temp_password_expires_at: now + TEMP_PASSWORD_HOURS * 3_600_000,
        sessions_valid_after: now,
        updated_at: now
      })
      .where(
        sql`${users.id} = ${target.id} AND ${users.public_key} IS NULL AND ${users.must_change_password} = 1 AND ${users.status} = 'active'`
      ),
    db.delete(twoFactorChallenges).where(sql`${twoFactorChallenges.user_id} = ${target.id} AND ${stamp}`),
    dropLockedDeletions(db, target.id, stamp),
    auditEntryIf(db, stamp, by, 'temp_password_reissued', target.email),
    alertOtherAdmins(db, by.id, 'alert_temp_password_reissued', now, by.email, { target: target.email }, stamp)
  ]);
  return changes[0] === 1;
}

reissueRoutes.post('/users/:id/reissue', async (c) => {
  const body = await jsonObject<{ auth?: unknown; kdf?: unknown }>(c.req, ['auth', 'kdf']);
  if (body === null) {
    return apiError(c, 'invalid_body');
  }
  if (!isAuthValue(body.auth) || body.kdf !== KDF_VERSION) {
    return apiError(c, 'invalid_request', { error: 'auth and kdf are required and must be valid' });
  }
  const db = getDb(c.env.DB);
  const actor = currentUser(c);
  try {
    const target = await userById(db, c.req.param('id'));
    if (target === undefined) {
      return apiError(c, 'user_not_found');
    }
    if (target.status !== 'active' || target.public_key !== null || target.must_change_password !== 1) {
      return apiError(c, 'reissue_refused');
    }
    if (await accountOpsExhausted(db, actor.id)) {
      return apiError(c, 'too_many_requests');
    }
    const now = Date.now();
    if (!(await applyReissue(db, target, { id: actor.id, email: actor.email }, body.auth, now))) {
      return apiError(c, 'reissue_refused');
    }
    await closeSockets(c.env, target.id);
    c.executionCtx.waitUntil(
      pushAlertToAdmins(c.env, db, actor.id, 'alert_temp_password_reissued', { actor: actor.email, target: target.email, at: now })
    );
    return c.json({ success: true, user: await viewOf(db, target.id) });
  } catch (error) {
    return failed(c, error);
  }
});
