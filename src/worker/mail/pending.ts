import { and, eq, isNotNull } from 'drizzle-orm';
import { dataKeysOf } from '../auth/secrets';
import { getDb } from '../db';
import { messages, users } from '../db/schema';
import type { Env } from '../types';
import { errorClass } from '../utils';
import { decodeCanonical, fromBase64Url, openData, parsePublicKey } from '../../shared/crypto/server';
import type { PublicKey } from '../../shared/crypto/server';
import { wrapCek } from './seal';

// Pending mail: mail for an owner who has no key yet is stored with its content key sealed under DATA_KEY (wrap_kind 'server') and is
// NOT zero-access until the owner uploads a public key. From then on this re-seals each content key to that key (HPKE) and flips the row to
// 'user'. Only the small `wrapped_cek` changes, never the blobs. Idempotent: a row that is already 'user' is skipped, and the update only
// applies while the row is still pending. Called right after a key upload (that user, a small batch) and by the cron (everybody).

const DEFAULT_BATCH = 100;

/** How many rows were re-sealed. Never throws: it runs after a response, or in the cron, and must not disturb either. */
export async function rewrapPending(env: Env, userId?: string, limit = DEFAULT_BATCH): Promise<number> {
  try {
    const keys = await dataKeysOf(env);
    if (keys === undefined) {
      return 0;
    }
    const db = getDb(env.DB);
    const rows = await db
      .select({ id: messages.id, user_id: messages.user_id, wrapped_cek: messages.wrapped_cek, public_key: users.public_key })
      .from(messages)
      .innerJoin(users, eq(users.id, messages.user_id))
      .where(
        and(eq(messages.wrap_kind, 'server'), isNotNull(users.public_key), userId === undefined ? undefined : eq(messages.user_id, userId))
      )
      .limit(limit);
    const parsed = new Map<string, PublicKey | null>();
    let done = 0;
    for (const row of rows) {
      if (row.user_id === null || row.public_key === null || row.wrapped_cek === null) {
        continue;
      }
      if (!parsed.has(row.user_id)) {
        const spki = decodeCanonical(row.public_key);
        parsed.set(row.user_id, spki === null ? null : await parsePublicKey(spki).catch(() => null));
      }
      const key = parsed.get(row.user_id);
      if (key === null || key === undefined) {
        continue;
      }
      try {
        const cek = await openData(keys, 'pendingCek', row.id, fromBase64Url(row.wrapped_cek));
        const wrap = await wrapCek({ kind: 'user', key }, row.id, cek);
        const result = await db
          .update(messages)
          .set(wrap)
          .where(and(eq(messages.id, row.id), eq(messages.wrap_kind, 'server'), eq(messages.user_id, row.user_id)))
          .run();
        done += result.meta.changes;
      } catch (error) {
        // One damaged row (or a DATA_KEY that cannot open it) must not stop the others; ids and the error class only.
        console.error(`[edging-mail] Could not re-seal pending message ${row.id}: ${errorClass(error)}`);
      }
    }
    return done;
  } catch (error) {
    console.error('[edging-mail] Pending-mail re-sealing failed:', errorClass(error));
    return 0;
  }
}
