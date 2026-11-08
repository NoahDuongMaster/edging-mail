import { Hono } from 'hono';
import { and, count, eq, inArray, lte, sql } from 'drizzle-orm';
import { parseAddress } from '../addresses';
import { auditEntry, auditEntryIf } from '../audit';
import { batchChanges, errorMessage, getDb } from '../db';
import type { Db } from '../db';
import { addresses, attachments, auditLog, domains, messages, recoveryCodes, twoFactorChallenges, users } from '../db/schema';
import { currentUser, hasStepUp } from '../auth/middleware';
import { userById } from '../auth/accounts';
import { dropLockedDeletions } from '../auth/keys';
import type { UserRow } from '../auth/accounts';
import { deleteBlobs } from '../content';
import { apiError } from '../errors';
import { closeSockets } from '../realtime';
import { alertOtherAdmins, pushAlertToAdmins, pushNotice, securityEvent } from '../security';
import type { AppEnv, Env } from '../types';
import { errorClass, jsonObject } from '../utils';
import { aliasesOf } from './user-view';

// Per-person admin actions that remain after addendum 4.3: aliases, reset of two-step verification, delete. No password, no key.

export const adminActionRoutes = new Hono<AppEnv>();

const MAX_ALIASES = 20;
const RESET_CAP_PER_HOUR = 3;
const ADMIN_RESET_DELAY_MS = 24 * 3_600_000;
// How much of one person's storage a single delete request removes before it answers "not done yet, send it again".
const PURGE_PAGE = 100;
const PURGE_ROUNDS = 25;

// --- Aliases ---

adminActionRoutes.post('/users/:id/aliases', async (c) => {
  const body = await jsonObject<{ address?: unknown }>(c.req, ['address']);
  if (body === null) {
    return apiError(c, 'invalid_body');
  }
  const parsed = parseAddress(body.address);
  if (parsed === null) {
    return apiError(c, 'invalid_address');
  }
  const db = getDb(c.env.DB);
  const target = await userById(db, c.req.param('id'));
  if (target === undefined) {
    return apiError(c, 'user_not_found');
  }
  const known = await db.select({ id: domains.id }).from(domains).where(eq(domains.name, parsed.domain)).get();
  if (known === undefined) {
    return apiError(c, 'domain_not_configured', {
      error: 'That address is on a domain that is not configured here. Add the domain first.'
    });
  }
  const owned = await db
    .select({ total: count() })
    .from(addresses)
    .where(and(eq(addresses.user_id, target.id), eq(addresses.kind, 'alias')))
    .get();
  if ((owned?.total ?? 0) >= MAX_ALIASES) {
    return apiError(c, 'too_many_aliases');
  }
  const actor = currentUser(c);
  try {
    // The address is the primary key: an address that exists (primary or alias, of anyone) fails the whole batch and nothing changes.
    await db.batch([
      db.insert(addresses).values({ address: parsed.address, user_id: target.id, kind: 'alias' }),
      auditEntry(db, { id: actor.id, email: actor.email }, 'alias.add', parsed.address, { user: target.email })
    ]);
  } catch (error) {
    if (errorMessage(error).includes('constraint') || errorMessage(error).includes('UNIQUE')) {
      return apiError(c, 'address_taken');
    }
    console.error('[edging-mail] Alias add failed:', errorClass(error));
    return apiError(c, 'server_error');
  }
  const aliases = await aliasesOf(db, [target.id]);
  return c.json({ success: true, aliases: aliases.get(target.id) ?? [] }, 201);
});

adminActionRoutes.delete('/users/:id/aliases/:address', async (c) => {
  const db = getDb(c.env.DB);
  const address = decodeURIComponent(c.req.param('address')).trim().toLowerCase();
  const id = c.req.param('id');
  const actor = currentUser(c);
  const row = await db
    .select({ address: addresses.address })
    .from(addresses)
    .where(and(eq(addresses.address, address), eq(addresses.user_id, id), eq(addresses.kind, 'alias')))
    .get();
  if (row === undefined) {
    return apiError(c, 'alias_not_found');
  }
  const target = await userById(db, id);
  await db.batch([
    db.delete(addresses).where(and(eq(addresses.address, address), eq(addresses.user_id, id), eq(addresses.kind, 'alias'))),
    auditEntry(db, { id: actor.id, email: actor.email }, 'alias.remove', address, { user: target?.email ?? '' })
  ]);
  const aliases = await aliasesOf(db, [id]);
  return c.json({ success: true, aliases: aliases.get(id) ?? [] });
});

