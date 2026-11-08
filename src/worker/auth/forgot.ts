import { Hono } from 'hono';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { auditEntryIf, signInEntry } from '../audit';
import { batchChanges, getDb } from '../db';
import type { BatchQuery } from '../db';
import { recoveryTickets, twoFactorChallenges, users } from '../db/schema';
import { closeSockets } from '../realtime';
import { pushNotice, securityEvent } from '../security';
import type { AppEnv } from '../types';
import { errorClass, jsonObject } from '../utils';
import {
  createSecretVerifier,
  createVerifier,
  dataMacs,
  decodeAuth,
  decodeCanonical,
  dummyVerifySecret,
  isAuthValue,
  isUsableIterations,
  KDF_VERSION,
  toBase64Url,
  verifySecret
} from '../../shared/crypto/server';
import type { SecretVerifier } from '../../shared/crypto/server';
import { userByEmail, userById } from './accounts';
import type { UserRow } from './accounts';
import { dropLockedDeletions, keySetColumns, parseWrap } from './keys';
import { dataKeysOf } from './secrets';
import { evaluateFactor, factorUsed, parseFactor, useFactorQuery } from './second-factor';
import type { FactorInput } from './second-factor';
import { ACCOUNT_POLICY, CLIENT_POLICY, claimAttempt, clearAttempts, clientKey, failureDelay } from './throttle';
import { apiError } from '../errors';

// Forgot password (crypto-design.md 15.3): self-service with the recovery key, in two requests, and NO state change before the person has
// confirmed a NEW recovery key. `verify` proves possession of the recovery key (and the second factor, when enrolled) and hands out a
// single-use ticket bound to the key state it was issued for; `complete` swaps the password wrap, the recovery wrap and both verifiers in
// ONE guarded batch, revokes every session and does not sign anyone in. The server never sees the recovery key, the private key or a password.

/** The recovery verifier of an account, or null when it has none (unknown address, or no keys yet). */
function recoveryOf(user: UserRow | undefined): SecretVerifier | null {
  if (user === undefined || user.recovery_verifier === null || user.recovery_salt === null || user.recovery_iterations === null) {
    return null;
  }
  return { verifier: user.recovery_verifier, salt: user.recovery_salt, iterations: user.recovery_iterations };
}

export const forgotRoutes = new Hono<AppEnv>();

const MAX_EMAIL_CHARS = 320;
const TICKET_BYTES = 32;
const TICKET_SECONDS = 10 * 60;
// The same answer for an unknown address, a wrong key, a wrong or missing code, and an account that has no keys.

const forgotKeys = (request: Request, email: string): string[] => [`forgot:${clientKey(request)}`, `forgotacct:${email.slice(0, 200)}`];
// The budget of the second factor, reached only by somebody who already holds the recovery key (PB-1).
const factorKey = (userId: string): string => `forgot2fa:${userId}`;

