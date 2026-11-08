import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { errorMessage, getDb } from '../db';
import { signInEntry } from '../audit';
import { recoveryTickets } from '../db/schema';
import { pushNotice, securityEvent } from '../security';
import { rewrapPending } from '../mail/pending';
import type { AppEnv } from '../types';
import { errorClass, jsonObject } from '../utils';
import { createSecretVerifier, decodeAuth, isAuthValue } from '../../shared/crypto/server';
import { keyBundle, loadPolicy, sessionUser, userById } from './accounts';
import type { UserRow } from './accounts';
import { appliedGuard, keySetColumns, parseKeySet, parseWrap, updateKeyMaterial } from './keys';
import { lookupKeys } from './lookup';
import { lockedRoutes, retiredKeysOf } from './locked';
import { currentUser, hasStepUp } from './middleware';
import { confirmCurrentAuth } from './stepup';
import { claimAttempt, LOOKUP_POLICY } from './throttle';
import { apiError } from '../errors';

// /api/keys: the signed-in user's key bundle, the key setup, the recovery-key wrap, and the public-key lookup for internal mail. The
// server stores and serves wrapped keys and public keys; it never holds, sees or accepts an unwrapped private key.

export const keyRoutes = new Hono<AppEnv>();

// Old mail locked under a retired key: delete it (after seven days) or cancel that, see locked.ts.
keyRoutes.route('/', lockedRoutes);

const MAX_LOOKUP = 50;

const userViewOf = async (db: ReturnType<typeof getDb>, row: UserRow) => sessionUser(row, await loadPolicy(db), 0);

keyRoutes.get('/me', async (c) => {
  try {
    const db = getDb(c.env.DB);
    const row = await userById(db, currentUser(c).id);
    if (row === undefined) {
      return apiError(c, 'unauthorized');
    }
    const retired = await retiredKeysOf(db, row.id);
    return c.json({ success: true, keys: keyBundle(row), retired });
  } catch (error) {
    console.error('[edging-mail] Could not read the key bundle:', errorClass(error));
    return apiError(c, 'server_error', { error: 'Could not read your keys' });
  }
});

// The public key of each internal recipient, for end-to-end mail. Authenticated, at most 50 addresses a call, throttled per user. An alias
// resolves to its owner's key; an address nobody owns is `internal: false`; an owner without keys yet is `internal: true` with no key.
keyRoutes.post('/lookup', async (c) => {
  const body = await jsonObject<{ addresses?: unknown }>(c.req, ['addresses']);
  if (body === null) {
    return apiError(c, 'invalid_body');
  }
  if (
    !Array.isArray(body.addresses) ||
    body.addresses.length === 0 ||
    body.addresses.length > MAX_LOOKUP ||
    !body.addresses.every((a) => typeof a === 'string' && a.length <= 320)
  ) {
    return apiError(c, 'invalid_request', { error: `addresses must be a list of 1 to ${MAX_LOOKUP} addresses` });
  }
  const db = getDb(c.env.DB);
  try {
    const claim = await claimAttempt(db, `lookup:${currentUser(c).id}`, Date.now(), LOOKUP_POLICY);
    if (!claim.allowed) {
      c.header('Retry-After', String(claim.retryAfter));
      return apiError(c, 'too_many_lookups', { retry_after: claim.retryAfter });
    }
    const asked = [...new Set((body.addresses as string[]).map((address) => address.trim().toLowerCase()))];
    return c.json({ success: true, keys: await lookupKeys(db, asked) });
  } catch (error) {
    console.error('[edging-mail] Key lookup failed:', errorClass(error));
    return apiError(c, 'unavailable', { error: 'Lookup is temporarily unavailable' });
  }
});

