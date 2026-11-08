import { Hono } from 'hono';
import type { Context } from 'hono';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { auditEntry, signInEntry } from '../audit';
import { getDb, runBatch } from '../db';
import { pushSubscriptions, settings, userSignIns } from '../db/schema';
import { closeSockets } from '../realtime';
import type { AppEnv, Env } from '../types';
import { errorClass, jsonObject, nonEmpty } from '../utils';
import { hasUsers, loadDefaultLanguage, revokeSessions, tempPasswordExpired, userByEmail } from './accounts';
import { currentUser, openGate } from './middleware';
import { dummyVerify, fromBase64Url, isAuthValue, KDF_VERSION, openData, verifyAuth } from '../../shared/crypto/server';
import { issueChallenge, loginSecondStepRoutes } from './login-second-step';
import { dataKeysOf, missingSecrets, signInConfigured } from './secrets';
import { endSession, sessionIsShared, signingSecret } from './session';
import { finishSignIn } from './sign-in';
import {
  ACCOUNT_POLICY,
  CLIENT_POLICY,
  claimAttempt,
  clearAttempts,
  clientKey,
  failureDelay,
  giveBackAttempt,
  holdFloor
} from './throttle';
import type { Claim } from './throttle';
import { apiError, failed } from '../errors';

export const loginRoutes = new Hono<AppEnv>();
loginRoutes.route('/', loginSecondStepRoutes);

const MAX_EMAIL_CHARS = 320;
const ACTIVITY_LIMIT = 50;
// The longest push endpoint the subscribe route accepts (push.ts); a longer one cannot be stored, so there is nothing to delete.
const MAX_PUSH_ENDPOINT_CHARS = 2048;
// The same text for an unknown address and a wrong credential (AC4).

/** Setup form prefill: the address of the old settings row or the DEFAULT_FROM var, and the old display name. */
async function setupDefaults(env: Env): Promise<{ default_from?: string; default_display_name?: string }> {
  const rows = await getDb(env.DB)
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, ['default_from', 'display_name']));
  const saved = new Map(rows.map((row) => [row.key, row.value]));
  const defaultFrom = nonEmpty(saved.get('default_from')) ?? nonEmpty(env.DEFAULT_FROM);
  const defaultName = nonEmpty(saved.get('display_name'));
  return {
    ...(defaultFrom === undefined ? {} : { default_from: defaultFrom }),
    ...(defaultName === undefined ? {} : { default_display_name: defaultName })
  };
}

// Never an error status for "not signed in": the client decides which screen to show from this answer.
loginRoutes.get('/session', async (c) => {
  try {
    const user = c.get('user');
    if (user !== null) {
      return c.json({
        success: true,
        authenticated: true,
        configured: true,
        setup_required: false,
        user,
        gate: openGate(user)?.code ?? null,
        // The person's own language (null until they choose one) and the organisation's: what the client resolves the UI language from
        language: user.language,
        default_language: await loadDefaultLanguage(getDb(c.env.DB)),
        // True exactly when this session was started on a shared device: the unlock screen starts with its "shared device" box ticked (C-5b).
        shared: await sessionIsShared(c)
      });
    }
    const missing = await missingSecrets(c.env);
    const setupRequired = !(await hasUsers(getDb(c.env.DB)));
    return c.json({
      success: true,
      authenticated: false,
      // Sign-in works when JWT_SECRET and DATA_KEY are usable; Setup also needs APP_PASSWORD
      configured: setupRequired ? missing.length === 0 : !missing.some((name) => name !== 'APP_PASSWORD'),
      setup_required: setupRequired,
      default_language: await loadDefaultLanguage(getDb(c.env.DB)),
      // NAMES only, never values, and only while nobody has set the app up yet (so the Setup screen can list them)
      ...(setupRequired ? { missing_secrets: missing, ...(await setupDefaults(c.env)) } : {})
    });
  } catch (error) {
    console.error('[edging-mail] Session lookup failed:', errorClass(error));
    return apiError(c, 'server_error', { error: 'Could not read the session' });
  }
});

