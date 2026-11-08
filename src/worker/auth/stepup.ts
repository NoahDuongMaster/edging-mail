import type { Context } from 'hono';
import type { Db } from '../db';
import { errorClass } from '../utils';
import type { AppEnv } from '../types';
import { verifyAuth } from '../../shared/crypto/server';
import type { UserRow } from './accounts';
import { ACCOUNT_POLICY, claimAttempt, clearAttempts, failureDelay } from './throttle';
import { apiError } from '../errors';

// "Confirm with your password" for every request that changes key material, enrolls or removes a second factor or sets a new password
// (RR-4). The request carries `current_auth`; wrong guesses are counted under their OWN key (`stepup:<id>`), never under the sign-in key,
// so somebody holding a stolen cookie can guess here without locking the owner out of signing in.

/** null when `current_auth` is right (counter cleared); otherwise the response to return as is (429, 503 or 403). */
export async function confirmCurrentAuth(
  c: Context<AppEnv>,
  db: Db,
  row: UserRow,
  currentAuth: string,
  startedAt: number
): Promise<Response | null> {
  const key = `stepup:${row.id}`;
  let claim;
  try {
    claim = await claimAttempt(db, key, startedAt, ACCOUNT_POLICY);
  } catch (error) {
    console.error('[edging-mail] Step-up throttle unavailable:', errorClass(error));
    return apiError(c, 'unavailable', { error: 'This action is temporarily unavailable' });
  }
  if (!claim.allowed) {
    c.header('Retry-After', String(claim.retryAfter));
    return apiError(c, 'too_many_attempts', { retry_after: claim.retryAfter });
  }
  if (!(await verifyAuth(currentAuth, row))) {
    await failureDelay(db, startedAt);
    return apiError(c, 'wrong_password');
  }
  await clearAttempts(db, [key]);
  return null;
}
