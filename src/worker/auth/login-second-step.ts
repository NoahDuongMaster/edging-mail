import { Hono } from 'hono';
import { and, eq, lt, sql } from 'drizzle-orm';
import { signInEntry } from '../audit';
import { getDb } from '../db';
import { twoFactorChallenges } from '../db/schema';
import type { AppEnv } from '../types';
import { errorClass, jsonObject } from '../utils';
import { tempPasswordExpired, userById } from './accounts';
import { parseFactor, verifyFactor } from './second-factor';
import { signingSecret } from './session';
import { finishSignIn } from './sign-in';
import { readToken, signToken } from './tokens';
import type { Db } from '../db';
import { apiError } from '../errors';

// The second step of a sign-in with two-step verification. The password step answers with a short-lived signed challenge instead of a
// session; this step turns a challenge plus a code (or a recovery code) into the session. The challenge is single use, expires after five
// minutes, and is burned after five wrong codes.

const noop = (): void => {
  // best effort: a failed note about a failed code must not change the answer
};

export const CHALLENGE_SECONDS = 5 * 60;
const MAX_WRONG_CODES = 5;

export const loginSecondStepRoutes = new Hono<AppEnv>();

/** A challenge for this user: its `jti` is stored, so it can be used once, counted and burned. */
export async function issueChallenge(db: Db, secret: string, userId: string, shared = false): Promise<string> {
  const jti = crypto.randomUUID();
  const now = Date.now();
  await db.batch([
    // Old challenges of this user and expired ones are dropped as new ones are made.
    db.delete(twoFactorChallenges).where(lt(twoFactorChallenges.expires_at, now)),
    db
      .insert(twoFactorChallenges)
      .values({ jti, user_id: userId, attempts: 0, expires_at: now + CHALLENGE_SECONDS * 1000, created_at: now })
  ]);
  // `sh`: the password step said this is a shared device; it rides in the signed challenge to the session that the second step starts.
  return signToken(secret, 'challenge', { uid: userId, jti, ...(shared ? { sh: 1 } : {}) }, CHALLENGE_SECONDS);
}

loginSecondStepRoutes.post('/login/2fa', async (c) => {
  const startedAt = Date.now();
  const secret = signingSecret(c.env);
  if (secret === undefined) {
    return apiError(c, 'not_configured');
  }
  const body = await jsonObject<{ challenge?: unknown; code?: unknown; recovery_code?: unknown }>(c.req, [
    'challenge',
    'code',
    'recovery_code'
  ]);
  if (body === null) {
    return apiError(c, 'invalid_body');
  }
  const factor = parseFactor(body, true);
  if (typeof body.challenge !== 'string' || factor === null) {
    return apiError(c, 'invalid_request', { error: 'challenge and a code or recovery_code are required' });
  }
  const claims = await readToken(body.challenge, secret, 'challenge');
  if (typeof claims?.uid !== 'string' || typeof claims.jti !== 'string') {
    return apiError(c, 'challenge_invalid');
  }
  const db = getDb(c.env.DB);
  try {
    const challenge = await db
      .select()
      .from(twoFactorChallenges)
      .where(and(eq(twoFactorChallenges.jti, claims.jti), eq(twoFactorChallenges.user_id, claims.uid)))
      .get();
    const row = challenge === undefined ? undefined : await userById(db, claims.uid);
    // PB-2: a challenge made before the person's sessions were last revoked (break-glass, forgot password, reissue, a 2FA reset, a password
    // change) is dead whatever deleted or kept its row: this one check holds for every present and future flow.
    if (
      challenge === undefined ||
      row === undefined ||
      challenge.expires_at <= Date.now() ||
      challenge.attempts >= MAX_WRONG_CODES ||
      challenge.created_at <= row.sessions_valid_after
    ) {
      return apiError(c, 'challenge_invalid');
    }
    if (row.status !== 'active' || tempPasswordExpired(row, Date.now())) {
      return apiError(c, 'challenge_invalid');
    }
    // PX-6: the try is counted BEFORE the code is looked at, in one conditional update that only passes while fewer than five were taken, so
    // 30 parallel codes on one challenge get exactly five evaluations (reading the counter first would let every one of them through).
    const taken = await db
      .update(twoFactorChallenges)
      .set({ attempts: sql`${twoFactorChallenges.attempts} + 1` })
      .where(and(eq(twoFactorChallenges.jti, claims.jti), lt(twoFactorChallenges.attempts, MAX_WRONG_CODES)))
      .run();
    if (taken.meta.changes !== 1) {
      return apiError(c, 'challenge_invalid');
    }
    const checked = await verifyFactor(c, db, row, factor, startedAt);
    if (!checked.ok) {
      // A wrong code is what costs the challenge its try (the fifth burns it). Refused for another reason (a throttle lock, a broken secret), the
      // code was never looked at, so the try is given back.
      const note: Promise<unknown> =
        checked.response.status === 401
          ? db.batch([signInEntry(db, row.id, c.req.raw, false)])
          : db
              .update(twoFactorChallenges)
              .set({ attempts: sql`MAX(${twoFactorChallenges.attempts} - 1, 0)` })
              .where(eq(twoFactorChallenges.jti, claims.jti))
              .run();
      await note.catch(noop);
      return checked.response;
    }
    // Single use: only the request that deletes the row signs in.
    const used = await db.delete(twoFactorChallenges).where(eq(twoFactorChallenges.jti, claims.jti)).run();
    if (used.meta.changes !== 1) {
      return apiError(c, 'challenge_invalid');
    }
    return await finishSignIn(c, db, row, secret, { stepUp: true, recoveryCodeUsed: checked.recovery, shared: claims.sh === 1 });
  } catch (error) {
    console.error('[edging-mail] Second sign-in step failed:', errorClass(error));
    return apiError(c, 'unavailable', { error: 'Sign-in is temporarily unavailable' });
  }
});
