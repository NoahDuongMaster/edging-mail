import { and, eq, ne, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { BatchQuery, Db } from './db';
import { errorClass } from './utils';
import { settings, userSecurityEvents, users } from './db/schema';
import { notifyPush } from './push';
import en from '../shared/i18n/locales/server/en.json';
import vi from '../shared/i18n/locales/server/vi.json';
import zh from '../shared/i18n/locales/server/zh-CN.json';
import { isLocale } from '../shared/i18n/languages';
import type { Locale } from '../shared/i18n/languages';
import type { Env } from './types';

// Security notices: a row in user_security_events (shown in the app, not dismissible for seven days) plus a best-effort Web Push to the
// person's devices. The text is built HERE from the actor's address (never a display name, which an admin can edit), in the language of
// the recipient (their own, else the organisation default), with a fixed same-origin click URL. A push that fails never changes anything
// else: the row, the audit entry and the alerts to other admins are written first, in the batch of the change itself.

export type SecurityKind =
  | 'recovery_started'
  | 'password_recovered'
  | 'recovery_key_replaced'
  | 'locked_delete_requested'
  | 'second_factor_locked'
  | '2fa_reset'
  | '2fa_reset_pending'
  | 'break_glass'
  | 'first_sign_in';
export type AlertKind =
  | 'alert_2fa_reset'
  | 'alert_role_change'
  | 'alert_account_delete'
  | 'alert_break_glass'
  | 'alert_break_glass_failures'
  | 'alert_require_2fa_relaxed'
  | 'alert_temp_password_reissued';

/** How long a notice cannot be dismissed. */
export const NOTICE_LOCK_MS = 7 * 24 * 60 * 60_000;
const NOTICE_URL = '/app';

/** A notice row as a batch query, written only while `guard` (an SQL predicate) holds. Without a guard it is written unconditionally. */
export function securityEvent(
  db: Db,
  userId: string,
  kind: SecurityKind | AlertKind,
  at: number,
  actorEmail: string | null,
  detail: Record<string, unknown> = {},
  guard?: SQL
): BatchQuery {
  const detailText = JSON.stringify(detail);
  return guard === undefined
    ? db.insert(userSecurityEvents).values({
        user_id: userId,
        kind,
        at,
        actor_email: actorEmail,
        detail: detailText,
        dismissible_after: at + NOTICE_LOCK_MS
      })
    : db
        .insert(userSecurityEvents)
        .select(sql`SELECT NULL, ${userId}, ${kind}, ${at}, ${actorEmail}, ${detailText}, ${at + NOTICE_LOCK_MS}, NULL WHERE ${guard}`);
}

/** One alert row for every OTHER active admin (the console banner reads them), written only while `guard` holds. */
export const alertOtherAdmins = (
  db: Db,
  exceptUserId: string,
  kind: AlertKind,
  at: number,
  actorEmail: string,
  detail: Record<string, unknown>,
  guard?: SQL
): BatchQuery =>
  db.insert(userSecurityEvents).select(
    sql`SELECT NULL, ${users.id}, ${kind}, ${at}, ${actorEmail}, ${JSON.stringify(detail)}, ${at + NOTICE_LOCK_MS}, NULL FROM ${users}
        WHERE ${users.role} = 'admin' AND ${users.status} = 'active' AND ${users.id} != ${exceptUserId}${guard === undefined ? sql`` : sql` AND ${guard}`}`
  );

// One server set per language of src/shared/i18n/languages.ts: adding a language there makes the compiler ask for its file here.
const CATALOGUES: Record<Locale, Record<string, string>> = { en, vi, 'zh-CN': zh };

/** The two strings of a push, from the catalogue of `language` (English when that language or key is missing). */
export function pushText(
  language: string | null,
  kind: SecurityKind | AlertKind,
  vars: { actor?: string; target?: string; at: number }
): { title: string; body: string } {
  const locale: Locale = isLocale(language) ? language : 'en';
  const catalogue: Record<string, string | undefined> = CATALOGUES[locale];
  const time = `${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(vars.at)} UTC`;
  const fill = (text: string): string =>
    text
      .replaceAll('{time}', time)
      .replaceAll('{actor}', vars.actor ?? '')
      .replaceAll('{target}', vars.target ?? '');
  return {
    title: fill(catalogue[`push.${kind}.title`] ?? en[`push.${kind}.title` as keyof typeof en]),
    body: fill(catalogue[`push.${kind}.body`] ?? en[`push.${kind}.body` as keyof typeof en])
  };
}

/** The language of a recipient: their own, else the organisation default, else English. */
async function languageOf(db: Db, userId: string): Promise<string> {
  const own = await db.select({ language: users.language }).from(users).where(eq(users.id, userId)).get();
  if (own?.language) {
    return own.language;
  }
  const fallback = await db.select({ value: settings.value }).from(settings).where(eq(settings.key, 'default_language')).get();
  return fallback?.value ?? 'en';
}

/** Best-effort push of a security notice to one person's devices. Never throws. */
export async function pushNotice(
  env: Env,
  db: Db,
  userId: string,
  kind: SecurityKind | AlertKind,
  vars: { actor?: string; target?: string; at: number }
): Promise<void> {
  try {
    const text = pushText(await languageOf(db, userId), kind, vars);
    await notifyPush(env, userId, { ...text, tag: `security-${kind}`, url: NOTICE_URL });
  } catch (error) {
    console.error('[edging-mail] Could not send a security notice:', errorClass(error));
  }
}

/** Best-effort push of an alert to every other active admin. Never throws. */
export async function pushAlertToAdmins(
  env: Env,
  db: Db,
  exceptUserId: string,
  kind: AlertKind,
  vars: { actor?: string; target?: string; at: number }
): Promise<void> {
  try {
    const admins = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, 'admin'), eq(users.status, 'active'), ne(users.id, exceptUserId)));
    await Promise.all(admins.map((admin) => pushNotice(env, db, admin.id, kind, vars)));
  } catch (error) {
    console.error('[edging-mail] Could not alert the other admins:', errorClass(error));
  }
}
