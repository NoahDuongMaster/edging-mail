import type { Context } from 'hono';
import { eq } from 'drizzle-orm';
import { auditEntry, signInEntry } from '../audit';
import type { Db } from '../db';
import { users } from '../db/schema';
import type { AppEnv } from '../types';
import { keyBundle, loadPolicy, sessionUser } from './accounts';
import type { UserRow } from './accounts';
import { openGate } from './middleware';
import { startSession } from './session';

/**
 * The end of a successful sign-in, with or without a second factor: records it (last sign-in, audit, the person's own history), starts the
 * session and answers with the account, its key bundle (the wraps the browser opens with the password) and the gate that is open, if any.
 * `stepUp`: a second factor was checked in this request, so the session starts with the step-up mark. `shared`: the person said this is a
 * shared or public device (CK-17): the session is a browser-session cookie and lives twelve hours at most.
 */
export async function finishSignIn(
  c: Context<AppEnv>,
  db: Db,
  row: UserRow,
  secret: string,
  options: { stepUp: boolean; recoveryCodeUsed?: boolean; shared?: boolean }
): Promise<Response> {
  const now = Date.now();
  const actor = { id: row.id, email: row.email };
  await db.batch([
    db.update(users).set({ last_login_at: now }).where(eq(users.id, row.id)),
    auditEntry(
      db,
      actor,
      'sign_in',
      row.email,
      options.stepUp ? { second_factor: options.recoveryCodeUsed === true ? 'recovery_code' : 'totp' } : {}
    ),
    ...(options.recoveryCodeUsed === true ? [auditEntry(db, actor, 'recovery_code_used', row.email)] : []),
    signInEntry(db, row.id, c.req.raw, true)
  ]);
  await startSession(c, secret, row.id, row.sessions_valid_after, options.stepUp ? now : 0, { shared: options.shared === true });
  const user = sessionUser(row, await loadPolicy(db), options.stepUp ? now : 0);
  const keys = keyBundle(row);
  const gate = openGate(user);
  return c.json({ success: true, user, ...(keys === null ? {} : { keys }), ...(gate === undefined ? {} : { gate: gate.code }) });
}