// The key setup (gate `key_setup_required`): the FIRST keys of an account that has none: the key pair, its password wrap, the recovery wrap and
// `recovery_auth` (the proof of the recovery key) arrive in ONE request, so there is no state with keys but no way back. It works only
// while the account has no key (the update carries `public_key IS NULL`), so a stolen session cannot replace keys through it.
keyRoutes.post('/setup', async (c) => {
  const startedAt = Date.now();
  const body = await jsonObject<{ current_auth?: unknown; keys?: unknown; keys_version?: unknown }>(c.req, [
    'current_auth',
    'keys',
    'keys_version'
  ]);
  if (body === null) {
    return apiError(c, 'invalid_body');
  }
  const set = await parseKeySet(body.keys);
  if (!isAuthValue(body.current_auth) || typeof body.keys_version !== 'number' || !Number.isInteger(body.keys_version) || set === null) {
    return apiError(c, 'invalid_request', { error: 'current_auth, keys_version and a valid key set are required' });
  }
  const db = getDb(c.env.DB);
  const row = await userById(db, currentUser(c).id);
  if (row === undefined) {
    return apiError(c, 'unauthorized');
  }
  const refused = await confirmCurrentAuth(c, db, row, body.current_auth, startedAt);
  if (refused !== null) {
    return refused;
  }
  if (row.public_key !== null) {
    return apiError(c, 'not_applicable');
  }
  if (row.keys_version !== body.keys_version) {
    return apiError(c, 'keys_changed');
  }
  const now = Date.now();
  try {
    const applied = await updateKeyMaterial(db, row, {
      set: keySetColumns(set, now),
      actor: { id: row.id, email: row.email },
      action: 'keys_created',
      target: row.email,
      now,
      onlyWithoutKeys: true
    });
    if (!applied) {
      return apiError(c, 'keys_changed');
    }
  } catch (error) {
    if (errorMessage(error).includes('UNIQUE')) {
      return apiError(c, 'key_in_use');
    }
    console.error('[edging-mail] Key setup failed:', errorClass(error));
    return apiError(c, 'server_error', { error: 'Key setup could not be completed' });
  }
  const fresh = (await userById(db, row.id)) ?? row;
  // Mail that arrived before the user had a key is re-sealed to it: a small backlog now, the rest by the cron.
  c.executionCtx.waitUntil(rewrapPending(c.env, row.id));
  return c.json({ success: true, keys: keyBundle(fresh), user: await userViewOf(db, fresh) });
});

// "Create a new recovery key" (Settings > Account): the browser unwrapped the private key with the password, made a new recovery key, wrapped
// the key under it and showed it (typed confirmation) BEFORE this request. It replaces the recovery wrap and the recovery verifier in one step,
// so the old recovery key stops working at once. Needs the password, a two-step check within five minutes when the account has two-step
// verification, and the key version the browser read. Other sessions stay (the password did not change); the person gets a notice and a push.
keyRoutes.post('/recovery', async (c) => {
  const startedAt = Date.now();
  const body = await jsonObject<{
    current_auth?: unknown;
    wrapped_private_key_recovery?: unknown;
    recovery_auth?: unknown;
    keys_version?: unknown;
  }>(c.req, ['current_auth', 'wrapped_private_key_recovery', 'recovery_auth', 'keys_version']);
  if (body === null) {
    return apiError(c, 'invalid_body');
  }
  const wrap = parseWrap(body.wrapped_private_key_recovery);
  const recoveryAuth = decodeAuth(body.recovery_auth);
  if (!isAuthValue(body.current_auth) || wrap === null || recoveryAuth === null || typeof body.keys_version !== 'number') {
    return apiError(c, 'invalid_request', {
      error: 'current_auth, wrapped_private_key_recovery, recovery_auth and keys_version are required'
    });
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
  if (row.key_id === null || row.keys_version !== body.keys_version) {
    return apiError(c, 'keys_changed');
  }
  const now = Date.now();
  const verifier = await createSecretVerifier(recoveryAuth);
  const applied = await updateKeyMaterial(
    db,
    row,
    {
      set: {
        wrapped_private_key_recovery: wrap,
        recovery_verifier: verifier.verifier,
        recovery_salt: verifier.salt,
        recovery_iterations: verifier.iterations,
        recovery_set_at: now
      },
      actor: { id: row.id, email: row.email },
      action: 'recovery_key_replaced',
      target: row.email,
      now
    },
    [
      securityEvent(db, row.id, 'recovery_key_replaced', now, null, {}, appliedGuard(row, now)),
      signInEntry(db, row.id, c.req.raw, true, 'recovery_key_replaced', appliedGuard(row, now)),
      // "This was not me": the open forgot-password ticket (made with the old recovery key) dies with the old key
      db.delete(recoveryTickets).where(and(eq(recoveryTickets.user_id, row.id), appliedGuard(row, now)))
    ]
  );
  if (!applied) {
    return apiError(c, 'keys_changed');
  }
  c.executionCtx.waitUntil(pushNotice(c.env, db, row.id, 'recovery_key_replaced', { at: now }));
  const fresh = (await userById(db, row.id)) ?? row;
  return c.json({ success: true, keys: keyBundle(fresh), user: await userViewOf(db, fresh) });
});
