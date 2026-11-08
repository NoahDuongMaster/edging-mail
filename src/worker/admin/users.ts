import { Hono } from 'hono';
import { and, asc, count, eq, gt, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { isLocalPart } from '../addresses';
import { auditEntry, auditEntryIf } from '../audit';
import { addresses, domains, users } from '../db/schema';
import { batchChanges, errorMessage, getDb } from '../db';
import type { BatchQuery } from '../db';
import { currentUser, hasStepUp } from '../auth/middleware';
import { userById } from '../auth/accounts';
import { apiError } from '../errors';
import { closeSockets } from '../realtime';
import { alertOtherAdmins, pushAlertToAdmins } from '../security';
import type { AppEnv } from '../types';
import { errorClass, jsonObject } from '../utils';
import { accountOpsExhausted } from './limits';
import { aliasesOf, userColumns, userView, viewOf } from './user-view';
import { createVerifier, isAuthValue, KDF_VERSION } from '../../shared/crypto/server';

// /api/admin/users: list, create, rename, change role, disable and enable. NOTHING here takes, returns or stores a password, a key or any
// key material of another person (crypto-design.md 15.5, test/admin-p1.test.ts): the single credential an admin route receives is the
// temporary `auth` of an account that does not exist yet.

export const adminUserRoutes = new Hono<AppEnv>();

export const MAX_DISPLAY_NAME = 100;
const TEMP_PASSWORD_HOURS = 72;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

adminUserRoutes.get('/users', async (c) => {
  const q = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 100);
  const parsedLimit = Number.parseInt(c.req.query('limit') ?? '', 10);
  const limit = Number.isNaN(parsedLimit) ? DEFAULT_LIMIT : Math.min(MAX_LIMIT, Math.max(1, parsedLimit));
  const cursor = c.req.query('cursor') ?? '';
  const db = getDb(c.env.DB);
  // instr(), not LIKE: D1 refuses LIKE patterns over 50 bytes, and % and _ are ordinary characters here
  const match: SQL | undefined =
    q === ''
      ? undefined
      : or(
          sql`instr(lower(${users.email}), ${q}) > 0`,
          sql`instr(lower(${users.display_name}), ${q}) > 0`,
          sql`EXISTS (SELECT 1 FROM ${addresses} WHERE ${addresses.user_id} = ${users.id} AND instr(${addresses.address}, ${q}) > 0)`
        );
  try {
    const rows = await db
      .select(userColumns)
      .from(users)
      .where(and(match, cursor === '' ? undefined : gt(users.email, cursor)))
      .orderBy(asc(users.email))
      .limit(limit + 1);
    const page = rows.slice(0, limit);
    const total = await db.select({ total: count() }).from(users).where(match).get();
    const aliases = await aliasesOf(
      db,
      page.map((row) => row.id)
    );
    return c.json({
      success: true,
      users: page.map((row) => userView(row, aliases.get(row.id) ?? [])),
      next_cursor: rows.length > limit ? (page.at(-1)?.email ?? null) : null,
      total: total?.total ?? 0
    });
  } catch (error) {
    console.error('[edging-mail] Admin user list failed:', errorClass(error));
    return apiError(c, 'server_error');
  }
});