// --- Reset of two-step verification ---

/**
 * Clears a person's two-step verification (secret, codes, open challenges), ends every session and leaves the notice, the audit row and
 * the alert for the other admins, all in one batch. `by` is the address of the admin who asked. The person enrols again at next sign-in (gate).
 */
export async function applyTwoFactorReset(
  env: Env,
  db: Db,
  target: UserRow,
  by: { id: string | null; email: string },
  now: number
): Promise<boolean> {
  const stamp = sql`EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${target.id} AND ${users.updated_at} = ${now})`;
  const changes = await batchChanges(db, [
    db
      .update(users)
      .set({
        totp_secret_enc: null,
        totp_enabled: 0,
        totp_last_step: 0,
        totp_enrolled_at: null,
        reset_2fa_due_at: null,
        reset_2fa_by: null,
        sessions_valid_after: now,
        updated_at: now
      })
      .where(eq(users.id, target.id)),
    db.delete(recoveryCodes).where(and(eq(recoveryCodes.user_id, target.id), stamp)),
    dropLockedDeletions(db, target.id, stamp),
    db.delete(twoFactorChallenges).where(and(eq(twoFactorChallenges.user_id, target.id), stamp)),
    auditEntryIf(db, stamp, by, '2fa_reset', target.email),
    securityEvent(db, target.id, '2fa_reset', now, by.email, {}, stamp),
    alertOtherAdmins(db, by.id ?? '', 'alert_2fa_reset', now, by.email, { target: target.email }, stamp)
  ]);
  if (changes[0] !== 1) {
    return false;
  }
  await closeSockets(env, target.id);
  await Promise.all([
    pushNotice(env, db, target.id, '2fa_reset', { actor: by.email, at: now }),
    pushAlertToAdmins(env, db, by.id ?? '', 'alert_2fa_reset', { actor: by.email, target: target.email, at: now })
  ]);
  return true;
}

/** The cron: a reset of an ADMIN's two-step verification waits 24 hours (the admin can cancel by signing in); this applies the due ones. */
export async function applyDueTwoFactorResets(env: Env, db: Db): Promise<number> {
  const now = Date.now();
  const due = await db
    .select()
    .from(users)
    .where(and(lte(users.reset_2fa_due_at, now)));
  let applied = 0;
  for (const target of due) {
    try {
      // PB-5: the weakening is applied only while the admin who asked is still an ACTIVE admin. If the other admins disabled, demoted or deleted a
      // compromised requester inside the 24 hours, the request dies with them.
      const requester =
        target.reset_2fa_by === null
          ? undefined
          : await db
              .select({ id: users.id })
              .from(users)
              .where(and(eq(users.email, target.reset_2fa_by), eq(users.role, 'admin'), eq(users.status, 'active')))
              .get();
      if (requester === undefined) {
        await db.batch([
          db
            .update(users)
            .set({ reset_2fa_due_at: null, reset_2fa_by: null, updated_at: now })
            .where(and(eq(users.id, target.id), sql`${users.reset_2fa_due_at} IS NOT NULL`)),
          auditEntry(db, { id: null, email: 'scheduled job' }, '2fa_reset_cancelled', target.email, {
            reason: 'requester_not_active_admin'
          })
        ]);
        continue;
      }
      if (await applyTwoFactorReset(env, db, target, { id: null, email: target.reset_2fa_by ?? 'an administrator' }, now)) {
        applied += 1;
      }
    } catch (error) {
      console.error(`[edging-mail] Could not apply the two-step reset of ${target.id}:`, errorClass(error));
    }
  }
  return applied;
}

