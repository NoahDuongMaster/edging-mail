import { Hono } from 'hono';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { auditEntryIf } from '../audit';
import { batchChanges, getDb } from '../db';
import { userSecurityEvents, users } from '../db/schema';
import { apiError } from '../errors';
import { alertOtherAdmins } from '../security';
import type { AppEnv } from '../types';
import { jsonObject } from '../utils';
import { currentUser } from './middleware';

// The person's own security notices (a reset of their two-step verification, a use of their recovery key, ...) and, for an admin, the alerts about
// the other admins' actions: listed here, dismissible only after the seven days of `dismissible_after`. And the cancel of a pending reset of
// an ADMIN's two-step verification (crypto-review.md AD-1): any signed-in admin session sees the banner and can stop it.

export const noticeRoutes = new Hono<AppEnv>();

const MAX_NOTICES = 50;

const detailOf = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
};

noticeRoutes.get('/notices', async (c) => {
  const rows = await getDb(c.env.DB)
    .select()
    .from(userSecurityEvents)
    .where(and(eq(userSecurityEvents.user_id, currentUser(c).id), isNull(userSecurityEvents.dismissed_at)))
    .orderBy(desc(userSecurityEvents.at), desc(userSecurityEvents.id))
    .limit(MAX_NOTICES);
  const now = Date.now();
  return c.json({
    success: true,
    notices: rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      at: row.at,
      actor_email: row.actor_email,
      detail: detailOf(row.detail),
      dismissible_after: row.dismissible_after,
      dismissible: row.dismissible_after <= now
    }))
  });
});

noticeRoutes.post('/notices/:id/dismiss', async (c) => {
  const id = Number.parseInt(c.req.param('id'), 10);
  const db = getDb(c.env.DB);
  const row = Number.isNaN(id)
    ? undefined
    : await db
        .select()
        .from(userSecurityEvents)
        .where(and(eq(userSecurityEvents.id, id), eq(userSecurityEvents.user_id, currentUser(c).id)))
        .get();
  if (row === undefined) {
    return apiError(c, 'notice_not_found');
  }
  if (row.dismissible_after > Date.now()) {
    return apiError(c, 'notice_locked');
  }
  await db.update(userSecurityEvents).set({ dismissed_at: Date.now() }).where(eq(userSecurityEvents.id, row.id));
  return c.json({ success: true });
});

noticeRoutes.post('/2fa/cancel-reset', async (c) => {
  const body = await jsonObject<Record<string, never>>(c.req, []);
  if (body === null) {
    return apiError(c, 'invalid_body');
  }
  const me = currentUser(c);
  const db = getDb(c.env.DB);
  const now = Date.now();
  const stamp = sql`EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${me.id} AND ${users.updated_at} = ${now})`;
  const [cleared] = await batchChanges(db, [
    db
      .update(users)
      .set({ reset_2fa_due_at: null, reset_2fa_by: null, updated_at: now })
      .where(and(eq(users.id, me.id), sql`${users.reset_2fa_due_at} IS NOT NULL`)),
    auditEntryIf(db, stamp, { id: me.id, email: me.email }, '2fa_reset_cancelled', me.email),
    alertOtherAdmins(db, me.id, 'alert_2fa_reset', now, me.email, { target: me.email, cancelled: true }, stamp)
  ]);
  return cleared === 1 ? c.json({ success: true }) : apiError(c, 'no_pending_reset');
});