// Creates an account for a person who does not exist yet. The ADMIN'S BROWSER generated the temporary password and derived `auth` from it
// (the server never sees the password and returns none); it works for 72 hours, only to choose a real password, then keys and a recovery key.
// Never an upsert: an address that already exists (primary or alias) answers 409 and nothing changes.
adminUserRoutes.post('/users', async (c) => {
  const body = await jsonObject<{
    local_part?: unknown;
    domain?: unknown;
    display_name?: unknown;
    role?: unknown;
    auth?: unknown;
    kdf?: unknown;
  }>(c.req, ['local_part', 'domain', 'display_name', 'role', 'auth', 'kdf']);
  if (body === null) {
    return apiError(c, 'invalid_body');
  }
  const local = typeof body.local_part === 'string' ? body.local_part.trim().toLowerCase() : '';
  const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
  const role = body.role ?? 'member';
  if (
    !isLocalPart(local) ||
    typeof body.domain !== 'string' ||
    (role !== 'member' && role !== 'admin') ||
    (body.display_name !== undefined && typeof body.display_name !== 'string') ||
    displayName.length > MAX_DISPLAY_NAME ||
    /[\r\n]/.test(displayName) ||
    !isAuthValue(body.auth) ||
    body.kdf !== KDF_VERSION
  ) {
    return apiError(c, 'invalid_request', {
      error: 'local_part (a-z 0-9 . _ -), domain, role, display_name, auth and kdf are required and must be valid'
    });
  }
  const db = getDb(c.env.DB);
  const wanted = body.domain.trim().toLowerCase();
  const domain = await db
    .select()
    .from(domains)
    .where(or(eq(domains.id, body.domain.trim()), eq(domains.name, wanted)))
    .get();
  if (domain === undefined) {
    return apiError(c, 'domain_not_configured', { error: 'That domain is not configured here. Add the domain first.' });
  }
  const address = `${local}@${domain.name}`;
  const taken = await db.select({ address: addresses.address }).from(addresses).where(eq(addresses.address, address)).get();
  if (taken !== undefined) {
    return apiError(c, 'address_taken');
  }
  const actor = currentUser(c);
  if (await accountOpsExhausted(db, actor.id)) {
    return apiError(c, 'too_many_requests');
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  try {
    await db.batch([
      db.insert(users).values({
        id,
        email: address,
        display_name: displayName,
        ...(await createVerifier(body.auth)),
        role,
        status: 'active',
        must_change_password: 1,
        temp_password_expires_at: now + TEMP_PASSWORD_HOURS * 3_600_000,
        // an administrator account sets a password of the administrator length at its first sign-in (the browser enforces it)
        admin_password_upgrade_required: role === 'admin' ? 1 : 0,
        created_at: now,
        updated_at: now
      }),
      // A primary key conflict here (a concurrent create of the same address) fails the whole batch: nothing is half-created.
      db.insert(addresses).values({ address, user_id: id, kind: 'primary' }),
      auditEntry(db, { id: actor.id, email: actor.email }, 'user.create', address, { role }),
      ...(role === 'admin'
        ? [alertOtherAdmins(db, actor.id, 'alert_role_change', now, actor.email, { target: address, to: 'admin', created: true })]
        : [])
    ]);
  } catch (error) {
    if (errorMessage(error).includes('UNIQUE') || errorMessage(error).includes('constraint')) {
      return apiError(c, 'address_taken');
    }
    console.error('[edging-mail] Admin user create failed:', errorClass(error));
    return apiError(c, 'server_error');
  }
  if (role === 'admin') {
    c.executionCtx.waitUntil(pushAlertToAdmins(c.env, db, actor.id, 'alert_role_change', { actor: actor.email, target: address, at: now }));
  }
  const created = await db.select(userColumns).from(users).where(eq(users.id, id)).get();
  return c.json({ success: true, user: created === undefined ? null : userView(created, []) }, 201);
});

// Rename, change role, disable or enable. A role or status change needs a recent second-factor check (step-up), ends the person's sessions and
// is audited; a promotion also sets the administrator-password gate. The last active administrator can never be demoted or disabled (the
// condition is part of the UPDATE, so two admins demoting each other at once cannot both succeed), and nobody can disable themselves.
adminUserRoutes.patch('/users/:id', async (c) => {
  const body = await jsonObject<{ display_name?: unknown; role?: unknown; status?: unknown }>(c.req, ['display_name', 'role', 'status']);
  if (body === null) {
    return apiError(c, 'invalid_body');
  }
  const name = typeof body.display_name === 'string' ? body.display_name.trim() : undefined;
  if (
    Object.keys(body).length === 0 ||
    (body.display_name !== undefined && (name === undefined || name.length > MAX_DISPLAY_NAME || /[\r\n]/.test(name))) ||
    (body.role !== undefined && body.role !== 'admin' && body.role !== 'member') ||
    (body.status !== undefined && body.status !== 'active' && body.status !== 'disabled')
  ) {
    return apiError(c, 'invalid_request', {
      error: 'display_name (one line), role (admin or member) and status (active or disabled) are the only fields'
    });
  }
  const db = getDb(c.env.DB);
  const actor = currentUser(c);
  const target = await userById(db, c.req.param('id'));
  if (target === undefined) {
    return apiError(c, 'user_not_found');
  }
  const nextRole = body.role === 'admin' || body.role === 'member' ? body.role : undefined;
  const nextStatus = body.status === 'active' || body.status === 'disabled' ? body.status : undefined;
  const roleChanges = nextRole !== undefined && nextRole !== target.role;
  const statusChanges = nextStatus !== undefined && nextStatus !== target.status;
  const renames = name !== undefined && name !== target.display_name;
  if (statusChanges && nextStatus === 'disabled' && target.id === actor.id) {
    return apiError(c, 'cannot_disable_self');
  }
  if ((roleChanges || statusChanges) && !hasStepUp(actor)) {
    return apiError(c, 'step_up_required');
  }
  const now = Date.now();
  const removesAnAdmin =
    target.role === 'admin' &&
    target.status === 'active' &&
    ((roleChanges && nextRole === 'member') || (statusChanges && nextStatus === 'disabled'));
  const otherAdmins = sql`(SELECT COUNT(*) FROM ${users} WHERE ${users.role} = 'admin' AND ${users.status} = 'active' AND ${users.id} != ${target.id}) > 0`;
  const stamp = sql`EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${target.id} AND ${users.updated_at} = ${now})`;
  const by = { id: actor.id, email: actor.email };
  const queries: BatchQuery[] = [
    db
      .update(users)
      .set({
        ...(renames ? { display_name: name } : {}),
        ...(roleChanges
          ? { role: nextRole, admin_password_upgrade_required: nextRole === 'admin' ? 1 : 0, sessions_valid_after: now }
          : {}),
        ...(statusChanges ? { status: nextStatus, sessions_valid_after: now } : {}),
        updated_at: now
      })
      .where(and(eq(users.id, target.id), removesAnAdmin ? otherAdmins : undefined)),
    ...(renames ? [auditEntryIf(db, stamp, by, 'user.rename', target.email)] : []),
    ...(roleChanges
      ? [
          auditEntryIf(db, stamp, by, 'user.role_change', target.email, { from: target.role, to: nextRole }),
          alertOtherAdmins(
            db,
            actor.id,
            'alert_role_change',
            now,
            actor.email,
            { target: target.email, from: target.role, to: nextRole },
            stamp
          )
        ]
      : []),
    ...(statusChanges ? [auditEntryIf(db, stamp, by, nextStatus === 'disabled' ? 'user.disable' : 'user.enable', target.email)] : [])
  ];
  if (!renames && !roleChanges && !statusChanges) {
    return c.json({ success: true, user: await viewOf(db, target.id) });
  }
  let changes: number[];
  try {
    changes = await batchChanges(db, queries);
  } catch (error) {
    console.error('[edging-mail] Admin user update failed:', errorClass(error));
    return apiError(c, 'server_error');
  }
  if (changes[0] !== 1) {
    return apiError(c, 'last_admin');
  }
  if (roleChanges || statusChanges) {
    await closeSockets(c.env, target.id);
  }
  if (roleChanges) {
    c.executionCtx.waitUntil(
      pushAlertToAdmins(c.env, db, actor.id, 'alert_role_change', { actor: actor.email, target: target.email, at: now })
    );
  }
  return c.json({ success: true, user: await viewOf(db, target.id) });
});