forgotRoutes.post('/forgot/verify', async (c) => {
  const startedAt = Date.now();
  const keys = await dataKeysOf(c.env);
  if (keys === undefined) {
    return apiError(c, 'not_configured');
  }
  const body = await jsonObject<{ email?: unknown; recovery_auth?: unknown; kdf?: unknown; code?: unknown; recovery_code?: unknown }>(
    c.req,
    ['email', 'recovery_auth', 'kdf', 'code', 'recovery_code']
  );
  if (body === null) {
    return apiError(c, 'invalid_body');
  }
  const recoveryAuth = decodeAuth(body.recovery_auth);
  const hasFactor = body.code !== undefined || body.recovery_code !== undefined;
  const factor: FactorInput | null = hasFactor ? parseFactor(body, true) : null;
  if (typeof body.email !== 'string' || recoveryAuth === null || body.kdf !== KDF_VERSION || (hasFactor && factor === null)) {
    return apiError(c, 'invalid_request', { error: 'email, recovery_auth and kdf are required' });
  }
  const email = body.email.trim().toLowerCase().slice(0, MAX_EMAIL_CHARS);
  const db = getDb(c.env.DB);

  // The counters are read BEFORE any key derivation (a locked key space costs the deployment nothing), under their own key spaces so that
  // locking this flow never blocks sign-in. An unknown address counts like a known one: the lock looks the same. PB-1: a wrong key is counted per
  // client address (escalating) and per account with the FIXED account policy, so a stranger who only knows an address can never keep the owner out
  // for more than one 15 minute lock at a time; the escalating budget is the one of the second factor, behind the right key (below).
  const throttleKeys = forgotKeys(c.req.raw, email);
  try {
    const claims = [
      await claimAttempt(db, throttleKeys[0], startedAt, CLIENT_POLICY),
      await claimAttempt(db, throttleKeys[1], startedAt, ACCOUNT_POLICY)
    ];
    const blocked = claims.filter((claim) => !claim.allowed);
    if (blocked.length > 0) {
      const retryAfter = Math.max(...blocked.map((claim) => claim.retryAfter));
      c.header('Retry-After', String(retryAfter));
      return apiError(c, 'too_many_attempts', { retry_after: retryAfter });
    }
  } catch (error) {
    console.error('[edging-mail] Forgot-password throttle unavailable:', errorClass(error));
    return apiError(c, 'unavailable', { error: 'Recovery is temporarily unavailable' });
  }

  // Always the same work: the key check (a dummy for an unknown account or one without keys), then the factor evaluation, which changes nothing.
  const user = await userByEmail(db, email);
  const stored = recoveryOf(user);
  const keyRight =
    stored !== null && isUsableIterations(stored.iterations)
      ? await verifySecret(recoveryAuth, stored)
      : await dummyVerifySecret(recoveryAuth);
  const needsFactor = stored !== null && user?.totp_enabled === 1;
  // The right key with a missing or wrong code: an escalating per-account budget that only a holder of the key can spend. When it is locked the answer is
  // exactly that of a wrong key (same text, same delay), so a locked state tells nothing.
  let factorLocked = false;
  if (user !== undefined && keyRight && needsFactor) {
    try {
      const claim = await claimAttempt(db, factorKey(user.id), startedAt, CLIENT_POLICY);
      factorLocked = !claim.allowed;
    } catch (error) {
      console.error('[edging-mail] Forgot-password throttle unavailable:', errorClass(error));
      return apiError(c, 'unavailable', { error: 'Recovery is temporarily unavailable' });
    }
  }
  const evaluated = factorLocked ? null : await evaluateFactor(db, keys, stored === null ? undefined : user, factor);
  if (user === undefined || stored === null || !keyRight || (needsFactor && evaluated === null)) {
    await failureDelay(db, startedAt);
    return apiError(c, 'recovery_failed');
  }
  if (user.status !== 'active') {
    // Said only to someone who proved the key and the code.
    return apiError(c, 'account_disabled');
  }

  // Both are right: use the factor, replace any older ticket and issue the new one in one batch. The statements after the use of the factor
  // apply only if it was used by THIS request, so two parallel verifies with one code cannot both get a ticket.
  const now = Date.now();
  const ticket = toBase64Url(crypto.getRandomValues(new Uint8Array(TICKET_BYTES)));
  const macs = await dataMacs(keys, 'forgotTicket', ticket);
  const hmac = macs.current;
  const guard = evaluated === null ? undefined : factorUsed(user, evaluated, now);
  const actor = { id: user.id, email: user.email };
  const queries: BatchQuery[] = [
    ...(evaluated === null ? [] : [useFactorQuery(db, user, evaluated, now)]),
    db
      .delete(recoveryTickets)
      .where(guard === undefined ? eq(recoveryTickets.user_id, user.id) : and(eq(recoveryTickets.user_id, user.id), guard)),
    guard === undefined
      ? db.insert(recoveryTickets).values({
          ticket_hmac: hmac,
          user_id: user.id,
          key_id: user.key_id ?? '',
          keys_version: user.keys_version,
          exp: now + TICKET_SECONDS * 1000,
          created_at: now,
          ip: c.req.raw.headers.get('CF-Connecting-IP')?.slice(0, 64) ?? null
        })
      : db
          .insert(recoveryTickets)
          .select(
            sql`SELECT ${hmac}, ${user.id}, ${user.key_id ?? ''}, ${user.keys_version}, ${now + TICKET_SECONDS * 1000}, NULL, ${now}, ${c.req.raw.headers.get('CF-Connecting-IP')?.slice(0, 64) ?? null} WHERE ${guard}`
          ),
    securityEvent(db, user.id, 'recovery_started', now, null, {}, guard),
    signInEntry(db, user.id, c.req.raw, true, 'recovery_started', guard),
    auditEntryIf(db, guard ?? sql`1`, actor, 'recovery_started', user.email)
  ];
  let changes: number[];
  try {
    changes = await batchChanges(db, queries);
  } catch (error) {
    console.error('[edging-mail] Forgot-password verify failed:', errorClass(error));
    return apiError(c, 'unavailable', { error: 'Recovery is temporarily unavailable' });
  }
  if (evaluated !== null && changes[0] !== 1) {
    // Somebody used the same code between the evaluation and the batch: nothing above was written.
    await failureDelay(db, startedAt);
    return apiError(c, 'recovery_failed');
  }
  await clearAttempts(db, [...throttleKeys, factorKey(user.id)]);
  c.executionCtx.waitUntil(pushNotice(c.env, db, user.id, 'recovery_started', { at: now }));
  return c.json({
    success: true,
    ticket,
    public_key: user.public_key,
    key_id: user.key_id,
    keys_version: user.keys_version,
    wrapped_private_key_recovery: user.wrapped_private_key_recovery,
    min_password_length: user.role === 'admin' ? 16 : 12
  });
});

