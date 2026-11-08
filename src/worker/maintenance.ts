import { and, inArray, lt, or, sql } from 'drizzle-orm';
import { getDb } from './db';
import { errorClass } from './utils';
import { auditLog, recoveryTickets, twoFactorChallenges, userSignIns } from './db/schema';
import type { Env } from './types';

// Sign-in history is kept for 90 days and at most 50 rows per person; sign-in events leave the audit log after the same 90 days
// (every other audit entry stays). Run by the cron once an hour, not every minute.
const RETAIN_MS = 90 * 24 * 60 * 60 * 1000;
const KEEP_PER_USER = 50;
const TICKET_RETAIN_MS = 24 * 60 * 60 * 1000;

/** Never throws: housekeeping must not disturb the work the cron does next to it. */
export async function pruneActivity(env: Env): Promise<void> {
  const db = getDb(env.DB);
  const cutoff = Date.now() - RETAIN_MS;
  try {
    await db.batch([
      db.delete(userSignIns).where(lt(userSignIns.at, cutoff)),
      db
        .delete(userSignIns)
        .where(
          inArray(
            userSignIns.id,
            sql`(SELECT id FROM (SELECT id, ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY at DESC, id DESC) AS rank FROM ${userSignIns}) WHERE rank > ${KEEP_PER_USER})`
          )
        ),
      db.delete(auditLog).where(and(inArray(auditLog.action, ['sign_in', 'sign_in_failed']), lt(auditLog.at, cutoff))),
      // A sign-in challenge lives five minutes: whatever is older was never used.
      db.delete(twoFactorChallenges).where(lt(twoFactorChallenges.expires_at, Date.now())),
      // PB-8: a forgot-password ticket lives ten minutes; a used or expired one (it keeps the requester's address) is dropped after a day.
      db
        .delete(recoveryTickets)
        .where(or(lt(recoveryTickets.exp, Date.now() - TICKET_RETAIN_MS), lt(recoveryTickets.used_at, Date.now() - TICKET_RETAIN_MS)))
    ]);
  } catch (error) {
    console.error('[edging-mail] Could not prune old sign-in records:', errorClass(error));
  }
}
