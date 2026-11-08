import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { auditEntry, auditEntryIf, signInEntry } from '../audit';
import { errorMessage, getDb } from '../db';
import { users } from '../db/schema';
import { rewrapPending } from '../mail/pending';
import { closeSockets } from '../realtime';
import { securityEvent } from '../security';
import type { AppEnv } from '../types';
import { errorClass, jsonObject } from '../utils';
import { keyBundle, loadPolicy, sessionUser, userById } from './accounts';
import { appliedGuard, isRecord, keySetColumns, parseKeySet, parseWrap, updateKeyMaterial } from './keys';
import { currentUser } from './middleware';
import { createVerifier, isAuthValue, KDF_VERSION, verifyAuth } from '../../shared/crypto/server';
import { signingSecret, startSession } from './session';
import { confirmCurrentAuth } from './stepup';
import { apiError } from '../errors';

export const credentialRoutes = new Hono<AppEnv>();

// Choose a new password. The current one is always required, also while `must_change_password` is set (the browser has the temporary
// password in hand: it needs it to unwrap the private key and wrap it again under the new one). Wrong guesses count under their own throttle
// key (`stepup:<id>`), so somebody holding a stolen cookie cannot lock the owner out of signing in.
// The private key is wrapped under a key made from the password, so for an account WITH keys the change must bring `keys:
// {wrapped_private_key_pw}`, the same key wrapped under the NEW password (the mail would become unreadable otherwise), and `keys_version`,
// the version the browser read (compare-and-set). An account WITHOUT keys (a temporary password, first sign-in) may bring its whole first key
// set in the same request (`keys`: the five fields of the key setup), so choosing the password, the keys and the recovery key is ONE atomic
// step; without it the key setup gate follows. `admin_strength: true` is the browser's assertion that the new password has the admin length
// (the server cannot see it: documented); it clears `admin_password_upgrade_required`. Every other session of the user ends; this device gets
// a fresh cookie.
credentialRoutes.post('/change-password', async (c) => {
  const startedAt = Date.now();
  const secret = signingSecret(c.env);
  if (secret === undefined) {
    return apiError(c, 'not_configured');
  }
  const body = await jsonObject<{
    current_auth?: unknown;
    new_auth?: unknown;
    kdf?: unknown;
    keys?: unknown;
    keys_version?: unknown;
    admin_strength?: unknown;
  }>(c.req, ['current_auth', 'new_auth', 'kdf', 'keys', 'keys_version', 'admin_strength']);
  if (body === null) {
    return apiError(c, 'invalid_body');
  }
  if (!isAuthValue(body.new_auth) || !isAuthValue(body.current_auth) || body.kdf !== KDF_VERSION) {
    return apiError(c, 'invalid_request', { error: 'current_auth, new_auth and kdf are required' });
  }
  if (body.admin_strength !== undefined && typeof body.admin_strength !== 'boolean') {
    return apiError(c, 'invalid_request', { error: 'admin_strength must be true or false' });
  }
  if (body.keys !== undefined && typeof body.keys_version !== 'number') {
    return apiError(c, 'invalid_request', { error: 'keys needs keys_version' });
  }
  const db = getDb(c.env.DB);
  const row = await userById(db, currentUser(c).id);
  if (row === undefined) {
    return apiError(c, 'unauthorized');
  }
  const hasKeys = row.public_key !== null;
  // The shape of `keys` that is allowed depends on whether the account has keys; the cheap part is checked before the password.
  const rewrap =
    hasKeys && isRecord(body.keys) && Object.keys(body.keys).length === 1 && body.keys.wrapped_private_key_pw !== undefined
      ? parseWrap(body.keys.wrapped_private_key_pw)
      : null;
  if (hasKeys && rewrap === null) {
    return apiError(c, 'keys_required');
  }
  if (!hasKeys && body.keys !== undefined && !isRecord(body.keys)) {
    return apiError(c, 'invalid_request', { error: 'keys must be a key set' });
  }
  const refused = await confirmCurrentAuth(c, db, row, body.current_auth, startedAt);
  if (refused !== null) {
    return refused;
  }
  // The same password again is refused (the server can only tell by its `auth` value).
  if (await verifyAuth(body.new_auth, row)) {
    return apiError(c, 'same_password');
  }
  const keySet = !hasKeys && body.keys !== undefined ? await parseKeySet(body.keys) : null;
  if (!hasKeys && body.keys !== undefined && keySet === null) {
    return apiError(c, 'invalid_keys');
  }
  const touchesKeys = rewrap !== null || keySet !== null;
  if (touchesKeys && row.keys_version !== body.keys_version) {
    return apiError(c, 'keys_changed');
  }

  const now = Date.now();
  const firstSignIn = row.must_change_password === 1;
  const set = {
    ...(rewrap === null ? {} : { wrapped_private_key_pw: rewrap }),
    ...(keySet === null ? {} : keySetColumns(keySet, now)),
    ...(await createVerifier(body.new_auth)),
    must_change_password: 0,
    temp_password_expires_at: null,
    ...(body.admin_strength === true ? { admin_password_upgrade_required: 0 } : {}),
    sessions_valid_after: now
  };
  const actor = { id: row.id, email: row.email };
  const request = c.req.raw;
  const detail = {
    ip: request.headers.get('CF-Connecting-IP')?.trim().slice(0, 64) ?? null,
    user_agent: request.headers.get('User-Agent')?.slice(0, 300) ?? null
  };
  try {
    if (!touchesKeys) {
      await db.batch([
        db
          .update(users)
          .set({ ...set, updated_at: now })
          .where(eq(users.id, row.id)),
        auditEntry(db, actor, 'password_change', row.email),
        ...(firstSignIn
          ? [auditEntry(db, actor, 'user.first_sign_in', row.email, detail), signInEntry(db, row.id, request, true, 'first_sign_in')]
          : [])
      ]);
    } else {
      const guard = appliedGuard(row, now);
      const applied = await updateKeyMaterial(
        db,
        row,
        { set, actor, action: 'password_change', target: row.email, now, onlyWithoutKeys: keySet !== null },
        firstSignIn
          ? [
              auditEntryIf(db, guard, actor, 'user.first_sign_in', row.email, detail),
              signInEntry(db, row.id, request, true, 'first_sign_in', guard),
              securityEvent(db, row.id, 'first_sign_in', now, null, {}, guard)
            ]
          : []
      );
      if (!applied) {
        return apiError(c, 'keys_changed');
      }
    }
  } catch (error) {
    if (errorMessage(error).includes('UNIQUE')) {
      return apiError(c, 'key_in_use');
    }
    console.error('[edging-mail] Password change failed:', errorClass(error));
    return apiError(c, 'server_error', { error: 'The password could not be changed' });
  }
  await closeSockets(c.env, row.id, { renewed: true });
  await startSession(c, secret, row.id, now);
  if (keySet !== null) {
    c.executionCtx.waitUntil(rewrapPending(c.env, row.id));
  }
  const fresh = (await userById(db, row.id)) ?? row;
  return c.json({ success: true, user: sessionUser(fresh, await loadPolicy(db), 0), keys: keyBundle(fresh) });
});
