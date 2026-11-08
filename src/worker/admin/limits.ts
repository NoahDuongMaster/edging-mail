import { and, count, eq, inArray, sql } from 'drizzle-orm';
import { auditLog } from '../db/schema';
import type { Db } from '../db';

// One cap for the admin actions that hand out a temporary password: creating an account and reissuing the password of one that was never
// opened. Counted from the audit log (the rows are written in the same batch as the action), per acting admin.

const ACCOUNT_OPS_PER_HOUR = 60;

export async function accountOpsExhausted(db: Db, actorId: string, now = Date.now()): Promise<boolean> {
  const recent = await db
    .select({ total: count() })
    .from(auditLog)
    .where(
      and(
        eq(auditLog.actor_user_id, actorId),
        inArray(auditLog.action, ['user.create', 'temp_password_reissued']),
        sql`${auditLog.at} > ${now - 3_600_000}`
      )
    )
    .get();
  return (recent?.total ?? 0) >= ACCOUNT_OPS_PER_HOUR;
}
