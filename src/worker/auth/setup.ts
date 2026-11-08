import { Hono } from 'hono';
import type { Context } from 'hono';
import { and, eq, getTableColumns, inArray, isNull, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { auditEntry, signInEntry } from '../audit';
import { parseAddress } from '../addresses';
import type { ParsedAddress } from '../addresses';
import { errorMessage, getDb, runBatch } from '../db';
import type { Db } from '../db';
import { addresses, domains, messages, pushSubscriptions, settings, users } from '../db/schema';
import { rewrapPending } from '../mail/pending';
import { closeSockets } from '../realtime';
import { alertOtherAdmins, pushAlertToAdmins, pushNotice, securityEvent } from '../security';
import type { AppEnv } from '../types';
import { errorClass, jsonObject } from '../utils';
import {
  DEFAULT_LANGUAGE_KEY,
  hasUsers,
  isLanguage,
  keyBundle,
  loadPolicy,
  REQUIRE_2FA_KEY,
  sessionUser,
  userByEmail,
  userById
} from './accounts';
import type { Language, UserRow } from './accounts';
import { createVerifier, isAuthValue, KDF_VERSION } from '../../shared/crypto/server';
import { appliedGuard, keySetColumns, parseKeySet, updateKeyMaterial } from './keys';
import { openGate } from './middleware';
import { missingSecrets, setupKeyOf } from './secrets';
import { signingSecret, startSession } from './session';
import { CLIENT_POLICY, claimAttempt, clearAttempts, clientKey, countInWindow, failureDelay } from './throttle';
import { apiError, LANGUAGE_CHOICES } from '../errors';

export const setupRoutes = new Hono<AppEnv>();

const MAX_DISPLAY_NAME = 100;
const MAX_ALIASES = 20;
const LANGUAGE_REASON = `language must be ${LANGUAGE_CHOICES}`;
const encoder = new TextEncoder();
// The columns of `users` in table order: INSERT ... SELECT has no column list, so the values are laid out by name and checked by the compiler.
const USER_COLUMNS = Object.keys(getTableColumns(users)) as (keyof UserRow)[];

// Compares MACs of both values under a fresh random key, never the values: SubtleCrypto.verify is constant-time and the length does not
// leak. The key is made for this one call and thrown away, so no deployment secret is involved (JWT_SECRET only signs tokens).
async function sameSecret(supplied: string, expected: string): Promise<boolean> {
  const hmac = await crypto.subtle.generateKey({ name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  return crypto.subtle.verify('HMAC', hmac, await crypto.subtle.sign('HMAC', hmac, encoder.encode(supplied)), encoder.encode(expected));
}

// The old single-user value of a `settings` key, as a subquery (NULL when it was never saved).
const legacy = (key: string): SQL => sql`(SELECT ${settings.value} FROM ${settings} WHERE ${settings.key} = ${key})`;

// The keys of the old single-user `settings` table that Setup consumes (and deletes: nothing of the first admin may outlive them).
const LEGACY_KEYS = ['display_name', 'signature', 'default_from', 'sessions_valid_after'];

interface SetupRequest {
  primary: ParsedAddress;
  aliases: ParsedAddress[];
  displayName: string;
  auth: string;
  language: Language | null;
}

// The request as the API accepts it, or the reason it is not valid.
function parseSetup(body: Record<string, unknown>): SetupRequest | string {
  const primary = parseAddress(body.email);
  if (primary === null) {
    return 'email must be an address: letters, digits and . _ - before the @ (1-64 characters, no leading, trailing or double dot) on a valid domain';
  }
  const rawName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
  if (body.display_name !== undefined && typeof body.display_name !== 'string') {
    return 'display_name must be a string';
  }
  if (rawName.length > MAX_DISPLAY_NAME || /[\r\n]/.test(rawName)) {
    return `display_name must be a single line of at most ${MAX_DISPLAY_NAME} characters`;
  }
  if (!isAuthValue(body.auth) || body.kdf !== KDF_VERSION) {
    return 'auth and kdf are required';
  }
  const rawAliases = body.aliases ?? [];
  if (!Array.isArray(rawAliases) || rawAliases.length > MAX_ALIASES) {
    return `aliases must be a list of at most ${MAX_ALIASES} addresses`;
  }
  const aliases: ParsedAddress[] = [];
  for (const raw of rawAliases as unknown[]) {
    const alias = parseAddress(raw);
    if (alias === null) {
      return 'every alias must be a valid address';
    }
    // Repeats and the primary address itself are ignored, not errors.
    if (alias.address !== primary.address && !aliases.some((other) => other.address === alias.address)) {
      aliases.push(alias);
    }
  }
  if (body.language !== undefined && !isLanguage(body.language)) {
    return LANGUAGE_REASON;
  }
  return { primary, aliases, displayName: rawName, auth: body.auth, language: body.language ?? null };
}

setupRoutes.post('/setup', async (c) => {
  const secret = signingSecret(c.env);
  const setupKey = setupKeyOf(c.env);
  // JWT_SECRET, APP_PASSWORD and DATA_KEY must all be usable. The answer names nothing (the session endpoint lists the NAMES while Setup is
  // pending, and the Worker log names the missing one).
  const missing = await missingSecrets(c.env);
  if (secret === undefined || setupKey === undefined || missing.length > 0) {
    return apiError(c, 'not_configured');
  }
  const body = await jsonObject<Record<string, unknown>>(c.req, [
    'setup_key',
    'email',
    'display_name',
    'auth',
    'kdf',
    'aliases',
    'keys',
    'language'
  ]);
  if (body === null) {
    return apiError(c, 'invalid_body');
  }
  const request = parseSetup(body);
  if (typeof request === 'string') {
    // An unsupported language has its own code, so the client shows its own text for it.
    return apiError(c, request === LANGUAGE_REASON ? 'invalid_language' : 'invalid_request', { error: request });
  }

  const startedAt = Date.now();
  const db = getDb(c.env.DB);
  const throttleKey = `setup:${clientKey(c.req.raw)}`;
  let claim;
  try {
    claim = await claimAttempt(db, throttleKey, startedAt, CLIENT_POLICY);
  } catch (error) {
    console.error('[edging-mail] Setup throttle unavailable:', errorClass(error));
    return apiError(c, 'unavailable', { error: 'Setup is temporarily unavailable' });
  }
  if (!claim.allowed) {
    c.header('Retry-After', String(claim.retryAfter));
    return apiError(c, 'too_many_attempts', { retry_after: claim.retryAfter });
  }
  if (await hasUsers(db)) {
    return apiError(c, 'already_set_up');
  }
  if (typeof body.setup_key !== 'string' || !(await sameSecret(body.setup_key, setupKey))) {
    await failureDelay(db, startedAt);
    return apiError(c, 'wrong_setup_key');
  }
  await clearAttempts(db, [throttleKey]);
  // The admin's key set, with the mandatory recovery key (its wrap and the proof of it): the private key only ever arrives wrapped. Checked
  // after the setup key, because it costs a key derivation.
  const keySet = await parseKeySet(body.keys);
  if (keySet === null) {
    return apiError(c, 'invalid_request', {
      error: 'keys with a public key, its id, both wrapped private keys and recovery_auth are required'
    });
  }

  const { primary, aliases, displayName, auth, language } = request;
  const userId = crypto.randomUUID();
  const now = Date.now();
  const actor = { id: userId, email: primary.address };
  const verifier = await createVerifier(auth);
  const userValues: Record<keyof UserRow, string | number | null | SQL> = {
    id: userId,
    email: primary.address,
    display_name: sql`COALESCE(NULLIF(${displayName}, ''), ${legacy('display_name')}, '')`,
    signature: sql`COALESCE(${legacy('signature')}, '')`,
    ...verifier,
    role: 'admin',
    status: 'active',
    must_change_password: 0,
    temp_password_expires_at: null,
    sessions_valid_after: 0,
    last_login_at: now,
    created_at: now,
    updated_at: now,
    ...keySetColumns(keySet, now),
    keys_version: 1,
    totp_secret_enc: null,
    totp_enabled: 0,
    totp_last_step: 0,
    totp_enrolled_at: null,
    admin_password_upgrade_required: 0,
    language,
    reset_2fa_due_at: null,
    reset_2fa_by: null
  };
  const domainNames = [...new Set([primary.domain, ...aliases.map((alias) => alias.domain)])];

  try {
    // One batch = one transaction. The user row is inserted only while no user exists, so two simultaneous Setups cannot both win: the
    // loser inserts nothing and its first row that references the user (the address) fails, which rolls everything back.
    await runBatch(db, [
      ...domainNames.map((name) => db.insert(domains).values({ id: crypto.randomUUID(), name, created_at: now }).onConflictDoNothing()),
      db.insert(users).select(
        sql`SELECT ${sql.join(
          USER_COLUMNS.map((name) => sql`${userValues[name]}`),
          sql`, `
        )} WHERE NOT EXISTS (SELECT 1 FROM ${users})`
      ),
      // Everyone needs two-step verification until an admin says otherwise (admins always do).
      db.insert(settings).values({ key: REQUIRE_2FA_KEY, value: '1', updated_at: now }).onConflictDoNothing(),
      ...(language === null
        ? []
        : [db.insert(settings).values({ key: DEFAULT_LANGUAGE_KEY, value: language, updated_at: now }).onConflictDoNothing()]),
      db.insert(addresses).values({ address: primary.address, user_id: userId, kind: 'primary' }),
      ...aliases.map((alias) => db.insert(addresses).values({ address: alias.address, user_id: userId, kind: 'alias' })),
      // Everything the single-user install already holds, and mail that arrived before Setup, becomes the admin's.
      db.update(messages).set({ user_id: userId }).where(isNull(messages.user_id)),
      db.update(pushSubscriptions).set({ user_id: userId }).where(isNull(pushSubscriptions.user_id)),
      db.delete(settings).where(inArray(settings.key, LEGACY_KEYS)),
      auditEntry(db, actor, 'setup', primary.address, { aliases: aliases.length }),
      signInEntry(db, userId, c.req.raw, true)
    ]);
  } catch (error) {
    if (await hasUsers(db)) {
      return apiError(c, 'already_set_up');
    }
    console.error('[edging-mail] Setup failed:', errorClass(error));
    return apiError(c, 'server_error', { error: 'Setup could not be completed' });
  }

  await startSession(c, secret, userId, 0);
  // Mail that arrived before Setup was stored under the server's key (pending): it is now the admin's, so seal it to the admin's key.
  c.executionCtx.waitUntil(rewrapPending(c.env, userId));
  const created = await userByEmail(db, primary.address);
  if (created === undefined) {
    return c.json({ success: true, user: null });
  }
  const user = sessionUser(created, await loadPolicy(db), 0);
  return c.json({ success: true, user, keys: keyBundle(created), gate: openGate(user)?.code ?? null });
});

// Break-glass (crypto-design.md 15.7): whoever holds the setup key (APP_PASSWORD, a deployment secret) can restore the CONSOLE access of an ADMIN who
// lost both the password and the recovery key. The browser made a NEW key pair and a NEW recovery key and sends the whole new key set with the
// new credential. The old key is retired (only its recovery-wrapped blob is kept: that old mail stays locked), every session and open forgot
// ticket or two-step challenge ends, two-step verification is NEVER cleared (the admin still needs the authenticator or a recovery code), and
// the other admins are alerted. It opens no mail, does not sign anyone in and does not re-enable a disabled admin.
// PB-6: the route is anonymous, so every wrong setup key is counted in ONE hourly counter whatever its address; the tenth raises an alert (a notice
// and a push) for every active admin. Best effort: it never changes the answer.
const BREAK_GLASS_ALERT_AFTER = 10;

async function noteBreakGlassFailure(c: Context<AppEnv>, db: Db, now: number): Promise<void> {
  try {
    if ((await countInWindow(db, 'recover-failures', now)) === BREAK_GLASS_ALERT_AFTER) {
      await db.batch([alertOtherAdmins(db, '', 'alert_break_glass_failures', now, 'setup key', { failures: BREAK_GLASS_ALERT_AFTER })]);
      c.executionCtx.waitUntil(pushAlertToAdmins(c.env, db, '', 'alert_break_glass_failures', { at: now }));
    }
  } catch (error) {
    console.error('[edging-mail] Could not alert the admins about failed break-glass attempts:', errorClass(error));
  }
}

setupRoutes.post('/recover', async (c) => {
  const secret = signingSecret(c.env);
  const setupKey = setupKeyOf(c.env);
  const missing = await missingSecrets(c.env);
  if (secret === undefined || setupKey === undefined || missing.length > 0) {
    return apiError(c, 'not_configured');
  }
  const body = await jsonObject<{ setup_key?: unknown; email?: unknown; new_auth?: unknown; kdf?: unknown; keys?: unknown }>(c.req, [
    'setup_key',
    'email',
    'new_auth',
    'kdf',
    'keys'
  ]);
  if (body === null) {
    return apiError(c, 'invalid_body');
  }
  const address = parseAddress(body.email);
  if (address === null || !isAuthValue(body.new_auth) || body.kdf !== KDF_VERSION || body.keys === undefined) {
    return apiError(c, 'invalid_request', { error: 'email, new_auth, kdf and keys are required' });
  }

  const startedAt = Date.now();
  const db = getDb(c.env.DB);
  const throttleKey = `recover:${clientKey(c.req.raw)}`;
  let claim;
  try {
    claim = await claimAttempt(db, throttleKey, startedAt, CLIENT_POLICY);
  } catch (error) {
    console.error('[edging-mail] Recovery throttle unavailable:', errorClass(error));
    return apiError(c, 'unavailable', { error: 'Recovery is temporarily unavailable' });
  }
  if (!claim.allowed) {
    c.header('Retry-After', String(claim.retryAfter));
    return apiError(c, 'too_many_attempts', { retry_after: claim.retryAfter });
  }
  if (typeof body.setup_key !== 'string' || !(await sameSecret(body.setup_key, setupKey))) {
    await noteBreakGlassFailure(c, db, startedAt);
    await failureDelay(db, startedAt);
    return apiError(c, 'wrong_setup_key');
  }
  await clearAttempts(db, [throttleKey]);

  const found = await db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.email, address.address), eq(users.role, 'admin')))
    .get();
  const admin = found === undefined ? undefined : await userById(db, found.id);
  if (admin === undefined) {
    // Members are not recoverable this way; the answer is the same for a member and for an address that does not exist.
    return apiError(c, 'no_such_admin');
  }
  const keySet = await parseKeySet(body.keys);
  if (keySet === null) {
    return apiError(c, 'invalid_keys');
  }
  const now = Date.now();
  const guard = appliedGuard(admin, now);
  try {
    const applied = await updateKeyMaterial(
      db,
      admin,
      {
        set: {
          ...(await createVerifier(body.new_auth)),
          ...keySetColumns(keySet, now),
          must_change_password: 0,
          temp_password_expires_at: null,
          sessions_valid_after: now
        },
        actor: { id: null, email: 'setup key' },
        action: 'break_glass',
        target: admin.email,
        now,
        retireOldKey: true,
        dropChallenges: true,
        dropLockedDeletions: true
      },
      [
        signInEntry(db, admin.id, c.req.raw, true, 'break_glass', guard),
        securityEvent(db, admin.id, 'break_glass', now, null, {}, guard),
        alertOtherAdmins(db, admin.id, 'alert_break_glass', now, 'setup key', { target: admin.email }, guard)
      ]
    );
    if (!applied) {
      return apiError(c, 'keys_changed');
    }
  } catch (error) {
    if (errorMessage(error).includes('UNIQUE')) {
      return apiError(c, 'key_in_use');
    }
    console.error('[edging-mail] Break-glass failed:', errorClass(error));
    return apiError(c, 'server_error', { error: 'Recovery could not be completed' });
  }
  await closeSockets(c.env, admin.id);
  c.executionCtx.waitUntil(
    Promise.all([
      pushNotice(c.env, db, admin.id, 'break_glass', { at: now }),
      pushAlertToAdmins(c.env, db, admin.id, 'alert_break_glass', { target: admin.email, at: now })
    ])
  );
  return c.json({ success: true });
});