forgotRoutes.post('/forgot/complete', async (c) => {
  const startedAt = Date.now();
  const keys = await dataKeysOf(c.env);
  if (keys === undefined) {
    return apiError(c, 'not_configured');
  }
  const body = await jsonObject<{
    ticket?: unknown;
    new_auth?: unknown;
    kdf?: unknown;
    wrapped_private_key_pw?: unknown;
    wrapped_private_key_recovery?: unknown;
    recovery_auth?: unknown;
  }>(c.req, ['ticket', 'new_auth', 'kdf', 'wrapped_private_key_pw', 'wrapped_private_key_recovery', 'recovery_auth']);
  if (body === null) {
    return apiError(c, 'invalid_body');
  }
  const wrappedPw = parseWrap(body.wrapped_private_key_pw);
  const wrappedRecovery = parseWrap(body.wrapped_private_key_recovery);
  const newRecoveryAuth = decodeAuth(body.recovery_auth);
  if (
    decodeCanonical(body.ticket, TICKET_BYTES) === null ||
    typeof body.ticket !== 'string' ||
    !isAuthValue(body.new_auth) ||
    body.kdf !== KDF_VERSION ||
    wrappedPw === null ||
    wrappedRecovery === null ||
    newRecoveryAuth === null
  ) {
    return apiError(c, 'invalid_request', { error: 'ticket, new_auth, kdf, both wrapped keys and recovery_auth are required' });
  }
  const db = getDb(c.env.DB);
  const throttleKey = `forgot:${clientKey(c.req.raw)}`;
  try {
    const claim = await claimAttempt(db, throttleKey, startedAt, CLIENT_POLICY);
    if (!claim.allowed) {
      c.header('Retry-After', String(claim.retryAfter));
      return apiError(c, 'too_many_attempts', { retry_after: claim.retryAfter });
    }
  } catch (error) {
    console.error('[edging-mail] Forgot-password throttle unavailable:', errorClass(error));
    return apiError(c, 'unavailable', { error: 'Recovery is temporarily unavailable' });
  }

  const { all } = await dataMacs(keys, 'forgotTicket', body.ticket);
  const stored = await db.select().from(recoveryTickets).where(inArray(recoveryTickets.ticket_hmac, all)).get();
  const user = stored === undefined ? undefined : await userById(db, stored.user_id);
  if (stored === undefined || user === undefined || stored.used_at !== null || stored.exp <= startedAt) {
    await failureDelay(db, startedAt);
    return apiError(c, 'ticket_invalid');
  }
  if (user.status !== 'active') {
    return apiError(c, 'account_disabled');
  }
  if (user.key_id !== stored.key_id || user.keys_version !== stored.keys_version) {
    return apiError(c, 'recovery_stale');
  }

  // The new password need NOT differ from the old one: that rule would make this route an oracle for guesses of the old password.
  const now = Date.now();
  const verifier = await createVerifier(body.new_auth);
  const recovery = await createSecretVerifier(newRecoveryAuth);
  const ticketHmac = stored.ticket_hmac;
  const ticketOpen = sql`EXISTS (SELECT 1 FROM ${recoveryTickets} WHERE ${recoveryTickets.ticket_hmac} = ${ticketHmac} AND ${recoveryTickets.used_at} IS NULL
    AND ${recoveryTickets.exp} > ${now} AND ${recoveryTickets.user_id} = ${user.id} AND ${recoveryTickets.key_id} = ${stored.key_id} AND ${recoveryTickets.keys_version} = ${stored.keys_version})`;
  const applied = sql`EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${user.id} AND ${users.keys_version} = ${stored.keys_version + 1} AND ${users.updated_at} = ${now})`;
  const actor = { id: user.id, email: user.email };
  let changes: number[];
  try {
    changes = await batchChanges(db, [
      // The user row first: its `changes` says who won; every statement carries the guard, because a D1 batch does not stop at changes = 0.
      db
        .update(users)
        .set({
          ...verifier,
          ...keySetColumns(
            {
              public_key: user.public_key ?? '',
              key_id: user.key_id,
              wrapped_private_key_pw: wrappedPw,
              wrapped_private_key_recovery: wrappedRecovery,
              recovery_verifier: recovery.verifier,
              recovery_salt: recovery.salt,
              recovery_iterations: recovery.iterations
            },
            now
          ),
          keys_version: stored.keys_version + 1,
          must_change_password: 0,
          temp_password_expires_at: null,
          sessions_valid_after: now,
          updated_at: now
        })
        .where(and(eq(users.id, user.id), eq(users.key_id, stored.key_id), eq(users.keys_version, stored.keys_version), ticketOpen)),
      db
        .update(recoveryTickets)
        .set({ used_at: now })
        .where(and(eq(recoveryTickets.ticket_hmac, ticketHmac), sql`${recoveryTickets.used_at} IS NULL`, applied)),
      db.delete(recoveryTickets).where(and(eq(recoveryTickets.user_id, user.id), ne(recoveryTickets.ticket_hmac, ticketHmac), applied)),
      db.delete(twoFactorChallenges).where(and(eq(twoFactorChallenges.user_id, user.id), applied)),
      dropLockedDeletions(db, user.id, applied),
      auditEntryIf(db, applied, actor, 'password_recovered', user.email),
      securityEvent(db, user.id, 'password_recovered', now, null, {}, applied),
      signInEntry(db, user.id, c.req.raw, true, 'password_recovered', applied)
    ]);
  } catch (error) {
    console.error('[edging-mail] Forgot-password complete failed:', errorClass(error));
    return apiError(c, 'server_error', { error: 'The password could not be reset' });
  }
  if (changes[0] !== 1) {
    return apiError(c, 'recovery_stale');
  }
  await clearAttempts(db, [throttleKey]);
  await closeSockets(c.env, user.id);
  c.executionCtx.waitUntil(pushNotice(c.env, db, user.id, 'password_recovered', { at: now }));
  // It does NOT sign in: the person signs in with the new password (and two-step verification).
  return c.json({ success: true });
});