// Two throttles guard a sign-in: per client address and per account. Both count the attempt before the credential is compared. The
// account key is the typed address whether or not it exists, so a lock reveals nothing about which addresses are real.
async function claimBoth(c: Context<AppEnv>, email: string): Promise<Claim & { blocked: boolean }> {
  const db = getDb(c.env.DB);
  const now = Date.now();
  const byClient = await claimAttempt(db, clientKey(c.req.raw), now, CLIENT_POLICY);
  const byAccount = await claimAttempt(db, `acct:${email}`, now, ACCOUNT_POLICY);
  const blocked = !byClient.allowed || !byAccount.allowed;
  return {
    blocked,
    allowed: !blocked,
    fresh: byClient.fresh || byAccount.fresh,
    retryAfter: Math.max(byClient.allowed ? 0 : byClient.retryAfter, byAccount.allowed ? 0 : byAccount.retryAfter)
  };
}

async function signIn(c: Context<AppEnv, '/login'>, startedAt: number): Promise<Response> {
  const secret = signingSecret(c.env);
  if (secret === undefined || !(await signInConfigured(c.env))) {
    return apiError(c, 'not_configured');
  }
  const body = await jsonObject<{ email?: unknown; auth?: unknown; kdf?: unknown; shared?: unknown }>(c.req, [
    'email',
    'auth',
    'kdf',
    'shared'
  ]);
  if (body === null) {
    return apiError(c, 'invalid_body');
  }
  if (
    typeof body.email !== 'string' ||
    !isAuthValue(body.auth) ||
    body.kdf !== KDF_VERSION ||
    (body.shared !== undefined && typeof body.shared !== 'boolean')
  ) {
    return apiError(c, 'invalid_request', { error: 'email, auth and kdf are required' });
  }
  const shared = body.shared === true;
  const email = body.email.trim().toLowerCase().slice(0, MAX_EMAIL_CHARS);
  const auth = body.auth;
  const db = getDb(c.env.DB);

  let claim;
  try {
    claim = await claimBoth(c, email);
  } catch (error) {
    // Without the throttle there is no sign-in.
    console.error('[edging-mail] Sign-in throttle unavailable:', errorClass(error));
    return apiError(c, 'unavailable', { error: 'Sign-in is temporarily unavailable' });
  }
  if (claim.blocked) {
    c.header('Retry-After', String(claim.retryAfter));
    return apiError(c, 'too_many_attempts', { retry_after: claim.retryAfter });
  }

  const user = await userByEmail(db, email);
  const genuine = user === undefined ? await dummyVerify(auth) : await verifyAuth(auth, user);
  // An expired temporary password fails like a wrong one (the answer does not tell them apart); only the audit log does.
  const expired = genuine && user !== undefined && tempPasswordExpired(user, Date.now());
  if (user === undefined || !genuine || expired) {
    if (user !== undefined) {
      // Written after the answer has gone: the extra write of a known address must not make its answer slower than an unknown one's.
      c.executionCtx.waitUntil(
        db
          .batch([
            auditEntry(db, { id: user.id, email: user.email }, expired ? 'temp_password_expired' : 'sign_in_failed', user.email),
            signInEntry(db, user.id, c.req.raw, false)
          ])
          .catch((error: unknown) => {
            console.error('[edging-mail] Could not record a failed sign-in:', errorClass(error));
          })
      );
    }
    await failureDelay(db, startedAt);
    return apiError(c, 'wrong_credentials');
  }

  // PX-1: only the account's own counter is forgotten, and only for an account that may sign in (a disabled one forgets nothing). The client's
  // counter is not cleared (a member could otherwise put one own sign-in after every few guesses at colleagues and never be throttled); a right
  // password only stops counting there, so people behind one address (an office) do not use each other's room up.
  if (user.status !== 'active') {
    // Said only to someone who proved the credential, and no cookie is issued.
    await db.batch([
      auditEntry(db, { id: user.id, email: user.email }, 'sign_in_failed', user.email, { reason: 'disabled' }),
      signInEntry(db, user.id, c.req.raw, false)
    ]);
    return apiError(c, 'account_disabled');
  }
  await clearAttempts(db, [`acct:${email}`]);
  await giveBackAttempt(db, clientKey(c.req.raw));

  if (user.totp_enabled === 1) {
    // The password is right: no session, no keys and no profile yet, only a challenge for the second step.
    const keys = await dataKeysOf(c.env);
    try {
      if (keys === undefined || user.totp_secret_enc === null) {
        throw new Error('no secret');
      }
      await openData(keys, 'totp', user.id, fromBase64Url(user.totp_secret_enc));
    } catch {
      // A secret that cannot be opened cannot be satisfied: refuse the sign-in rather than skip the second factor.
      return apiError(c, 'two_factor_broken');
    }
    return c.json({ success: true, two_factor_required: true, challenge: await issueChallenge(db, secret, user.id, shared) });
  }
  return finishSignIn(c, db, user, secret, { stepUp: false, shared });
}