adminActionRoutes.post('/users/:id/reset-2fa', async (c) => {
  const body = await jsonObject<Record<string, never>>(c.req, []);
  if (body === null) {
    return apiError(c, 'invalid_body');
  }
  const actor = currentUser(c);
  if (!hasStepUp(actor)) {
    return apiError(c, 'step_up_required');
  }
  const db = getDb(c.env.DB);
  const target = await userById(db, c.req.param('id'));
  if (target === undefined) {
    return apiError(c, 'user_not_found');
  }
  if (target.id === actor.id) {
    return apiError(c, 'cannot_reset_self');
  }
  if (target.totp_enabled !== 1 && target.totp_secret_enc === null) {
    return apiError(c, 'not_enabled');
  }
  const now = Date.now();
  const recent = await db
    .select({ total: count() })
    .from(auditLog)
    .where(
      and(
        inArray(auditLog.action, ['2fa_reset', '2fa_reset_requested']),
        eq(auditLog.target, target.email),
        sql`${auditLog.at} > ${now - 3_600_000}`
      )
    )
    .get();
  if ((recent?.total ?? 0) >= RESET_CAP_PER_HOUR) {
    return apiError(c, 'reset_limit');
  }
  const by = { id: actor.id, email: actor.email };
  if (target.role === 'member') {
    return (await applyTwoFactorReset(c.env, db, target, by, now)) ? c.json({ success: true, applied: true }) : apiError(c, 'conflict');
  }
  // An ADMIN's reset is the quiet way to weaken an admin: it takes effect in 24 hours unless that admin cancels it, and all admins hear at once.
  const due = now + ADMIN_RESET_DELAY_MS;
  const stamp = sql`EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${target.id} AND ${users.updated_at} = ${now})`;
  const changes = await batchChanges(db, [
    db.update(users).set({ reset_2fa_due_at: due, reset_2fa_by: actor.email, updated_at: now }).where(eq(users.id, target.id)),
    auditEntryIf(db, stamp, by, '2fa_reset_requested', target.email, { due }),
    securityEvent(db, target.id, '2fa_reset_pending', now, actor.email, { due }, stamp),
    alertOtherAdmins(db, actor.id, 'alert_2fa_reset', now, actor.email, { target: target.email, pending: true, due }, stamp)
  ]);
  if (changes[0] !== 1) {
    return apiError(c, 'conflict');
  }
  c.executionCtx.waitUntil(
    Promise.all([
      pushNotice(c.env, db, target.id, '2fa_reset_pending', { actor: actor.email, at: due }),
      pushAlertToAdmins(c.env, db, actor.id, 'alert_2fa_reset', { actor: actor.email, target: target.email, at: now })
    ])
  );
  return c.json({ success: true, applied: false, due });
});

// Any admin may cancel the pending reset of an admin's two-step verification (PB-5): cancelling only keeps 2FA on, so it needs no step-up, and it
// must not depend on the target being able to sign in (the alert would reach nobody who can act).
adminActionRoutes.post('/users/:id/cancel-2fa-reset', async (c) => {
  const body = await jsonObject<Record<string, never>>(c.req, []);
  if (body === null) {
    return apiError(c, 'invalid_body');
  }
  const actor = currentUser(c);
  const db = getDb(c.env.DB);
  const target = await userById(db, c.req.param('id'));
  if (target === undefined) {
    return apiError(c, 'user_not_found');
  }
  const now = Date.now();
  const stamp = sql`EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${target.id} AND ${users.updated_at} = ${now})`;
  const [cleared] = await batchChanges(db, [
    db
      .update(users)
      .set({ reset_2fa_due_at: null, reset_2fa_by: null, updated_at: now })
      .where(and(eq(users.id, target.id), sql`${users.reset_2fa_due_at} IS NOT NULL`)),
    auditEntryIf(db, stamp, { id: actor.id, email: actor.email }, '2fa_reset_cancelled', target.email),
    alertOtherAdmins(db, actor.id, 'alert_2fa_reset', now, actor.email, { target: target.email, cancelled: true }, stamp)
  ]);
  return cleared === 1 ? c.json({ success: true }) : apiError(c, 'no_pending_reset');
});

// --- Delete ---

