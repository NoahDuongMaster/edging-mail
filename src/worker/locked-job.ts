import { and, eq, inArray, isNotNull, lte, sql } from 'drizzle-orm';
import { auditEntry } from './audit';
import { notLive } from './auth/locked';
import { deleteBlobs } from './content';
import { getDb } from './db';
import type { Db } from './db';
import { attachments, messages, userKeys, users } from './db/schema';
import type { Env } from './types';
import { errorClass } from './utils';

// The cron half of `POST /api/keys/delete-locked`: once the seven days have passed, the person's mail that is sealed to that retired key is
// deleted, rows first (the attachment rows go with them), then their R2 objects. It works in small chunks so a run stays cheap; the request
// stays marked until nothing is left, so the next run goes on. A cancel in between wins: the delete statement carries the same condition as
// the marker, so a cancelled request deletes nothing, and objects are removed only for rows that really are gone.

// D1 binds at most 100 values per statement: the ids go in next to the owner, the key and the time.
const CHUNK = 50;
const ROUNDS_PER_RUN = 4;
const KEYS_PER_RUN = 3;

export interface DueKey {
  key_id: string;
  user_id: string;
}

/** One chunk of one key: how many messages are gone, and whether a full chunk went (so there may be more). Exported for its own test (LK-4). */
export async function purgeChunk(env: Env, db: Db, key: DueKey, now: number): Promise<{ deleted: number; more: boolean }> {
  const rows = await db
    .select({ id: messages.id, r2_key: messages.r2_key })
    .from(messages)
    .where(and(eq(messages.user_id, key.user_id), eq(messages.key_id, key.key_id)))
    .limit(CHUNK);
  const ids = rows.map((row) => row.id);
  const files =
    ids.length === 0
      ? []
      : await db
          .select({ message_id: attachments.message_id, r2_key: attachments.r2_key })
          .from(attachments)
          .where(inArray(attachments.message_id, ids));
  // Still due, and not cancelled: the marker is the only authority. Never for the person's LIVE key (LK-4).
  const due = sql`EXISTS (SELECT 1 FROM ${userKeys} WHERE ${userKeys.key_id} = ${key.key_id} AND ${userKeys.delete_after} <= ${now}) AND ${notLive(key.user_id, key.key_id)}`;
  const remaining = sql`EXISTS (SELECT 1 FROM ${messages} WHERE ${messages.user_id} = ${key.user_id} AND ${messages.key_id} = ${key.key_id})`;
  await db.batch([
    // The attachment rows are removed with their message (ON DELETE cascade).
    db
      .delete(messages)
      .where(
        and(inArray(messages.id, ids.length === 0 ? [''] : ids), eq(messages.user_id, key.user_id), eq(messages.key_id, key.key_id), due)
      ),
    // The request is finished when nothing is left under the key: the marker goes.
    db
      .update(userKeys)
      .set({ delete_requested_at: null, delete_after: null })
      .where(and(eq(userKeys.key_id, key.key_id), eq(userKeys.user_id, key.user_id), due, sql`NOT ${remaining}`))
  ]);
  const left = ids.length === 0 ? [] : await db.select({ id: messages.id }).from(messages).where(inArray(messages.id, ids));
  const stillThere = new Set(left.map((row) => row.id));
  const gone = rows.filter((row) => !stillThere.has(row.id));
  const goneIds = new Set(gone.map((row) => row.id));
  const objects = [
    ...gone.map((row) => row.r2_key),
    ...files.filter((file) => goneIds.has(file.message_id)).map((file) => file.r2_key)
  ].filter((objectKey): objectKey is string => objectKey !== null && objectKey !== '');
  await deleteBlobs(env, objects);
  return { deleted: gone.length, more: gone.length === CHUNK };
}

/** Carries out the due deletions of locked mail. Returns how many messages were deleted. Never throws: the cron has other work to do. */
export async function purgeLockedMail(env: Env, now = Date.now()): Promise<number> {
  const db = getDb(env.DB);
  let total = 0;
  try {
    const due: DueKey[] = await db
      .select({ key_id: userKeys.key_id, user_id: userKeys.user_id })
      .from(userKeys)
      .where(and(isNotNull(userKeys.delete_after), lte(userKeys.delete_after, now), notLive(userKeys.user_id, userKeys.key_id)))
      .limit(KEYS_PER_RUN);
    for (const key of due) {
      let deleted = 0;
      for (let round = 0; round < ROUNDS_PER_RUN; round += 1) {
        const result = await purgeChunk(env, db, key, now);
        deleted += result.deleted;
        if (!result.more) {
          break;
        }
      }
      total += deleted;
      if (deleted > 0) {
        const owner = await db.select({ email: users.email }).from(users).where(eq(users.id, key.user_id)).get();
        await db.batch([
          auditEntry(db, { id: null, email: 'scheduled job' }, 'locked_mail_deleted', owner?.email ?? '', { key_id: key.key_id, deleted })
        ]);
      }
    }
  } catch (error) {
    console.error('[edging-mail] The deletion of locked mail failed:', errorClass(error));
  }
  return total;
}
