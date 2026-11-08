import { Hono } from 'hono';
import { count, desc, eq, lt } from 'drizzle-orm';
import { auditEntry } from '../audit';
import { getDb } from '../db';
import type { BatchQuery } from '../db';
import { auditLog, messages, settings } from '../db/schema';
import { currentUser, hasStepUp } from '../auth/middleware';
import { DEFAULT_LANGUAGE_KEY, isLanguage, loadDefaultLanguage, loadPolicy, REQUIRE_2FA_KEY } from '../auth/accounts';
import { dataKeysOf, setupKeyOf } from '../auth/secrets';
import { signingSecret } from '../auth/session';
import { apiError } from '../errors';
import { alertOtherAdmins, pushAlertToAdmins } from '../security';
import type { AppEnv } from '../types';
import { errorClass, jsonObject } from '../utils';

// /api/admin/settings (the organisation's policy and default language), /api/admin/health and /api/admin/audit.

export const adminOrgRoutes = new Hono<AppEnv>();

const DEFAULT_AUDIT_LIMIT = 50;
const MAX_AUDIT_LIMIT = 200;

adminOrgRoutes.get('/settings', async (c) => {
  const db = getDb(c.env.DB);
  const policy = await loadPolicy(db);
  return c.json({ success: true, settings: { require_2fa: policy.require_2fa, default_language: await loadDefaultLanguage(db) } });
});

// Two-step verification is required of everyone from Setup (admins always). An admin may RELAX it for members: that needs a step-up and the
// admin's own address typed as `confirm`, is audited, and alerts the other admins. It never turns off anybody's enrolled two-step verification;
// it only stops requiring it of those who have none. Turning it back ON gates every open session at once (the gate reads the policy per request).
adminOrgRoutes.put('/settings', async (c) => {
  const body = await jsonObject<{ require_2fa?: unknown; default_language?: unknown; confirm?: unknown }>(c.req, [
    'require_2fa',
    'default_language',
    'confirm'
  ]);
  if (body === null) {
    return apiError(c, 'invalid_body');
  }
  if (body.require_2fa !== undefined && typeof body.require_2fa !== 'boolean') {
    return apiError(c, 'invalid_request', { error: 'require_2fa must be true or false' });
  }
  if (body.default_language !== undefined && !isLanguage(body.default_language)) {
    return apiError(c, 'invalid_language');
  }
  const db = getDb(c.env.DB);
  const actor = currentUser(c);
  const policy = await loadPolicy(db);
  const relaxing = body.require_2fa === false && policy.require_2fa;
  if (relaxing) {
    if (!hasStepUp(actor)) {
      return apiError(c, 'step_up_required');
    }
    if (typeof body.confirm !== 'string' || body.confirm.trim().toLowerCase() !== actor.email) {
      return apiError(c, 'confirm_mismatch');
    }
  }
  const now = Date.now();
  const by = { id: actor.id, email: actor.email };
  const upsert = (key: string, value: string) =>
    db
      .insert(settings)
      .values({ key, value, updated_at: now })
      .onConflictDoUpdate({ target: settings.key, set: { value, updated_at: now } });
  const language = await loadDefaultLanguage(db);
  const queries: BatchQuery[] = [];
  if (body.require_2fa !== undefined && body.require_2fa !== policy.require_2fa) {
    queries.push(
      upsert(REQUIRE_2FA_KEY, body.require_2fa ? '1' : '0'),
      auditEntry(db, by, 'settings.require_2fa', '', { from: policy.require_2fa, to: body.require_2fa }),
      ...(relaxing ? [alertOtherAdmins(db, actor.id, 'alert_require_2fa_relaxed', now, actor.email, {})] : [])
    );
  }
  if (typeof body.default_language === 'string' && body.default_language !== language) {
    queries.push(
      upsert(DEFAULT_LANGUAGE_KEY, body.default_language),
      auditEntry(db, by, 'settings.default_language', '', { from: language, to: body.default_language })
    );
  }
  try {
    if (queries.length > 0) {
      await db.batch(queries as [BatchQuery, ...BatchQuery[]]);
    }
  } catch (error) {
    console.error('[edging-mail] Settings update failed:', errorClass(error));
    return apiError(c, 'server_error');
  }
  if (relaxing) {
    c.executionCtx.waitUntil(pushAlertToAdmins(c.env, db, actor.id, 'alert_require_2fa_relaxed', { actor: actor.email, at: now }));
  }
  const after = await loadPolicy(db);
  return c.json({ success: true, settings: { require_2fa: after.require_2fa, default_language: await loadDefaultLanguage(db) } });
});

adminOrgRoutes.get('/health', async (c) => {
  const db = getDb(c.env.DB);
  try {
    const plaintext = await db.select({ n: count() }).from(messages).where(eq(messages.enc_fmt, 0)).get();
    const pending = await db.select({ n: count() }).from(messages).where(eq(messages.wrap_kind, 'server')).get();
    return c.json({
      success: true,
      health: {
        data_key: (await dataKeysOf(c.env)) === undefined ? 'missing' : 'ok',
        jwt_secret: signingSecret(c.env) === undefined ? 'missing' : 'ok',
        setup_key: setupKeyOf(c.env) === undefined ? 'missing' : 'ok',
        plaintext_rows: plaintext?.n ?? 0,
        pending_rows: pending?.n ?? 0
      }
    });
  } catch (error) {
    console.error('[edging-mail] Health read failed:', errorClass(error));
    return apiError(c, 'server_error');
  }
});

const parseDetail = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return {};
  }
};

adminOrgRoutes.get('/audit', async (c) => {
  const parsed = Number.parseInt(c.req.query('limit') ?? '', 10);
  const limit = Number.isNaN(parsed) ? DEFAULT_AUDIT_LIMIT : Math.min(MAX_AUDIT_LIMIT, Math.max(1, parsed));
  const cursor = Number.parseInt(c.req.query('cursor') ?? '', 10);
  const rows = await getDb(c.env.DB)
    .select()
    .from(auditLog)
    .where(Number.isNaN(cursor) ? undefined : lt(auditLog.id, cursor))
    .orderBy(desc(auditLog.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  return c.json({
    success: true,
    entries: page.map((row) => ({
      id: row.id,
      at: row.at,
      actor_email: row.actor_email,
      action: row.action,
      target: row.target,
      detail: parseDetail(row.detail)
    })),
    next_cursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null
  });
});
