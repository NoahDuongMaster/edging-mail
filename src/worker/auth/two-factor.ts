import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { auditEntryIf } from '../audit';
import { batchChanges, getDb } from '../db';
import { recoveryCodes, users } from '../db/schema';
import { closeSockets } from '../realtime';
import type { AppEnv } from '../types';
import { appName, errorClass, jsonObject } from '../utils';
import { isAuthValue, sealData, toBase64Url } from '../../shared/crypto/server';
import { loadPolicy, sessionUser, userById } from './accounts';
import { currentUser } from './middleware';
import { dataKeysOf } from './secrets';
import { parseFactor, replaceRecoveryCodes, stamped, verifyFactor } from './second-factor';
import { signingSecret, startSession } from './session';
import { confirmCurrentAuth } from './stepup';
import { base32, newTotpSecret, otpauthUri } from './totp';
import { apiError } from '../errors';

// Two-step verification (TOTP) for the signed-in user. Enrolling, disabling and regenerating the recovery codes need the password
// (`current_auth`) and, except the first step, a code; every one of them signs the user's other sessions out and returns a fresh cookie
// for this device. The step-up endpoint re-issues the cookie with a "second factor checked now" mark for the actions that need it.

export const twoFactorRoutes = new Hono<AppEnv>();

const FIELDS = ['current_auth', 'code'] as const;

