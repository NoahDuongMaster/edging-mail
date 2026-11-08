import { Hono } from 'hono';
import { and, count, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { AnyColumn, SQL } from 'drizzle-orm';
import { isAuthValue } from '../../shared/crypto/server';
import { auditEntry, auditEntryIf, signInEntry } from '../audit';
import { getDb, runBatch } from '../db';
import type { Db } from '../db';
import { messages, userKeys, users } from '../db/schema';
import { apiError } from '../errors';
import { pushNotice, securityEvent } from '../security';
import type { AppEnv } from '../types';
import { errorClass, jsonObject } from '../utils';
import { userById } from './accounts';
import { currentUser, hasStepUp } from './middleware';
import { confirmCurrentAuth } from './stepup';

// Old mail that is locked: mail sealed to a key the person no longer has (retired by a break-glass). Only the old recovery key can open it, so
// the person either keeps it (nothing to do) or deletes it. Deleting is irreversible and is exactly what somebody who took the account over
// would do, so it follows crypto-design.md 15.7 / M7: the password (and the second step, when the account has one) in the same request, a
// seven-day delay, a notice and a push to the owner, an audit row, and a cancel until the time has come. The cron then does the deletion
// (`locked-job.ts`).

export const lockedRoutes = new Hono<AppEnv>();

/** How long a deletion of locked mail waits before the cron carries it out. */
export const LOCKED_DELETE_DELAY_MS = 7 * 24 * 60 * 60_000;

/** LK-4: true unless `keyId` is the live key of that person (`users.key_id`). The deletion and its purge both carry it. Values or `user_keys` columns. */
export const notLive = (userId: string | AnyColumn, keyId: string | AnyColumn): SQL =>
  sql`NOT EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${userId} AND ${users.key_id} = ${keyId})`;

const KEY_ID = /^[\w-]{22}$/;

/** A retired key as `GET /api/keys/me` lists it. `locked` is the number of the person's messages sealed to that key. */
export interface RetiredKey {
  key_id: string;
  wrapped_private_key_recovery: string | null;
  retired_at: number;
  locked: number;
  delete_requested_at: number | null;
  delete_after: number | null;
}

/** The person's retired keys, newest first, each with how many messages are still locked under it and any deletion that is pending. */
export async function retiredKeysOf(db: Db, userId: string): Promise<RetiredKey[]> {
  const keys = await db
    .select({
      key_id: userKeys.key_id,
      wrapped_private_key_recovery: userKeys.wrapped_private_key_recovery,
      retired_at: userKeys.retired_at,
      delete_requested_at: userKeys.delete_requested_at,
      delete_after: userKeys.delete_after
    })
    .from(userKeys)
    .where(eq(userKeys.user_id, userId))
    .orderBy(desc(userKeys.retired_at));
  if (keys.length === 0) {
    return [];
  }
  const counts = await db
    .select({ key_id: messages.key_id, locked: count() })
    .from(messages)
    .where(
      and(
        eq(messages.user_id, userId),
        inArray(
          messages.key_id,
          keys.map((key) => key.key_id)
        )
      )
    )
    .groupBy(messages.key_id);
  return keys.map((key) => ({ ...key, locked: counts.find((entry) => entry.key_id === key.key_id)?.locked ?? 0 }));
}

const retiredKey = (db: Db, userId: string, keyId: string) =>
  db
    .select({ delete_requested_at: userKeys.delete_requested_at, delete_after: userKeys.delete_after })
    .from(userKeys)
    // LK-4: a row of user_keys that carries the person's LIVE key is never a locked key, whatever way it got there.
    .where(and(eq(userKeys.key_id, keyId), eq(userKeys.user_id, userId), notLive(userId, keyId)))
    .get();

/** How many of the person's messages are sealed to this key. */
const lockedCount = async (db: Db, userId: string, keyId: string): Promise<number> => {
  const row = await db
    .select({ locked: count() })
    .from(messages)
    .where(and(eq(messages.user_id, userId), eq(messages.key_id, keyId)))
    .get();
  return row?.locked ?? 0;
};

// Ask to delete the mail locked under one retired key. The deletion is only MARKED here: the cron carries it out once `delete_after` has
// passed. Asking again while one is pending changes nothing (the first time stands). Needs the password, and the second step when the account has one.
lockedRoutes.post('/delete-locked', async (c) => {
  const startedAt = Date.now();
  try {
    const body = await jsonObject<{ current_auth?: unknown; key_id?: unknown }>(c.req, ['current_auth', 'key_id']);
    if (body === null) {
      return apiError(c, 'invalid_body');
    }
    const keyId = body.key_id;
    if (!isAuthValue(body.current_auth) || typeof keyId !== 'string' || !KEY_ID.test(keyId)) {
      return apiError(c, 'invalid_request', { error: 'current_auth and key_id are required' });
    }
    const db = getDb(c.env.DB);
    const row = await userById(db, currentUser(c).id);
    if (row === undefined) {
      return apiError(c, 'unauthorized');
    }
    if (row.totp_enabled === 1 && !hasStepUp(currentUser(c))) {
      return apiError(c, 'step_up_required');
    }
    const refused = await confirmCurrentAuth(c, db, row, body.current_auth, startedAt);
    if (refused !== null) {
      return refused;
    }
    // Only the person's OWN retired keys: the current key and somebody else's key answer like a key that does not exist.
    const before = await retiredKey(db, row.id, keyId);
    if (before === undefined) {
      return apiError(c, 'not_found');
    }
    const locked = await lockedCount(db, row.id, keyId);
    const now = Date.now();
    if (before.delete_after === null) {
      const after = now + LOCKED_DELETE_DELAY_MS;
      // Everything after the update is written only while the row carries this request's time: a second request in the same moment loses.
      const marked = sql`EXISTS (SELECT 1 FROM ${userKeys} WHERE ${userKeys.key_id} = ${keyId} AND ${userKeys.delete_requested_at} = ${now})`;
      await runBatch(db, [
        db
          .update(userKeys)
          .set({ delete_requested_at: now, delete_after: after })
          .where(and(eq(userKeys.key_id, keyId), eq(userKeys.user_id, row.id), isNull(userKeys.delete_after), notLive(row.id, keyId))),
        auditEntryIf(db, marked, { id: row.id, email: row.email }, 'locked_mail_delete_requested', row.email, {
          key_id: keyId,
          locked,
          delete_after: after
        }),
        securityEvent(db, row.id, 'locked_delete_requested', now, null, { key_id: keyId, delete_after: after }, marked),
        signInEntry(db, row.id, c.req.raw, true, 'locked_delete_requested', marked)
      ]);
    }
    const after = await retiredKey(db, row.id, keyId);
    if (after?.delete_requested_at === now) {
      c.executionCtx.waitUntil(pushNotice(c.env, db, row.id, 'locked_delete_requested', { at: now }));
    }
    return c.json({
      success: true,
      key_id: keyId,
      locked,
      delete_requested_at: after?.delete_requested_at ?? null,
      delete_after: after?.delete_after ?? null
    });
  } catch (error) {
    console.error('[edging-mail] Could not mark locked mail for deletion:', errorClass(error));
    return apiError(c, 'server_error');
  }
});

// Cancel a pending deletion of locked mail. Needs only the session: it protects the person's mail, so a thief gains nothing by it.
lockedRoutes.post('/cancel-delete-locked', async (c) => {
  try {
    const body = await jsonObject<{ key_id?: unknown }>(c.req, ['key_id']);
    if (body === null) {
      return apiError(c, 'invalid_body');
    }
    const keyId = body.key_id;
    if (typeof keyId !== 'string' || !KEY_ID.test(keyId)) {
      return apiError(c, 'invalid_request', { error: 'key_id is required' });
    }
    const db = getDb(c.env.DB);
    const user = currentUser(c);
    const before = await retiredKey(db, user.id, keyId);
    if (before === undefined) {
      return apiError(c, 'not_found');
    }
    if (before.delete_after === null) {
      // Nothing is pending (somebody cancelled it, or the cron has done it): the general conflict code.
      return apiError(c, 'conflict', { error: 'No deletion of locked mail is pending' });
    }
    await runBatch(db, [
      db
        .update(userKeys)
        .set({ delete_requested_at: null, delete_after: null })
        .where(and(eq(userKeys.key_id, keyId), eq(userKeys.user_id, user.id), isNotNull(userKeys.delete_after))),
      auditEntry(db, { id: user.id, email: user.email }, 'locked_mail_delete_canceled', user.email, { key_id: keyId })
    ]);
    return c.json({ success: true, key_id: keyId });
  } catch (error) {
    console.error('[edging-mail] Could not cancel the deletion of locked mail:', errorClass(error));
    return apiError(c, 'server_error');
  }
});