/** Removes a person's R2 objects, a bounded amount per call. true when nothing is left. */
async function purgeStorage(env: Env, db: Db, userId: string): Promise<boolean> {
  for (let round = 0; round < PURGE_ROUNDS; round += 1) {
    const listing = await env.BUCKET.list({ prefix: `em1/${userId}/`, limit: 1000 });
    if (listing.objects.length > 0) {
      await deleteBlobs(
        env,
        listing.objects.map((object) => object.key)
      );
      continue;
    }
    // Mail from before the encryption: its objects are named in the rows. The rows go page by page, after their objects.
    const page = await db
      .select({ id: messages.id, r2_key: messages.r2_key })
      .from(messages)
      .where(eq(messages.user_id, userId))
      .limit(PURGE_PAGE);
    if (page.length === 0) {
      return true;
    }
    const keys = page.flatMap((row) => (row.r2_key === null || row.r2_key === '' ? [] : [row.r2_key]));
    for (let start = 0; start < page.length; start += 50) {
      const ids = page.slice(start, start + 50).map((row) => row.id);
      const files = await db.select({ r2_key: attachments.r2_key }).from(attachments).where(inArray(attachments.message_id, ids));
      keys.push(...files.map((file) => file.r2_key));
    }
    if ((await deleteBlobs(env, keys)) > 0) {
      return false;
    }
    for (let start = 0; start < page.length; start += 50) {
      await db.delete(messages).where(
        inArray(
          messages.id,
          page.slice(start, start + 50).map((row) => row.id)
        )
      );
    }
  }
  return false;
}

// Deletes a person and everything of theirs: the account is disabled and its sessions end first (so a delete that needs several requests never
// leaves a usable account), the R2 objects go in bounded pages, then one batch writes the audit row, alerts the other admins and deletes the user,
// which cascades to every row of theirs. A large mailbox answers `done: false`: send the same request again. Needs the typed address, a step-up and
// is refused for yourself and for the last active administrator. Creating the address again later gives a NEW person with an empty mailbox.
adminActionRoutes.delete('/users/:id', async (c) => {
  const body = await jsonObject<{ confirm?: unknown }>(c.req, ['confirm']);
  if (body === null) {
    return apiError(c, 'invalid_body');
  }
  const actor = currentUser(c);
  const db = getDb(c.env.DB);
  const target = await userById(db, c.req.param('id'));
  if (target === undefined) {
    return apiError(c, 'user_not_found');
  }
  if (target.id === actor.id) {
    return apiError(c, 'cannot_delete_self');
  }
  if (typeof body.confirm !== 'string' || body.confirm.trim().toLowerCase() !== target.email) {
    return apiError(c, 'confirm_mismatch');
  }
  if (!hasStepUp(actor)) {
    return apiError(c, 'step_up_required');
  }
  const now = Date.now();
  const otherAdmins = sql`(SELECT COUNT(*) FROM ${users} WHERE ${users.role} = 'admin' AND ${users.status} = 'active' AND ${users.id} != ${target.id}) > 0`;
  const changes = await batchChanges(db, [
    db
      .update(users)
      .set({ status: 'disabled', sessions_valid_after: now, updated_at: now })
      .where(and(eq(users.id, target.id), target.role === 'admin' && target.status === 'active' ? otherAdmins : undefined))
  ]);
  if (changes[0] !== 1) {
    return apiError(c, 'last_admin');
  }
  await closeSockets(c.env, target.id);
  let finished: boolean;
  try {
    finished = await purgeStorage(c.env, db, target.id);
  } catch (error) {
    console.error('[edging-mail] Account delete: storage purge failed:', errorClass(error));
    return apiError(c, 'server_error');
  }
  if (!finished) {
    return c.json({ success: true, done: false }, 202);
  }
  await db.batch([
    auditEntry(db, { id: actor.id, email: actor.email }, 'user.delete', target.email, { role: target.role }),
    alertOtherAdmins(db, actor.id, 'alert_account_delete', now, actor.email, { target: target.email }),
    db.delete(users).where(eq(users.id, target.id))
  ]);
  c.executionCtx.waitUntil(
    pushAlertToAdmins(c.env, db, actor.id, 'alert_account_delete', { actor: actor.email, target: target.email, at: now })
  );
  return c.json({ success: true, done: true });
});