twoFactorRoutes.post('/2fa/enroll/start', async (c) => {
  const startedAt = Date.now();
  const body = await jsonObject<{ current_auth?: unknown }>(c.req, ['current_auth']);
  if (body === null || !isAuthValue(body.current_auth)) {
    return body === null ? apiError(c, 'invalid_body') : apiError(c, 'invalid_request', { error: 'current_auth is required' });
  }
  const keys = await dataKeysOf(c.env);
  if (keys === undefined) {
    return apiError(c, 'not_configured');
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
  if (row.totp_enabled === 1) {
    return apiError(c, 'already_enabled');
  }
  // A new secret every time the enrolment starts over; it only counts once a code from it is confirmed.
  const secret = newTotpSecret();
  await db
    .update(users)
    .set({ totp_secret_enc: toBase64Url(await sealData(keys, 'totp', row.id, secret)), updated_at: Date.now() })
    .where(and(eq(users.id, row.id), eq(users.totp_enabled, 0)));
  return c.json({ success: true, secret_base32: base32(secret), otpauth_uri: otpauthUri(row.email, secret, appName(c.env)) });
});

twoFactorRoutes.post('/2fa/enroll/confirm', async (c) => {
  const startedAt = Date.now();
  const body = await jsonObject<{ current_auth?: unknown; code?: unknown }>(c.req, FIELDS);
  const factor = body === null ? null : parseFactor(body, false);
  if (body === null || !isAuthValue(body.current_auth) || factor === null) {
    return apiError(c, 'invalid_request', { error: 'current_auth and a six-digit code are required' });
  }
  const secret = signingSecret(c.env);
  const keys = await dataKeysOf(c.env);
  if (secret === undefined || keys === undefined) {
    return apiError(c, 'not_configured');
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
  if (row.totp_enabled === 1 || row.totp_secret_enc === null) {
    return apiError(c, 'not_started');
  }
  const checked = await verifyFactor(c, db, row, factor, startedAt);
  if (!checked.ok) {
    return checked.response;
  }
  const now = Date.now();
  const { codes, queries } = await replaceRecoveryCodes(db, keys, row.id, now);
  const changes = await batchChanges(db, [
    db
      .update(users)
      .set({ totp_enabled: 1, totp_enrolled_at: now, sessions_valid_after: now, updated_at: now })
      .where(and(eq(users.id, row.id), eq(users.totp_enabled, 0), eq(users.totp_secret_enc, row.totp_secret_enc))),
    ...queries,
    auditEntryIf(db, stamped(row.id, now), { id: row.id, email: row.email }, '2fa_enabled', row.email)
  ]);
  if (changes[0] !== 1) {
    return apiError(c, 'conflict');
  }
  await closeSockets(c.env, row.id, { renewed: true });
  await startSession(c, secret, row.id, now, now);
  const fresh = (await userById(db, row.id)) ?? row;
  return c.json({ success: true, recovery_codes: codes, user: sessionUser(fresh, await loadPolicy(db), now) });
});

// Members only, and not while the organisation requires it: an admin can never switch it off.
twoFactorRoutes.post('/2fa/disable', async (c) => {
  const startedAt = Date.now();
  const body = await jsonObject<{ current_auth?: unknown; code?: unknown }>(c.req, FIELDS);
  const factor = body === null ? null : parseFactor(body, false);
  if (body === null || !isAuthValue(body.current_auth) || factor === null) {
    return apiError(c, 'invalid_request', { error: 'current_auth and a six-digit code are required' });
  }
  const secret = signingSecret(c.env);
  if (secret === undefined) {
    return apiError(c, 'not_configured');
  }
  const db = getDb(c.env.DB);
  const row = await userById(db, currentUser(c).id);
  if (row === undefined) {
    return apiError(c, 'unauthorized');
  }
  const policy = await loadPolicy(db);
  if (row.role === 'admin' || policy.require_2fa) {
    return apiError(c, 'two_factor_required');
  }
  const refused = await confirmCurrentAuth(c, db, row, body.current_auth, startedAt);
  if (refused !== null) {
    return refused;
  }
  if (row.totp_enabled !== 1) {
    return apiError(c, 'not_enabled');
  }
  const checked = await verifyFactor(c, db, row, factor, startedAt);
  if (!checked.ok) {
    return checked.response;
  }
  const now = Date.now();
  try {
    await db.batch([
      db
        .update(users)
        .set({
          totp_enabled: 0,
          totp_secret_enc: null,
          totp_last_step: 0,
          totp_enrolled_at: null,
          sessions_valid_after: now,
          updated_at: now
        })
        .where(eq(users.id, row.id)),
      db.delete(recoveryCodes).where(eq(recoveryCodes.user_id, row.id)),
      auditEntryIf(db, stamped(row.id, now), { id: row.id, email: row.email }, '2fa_disabled', row.email)
    ]);
  } catch (error) {
    console.error('[edging-mail] Could not turn off two-step verification:', errorClass(error));
    return apiError(c, 'server_error', { error: 'Could not turn off two-step verification' });
  }
  await closeSockets(c.env, row.id, { renewed: true });
  await startSession(c, secret, row.id, now);
  const fresh = (await userById(db, row.id)) ?? row;
  return c.json({ success: true, user: sessionUser(fresh, policy, 0) });
});

twoFactorRoutes.post('/2fa/recovery-codes', async (c) => {
  const startedAt = Date.now();
  const body = await jsonObject<{ current_auth?: unknown; code?: unknown }>(c.req, FIELDS);
  const factor = body === null ? null : parseFactor(body, false);
  if (body === null || !isAuthValue(body.current_auth) || factor === null) {
    return apiError(c, 'invalid_request', { error: 'current_auth and a six-digit code are required' });
  }
  const secret = signingSecret(c.env);
  const keys = await dataKeysOf(c.env);
  if (secret === undefined || keys === undefined) {
    return apiError(c, 'not_configured');
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
  if (row.totp_enabled !== 1) {
    return apiError(c, 'not_enabled');
  }
  const checked = await verifyFactor(c, db, row, factor, startedAt);
  if (!checked.ok) {
    return checked.response;
  }
  const now = Date.now();
  const { codes, queries } = await replaceRecoveryCodes(db, keys, row.id, now);
  await db.batch([
    db.update(users).set({ sessions_valid_after: now, updated_at: now }).where(eq(users.id, row.id)),
    ...queries,
    auditEntryIf(db, stamped(row.id, now), { id: row.id, email: row.email }, 'recovery_codes_regenerated', row.email)
  ]);
  await closeSockets(c.env, row.id, { renewed: true });
  await startSession(c, secret, row.id, now, now);
  return c.json({ success: true, recovery_codes: codes });
});

// "I am here now": a code, then this session carries a second-factor mark for five minutes (the policy switch, promotions, deletes, resets).
twoFactorRoutes.post('/step-up', async (c) => {
  const startedAt = Date.now();
  const body = await jsonObject<{ code?: unknown }>(c.req, ['code']);
  const factor = body === null ? null : parseFactor(body, false);
  const secret = signingSecret(c.env);
  if (factor === null) {
    return apiError(c, 'invalid_request', { error: 'A six-digit code is required' });
  }
  if (secret === undefined) {
    return apiError(c, 'not_configured');
  }
  const db = getDb(c.env.DB);
  const row = await userById(db, currentUser(c).id);
  if (row?.totp_enabled !== 1) {
    return apiError(c, 'not_enabled');
  }
  const checked = await verifyFactor(c, db, row, factor, startedAt);
  if (!checked.ok) {
    return checked.response;
  }
  await startSession(c, secret, row.id, row.sessions_valid_after, Date.now());
  return c.json({ success: true });
});
