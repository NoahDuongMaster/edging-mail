import { eq, sql } from 'drizzle-orm';
import type { BatchQuery, Db } from '../db';
import { settings, users } from '../db/schema';
import { isLocale } from '../../shared/i18n/languages';
import type { Locale } from '../../shared/i18n/languages';
import type { SessionUser } from '../types';

export type UserRow = typeof users.$inferSelect;

export const userByEmail = (db: Db, email: string): Promise<UserRow | undefined> =>
  db.select().from(users).where(eq(users.email, email)).get();

export const userById = (db: Db, id: string): Promise<UserRow | undefined> => db.select().from(users).where(eq(users.id, id)).get();

export async function hasUsers(db: Db): Promise<boolean> {
  const row = await db
    .select({ one: sql<number>`1` })
    .from(users)
    .limit(1)
    .get();
  return row !== undefined;
}

/** A temporary password (set by an admin) stops working at a fixed time; nothing signs in with it, or stays signed in on it, after that. */
export const tempPasswordExpired = (row: Pick<UserRow, 'must_change_password' | 'temp_password_expires_at'>, now: number): boolean =>
  row.must_change_password === 1 && row.temp_password_expires_at !== null && row.temp_password_expires_at <= now;

export interface Policy {
  require_2fa: boolean;
}

/** The `settings` key of the organisation policy (absent = required: before Setup nothing is ever more open than intended). */
export const REQUIRE_2FA_KEY = 'require_2fa';

export async function loadPolicy(db: Db): Promise<Policy> {
  const row = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, REQUIRE_2FA_KEY)).get();
  return { require_2fa: row?.value !== '0' };
}

// The languages of the app, from the one list the client uses too (src/shared/i18n/languages.ts): a person's and the organisation's language is one of these.
export { isLocale as isLanguage, LOCALES as LANGUAGES } from '../../shared/i18n/languages';
export type { Locale as Language } from '../../shared/i18n/languages';
export const DEFAULT_LANGUAGE_KEY = 'default_language';

/** The organisation's language: the one chosen at Setup (or later by an admin); English until then. Public (the sign-in screens use it). */
export async function loadDefaultLanguage(db: Db): Promise<Locale> {
  const row = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, DEFAULT_LANGUAGE_KEY)).get();
  return isLocale(row?.value) ? row.value : 'en';
}

/** The account as the API shows it to its owner (and as the gates read it). `stepUpAt`: the last second-factor check of this session. */
export const sessionUser = (row: UserRow, policy: Policy, stepUpAt: number): SessionUser => ({
  id: row.id,
  email: row.email,
  display_name: row.display_name,
  role: row.role,
  must_change_password: row.must_change_password === 1,
  has_keys: row.public_key !== null,
  totp_enabled: row.totp_enabled === 1,
  require_2fa: policy.require_2fa,
  admin_password_upgrade_required: row.admin_password_upgrade_required === 1,
  language: row.language,
  two_factor_reset_due_at: row.reset_2fa_due_at,
  step_up_at: stepUpAt
});

/** The key material of an account as its owner receives it at sign-in: public key, id and the two wraps (never anything the server can open). */
export const keyBundle = (row: UserRow): Record<string, string | number> | null =>
  row.public_key === null || row.key_id === null || row.wrapped_private_key_pw === null
    ? null
    : {
        public_key: row.public_key,
        key_id: row.key_id,
        wrapped_private_key_pw: row.wrapped_private_key_pw,
        ...(row.wrapped_private_key_recovery === null ? {} : { wrapped_private_key_recovery: row.wrapped_private_key_recovery }),
        ...(row.recovery_set_at === null ? {} : { recovery_set_at: row.recovery_set_at }),
        keys_version: row.keys_version
      };

/**
 * Revokes every session of a user: cookies issued up to `now` stop working (users.sessions_valid_after). A query, so it joins the batch
 * of the change that causes it; call `closeSockets` (realtime.ts) after the batch committed to end the open WebSockets.
 */
export const revokeSessions = (db: Db, userId: string, now: number): BatchQuery =>
  db.update(users).set({ sessions_valid_after: now }).where(eq(users.id, userId));