loginRoutes.post('/login', async (c) => {
  const startedAt = Date.now();
  const answer = await signIn(c, startedAt);
  // Every refusal of this endpoint takes at least the floor, whatever refused it (an unknown address, a wrong credential, a throttle, a malformed
  // body): the time of an answer says nothing about which branch made it. A wrong credential has waited already (`failureDelay`), so this adds
  // nothing there. A success is not held: only someone who proved the credential sees one.
  if (answer.status >= 400) {
    await holdFloor(startedAt);
  }
  return answer;
});

// Revokes every session of this user, on all devices, and closes their open WebSockets. Idempotent; signed out it only clears the cookie
// (anyone could otherwise sign the owner out).
// The browser may add `push_endpoint` (its own Web Push endpoint): that one subscription of the caller is deleted in the same batch, so a device
// that can no longer reach the push service is not left behind (CK-16). Anything else in the body, or a bad value, is ignored: signing out must work.
loginRoutes.post('/logout', async (c) => {
  endSession(c);
  const user = c.get('user');
  if (user !== null) {
    try {
      const db = getDb(c.env.DB);
      const body = await c.req.json<unknown>().catch(() => null);
      const named = typeof body === 'object' && body !== null ? (body as { push_endpoint?: unknown }).push_endpoint : undefined;
      const endpoint = typeof named === 'string' && named !== '' && named.length <= MAX_PUSH_ENDPOINT_CHARS ? named : undefined;
      await runBatch(db, [
        revokeSessions(db, user.id, Date.now()),
        ...(endpoint === undefined
          ? []
          : [db.delete(pushSubscriptions).where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.user_id, user.id)))])
      ]);
    } catch (error) {
      console.error('[edging-mail] Sign-out could not revoke sessions:', errorClass(error));
      return apiError(c, 'server_error', { error: 'Could not sign out on the server' });
    }
    await closeSockets(c.env, user.id);
  }
  return c.json({ success: true });
});

// The caller's own recent sign-ins (newest first) and account notices, for Settings > Account.
loginRoutes.get('/activity', async (c) => {
  const user = currentUser(c);
  try {
    const rows = await getDb(c.env.DB)
      .select({ at: userSignIns.at, ip: userSignIns.ip, user_agent: userSignIns.user_agent, ok: userSignIns.ok, kind: userSignIns.kind })
      .from(userSignIns)
      .where(eq(userSignIns.user_id, user.id))
      .orderBy(desc(userSignIns.at), desc(userSignIns.id))
      .limit(ACTIVITY_LIMIT);
    return c.json({ success: true, activity: rows.map((row) => ({ ...row, ok: row.ok === 1 })) });
  } catch (error) {
    return failed(c, error);
  }
});
