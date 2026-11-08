import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { addresses, auditLog, userSecurityEvents, users } from '../src/worker/db/schema';
import { authFor, call, createUser, db, signIn, userRow } from './helpers';

// /api/admin/users: who may call it, listing, creating (the one admin route that receives a credential), renaming, role, disable/enable and
// the last-administrator rule (AC19-AC22).

interface Listed {
  users: { id: string; email: string; role: string; status: string; two_factor: boolean; has_keys: boolean; aliases: string[] }[];
  next_cursor: string | null;
  total: number;
}
const actions = async (): Promise<string[]> => (await db().select().from(auditLog)).map((row) => row.action);

async function adminSession(email = 'boss@example.com') {
  const admin = await createUser(email, { role: 'admin' });
  return { admin, cookie: await signIn(admin) };
}

const newUserBody = async (local: string, extra: Record<string, unknown> = {}) => ({
  local_part: local,
  domain: 'example.com',
  display_name: 'New Person',
  role: 'member',
  auth: await authFor(`${local}@example.com`, 'a temporary password!'),
  kdf: 1,
  ...extra
});

const patch = (cookie: string, id: string, body: Record<string, unknown>) =>
  call(`/api/admin/users/${id}`, { method: 'PATCH', cookie, body });

describe('who may call it', () => {
  it('refuses a member (403 admin_required), and an admin who has not set an administrator-length password yet', async () => {
    const member = await createUser('member@example.com');
    const refused = await call('/api/admin/users', { cookie: await signIn(member) });
    expect([refused.status, refused.json]).toEqual([403, expect.objectContaining({ code: 'admin_required' })]);
    const admin = await createUser('boss@example.com', { role: 'admin' });
    const cookie = await signIn(admin);
    await db().update(users).set({ admin_password_upgrade_required: 1 }).where(eq(users.id, admin.id));
    expect((await call('/api/admin/users', { cookie })).json).toMatchObject({ code: 'admin_password_upgrade_required' });
  });
});

describe('list', () => {
  it('lists people with their aliases, searches by address, display name and alias, pages by cursor, and shows no key material', async () => {
    const { cookie } = await adminSession();
    await createUser('ann@example.com', { display_name: 'Ann Lee', aliases: ['sales@example.com'] });
    await createUser('bob@example.com', { keys: false });
    const all = await call<Listed>('/api/admin/users', { cookie });
    expect(all.status).toBe(200);
    expect(all.json.total).toBe(3);
    expect(all.json.users.map((user) => user.email)).toEqual(['ann@example.com', 'bob@example.com', 'boss@example.com']);
    expect(all.json.users.find((user) => user.email === 'ann@example.com')).toMatchObject({
      aliases: ['sales@example.com'],
      has_keys: true,
      two_factor: false
    });
    expect(all.json.users.find((user) => user.email === 'bob@example.com')?.has_keys).toBe(false);
    expect(all.text).not.toMatch(/wrapped|verifier|public_key|totp_secret|salt|auth_/);
    expect((await call<Listed>('/api/admin/users?q=ANN%20lee', { cookie })).json.users.map((user) => user.email)).toEqual([
      'ann@example.com'
    ]);
    expect((await call<Listed>('/api/admin/users?q=sales@', { cookie })).json.users.map((user) => user.email)).toEqual(['ann@example.com']);
    // % and _ are ordinary characters in a search
    expect((await call<Listed>('/api/admin/users?q=%25', { cookie })).json.users).toHaveLength(0);
    const first = await call<Listed>('/api/admin/users?limit=2', { cookie });
    expect(first.json.users).toHaveLength(2);
    const second = await call<Listed>(`/api/admin/users?limit=2&cursor=${encodeURIComponent(first.json.next_cursor ?? '')}`, { cookie });
    expect(second.json.users.map((user) => user.email)).toEqual(['boss@example.com']);
    expect(second.json.next_cursor).toBeNull();
  });
});

describe('create: the browser derived `auth` from the temporary password; the server returns no password', () => {
  it('creates an active account with a 72-hour temporary password, a primary address and an audit row, and answers no secret', async () => {
    const { cookie } = await adminSession();
    const before = Date.now();
    const created = await call<{ user: { id: string; email: string; role: string; has_keys: boolean } }>('/api/admin/users', {
      cookie,
      body: await newUserBody('newbie')
    });
    expect(created.status).toBe(201);
    expect(created.json.user).toMatchObject({ email: 'newbie@example.com', role: 'member', has_keys: false });
    expect(created.text).not.toMatch(/"temp_password"|"password"|"auth"|verifier/);
    const row = await userRow(created.json.user.id);
    expect(row).toMatchObject({ status: 'active', must_change_password: 1, admin_password_upgrade_required: 0, public_key: null });
    expect(row.temp_password_expires_at).toBeGreaterThanOrEqual(before + 72 * 3_600_000);
    expect(row.temp_password_expires_at).toBeLessThan(Date.now() + 72 * 3_600_000 + 1000);
    expect(await db().select().from(addresses).where(eq(addresses.user_id, row.id))).toEqual([
      { address: 'newbie@example.com', user_id: row.id, kind: 'primary' }
    ]);
    expect(await actions()).toContain('user.create');
    // the person signs in with the temporary password and meets the first gate: choose a password
    const login = await call('/api/auth/login', {
      body: { email: 'newbie@example.com', auth: (await newUserBody('newbie')).auth, kdf: 1 },
      ip: '198.51.100.20'
    });
    expect(login.status).toBe(200);
    expect((await call('/api/stats', { cookie: login.headers.get('Set-Cookie')?.split(';', 1)[0] ?? '' })).json).toMatchObject({
      code: 'password_change_required'
    });
  });

  it('creates an administrator who must set an administrator-length password, and tells the other admins', async () => {
    const { cookie } = await adminSession();
    const other = await createUser('second@example.com', { role: 'admin' });
    const created = await call<{ user: { id: string } }>('/api/admin/users', {
      cookie,
      body: await newUserBody('newadmin', { role: 'admin' })
    });
    expect(created.status).toBe(201);
    expect(await userRow(created.json.user.id)).toMatchObject({ role: 'admin', admin_password_upgrade_required: 1 });
    const alerts = await db().select().from(userSecurityEvents).where(eq(userSecurityEvents.user_id, other.id));
    expect(alerts.map((row) => row.kind)).toEqual(['alert_role_change']);
  });

  it('never upserts: an address that exists (primary or alias), an unknown domain and a bad local part change nothing', async () => {
    const { cookie } = await adminSession();
    await createUser('taken@example.com', { aliases: ['sales@example.com'] });
    const before = await db().select().from(users);
    for (const [name, extra, status, code] of [
      ['a primary address', { local_part: 'taken' }, 409, 'address_taken'],
      ['an alias', { local_part: 'sales' }, 409, 'address_taken'],
      ['an unknown domain', { domain: 'elsewhere.example.org' }, 400, 'domain_not_configured'],
      ['a bad local part', { local_part: 'a b' }, 400, 'invalid_request'],
      ['a role that is not one', { role: 'owner' }, 400, 'invalid_request'],
      ['a display name with a line break', { display_name: 'a\nb' }, 400, 'invalid_request'],
      ['kdf 2', { kdf: 2 }, 400, 'invalid_request'],
      ['an auth that is not canonical', { auth: 'AAAA' }, 400, 'invalid_request']
    ] as const) {
      const answer = await call('/api/admin/users', { cookie, body: { ...(await newUserBody('someone')), ...extra } });
      expect([answer.status, answer.json.code], name).toEqual([status, code]);
    }
    expect(await db().select().from(users)).toHaveLength(before.length);
  });

  it('refuses a body with a field it does not document (a password, a key, a role of its own)', async () => {
    const { cookie } = await adminSession();
    for (const extra of [{ temp_password: 'hunter2hunter2' }, { wrapped_private_key_pw: 'x' }, { must_change_password: 0 }]) {
      const answer = await call('/api/admin/users', { cookie, body: { ...(await newUserBody('someone')), ...extra } });
      expect([answer.status, answer.json.code, answer.text.includes('hunter2')]).toEqual([400, 'invalid_body', false]);
    }
  });
});

describe('rename, change role, disable and enable', () => {
  it('renames without a step-up and audits it; a role or status change needs a second-factor check from the last five minutes', async () => {
    const { cookie } = await adminSession();
    const member = await createUser('member@example.com');
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 6 * 60_000);
      expect((await patch(cookie, member.id, { display_name: 'Member Name' })).json).toMatchObject({
        user: { display_name: 'Member Name' }
      });
      expect(await actions()).toContain('user.rename');
      for (const body of [{ role: 'admin' }, { status: 'disabled' }]) {
        expect((await patch(cookie, member.id, body)).json, JSON.stringify(body)).toMatchObject({ code: 'step_up_required' });
      }
      expect(await userRow(member.id)).toMatchObject({ role: 'member', status: 'active' });
    } finally {
      vi.useRealTimers();
    }
    expect((await patch(cookie, member.id, { role: 'admin' })).status).toBe(200);
  });

  it('refuses an empty body, a field outside the three, a bad role and a bad status', async () => {
    const { cookie } = await adminSession();
    const member = await createUser('member@example.com');
    for (const body of [
      {},
      { email: 'x@example.com' },
      { role: 'owner' },
      { status: 'deleted' },
      { display_name: 'a\nb' },
      { display_name: 'x'.repeat(101) }
    ]) {
      expect((await patch(cookie, member.id, body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await patch(cookie, 'no-such-id', { role: 'admin' })).json).toMatchObject({ code: 'user_not_found' });
  });

  it('disables a person: sessions end at once, nobody can disable themselves, and enabling brings the account back', async () => {
    const { cookie } = await adminSession();
    const member = await createUser('member@example.com');
    const memberCookie = await signIn(member);
    expect((await call('/api/stats', { cookie: memberCookie })).status).toBe(200);
    expect((await patch(cookie, member.id, { status: 'disabled' })).status).toBe(200);
    expect((await call('/api/stats', { cookie: memberCookie })).status).toBe(401);
    expect((await call('/api/auth/login', { body: { email: member.email, auth: member.auth, kdf: 1 } })).json).toMatchObject({
      code: 'account_disabled'
    });
    expect((await patch(cookie, member.id, { status: 'active' })).status).toBe(200);
    expect((await call('/api/auth/login', { body: { email: member.email, auth: member.auth, kdf: 1 }, ip: '198.51.100.31' })).status).toBe(
      200
    );
    const self = (await call<Listed>('/api/admin/users?q=boss', { cookie })).json.users[0];
    expect((await patch(cookie, self.id, { status: 'disabled' })).json).toMatchObject({ code: 'cannot_disable_self' });
    expect(await actions()).toEqual(expect.arrayContaining(['user.disable', 'user.enable']));
  });

  it('keeps the last active administrator: it can never be demoted or disabled, also when two admins demote each other at once', async () => {
    const { admin, cookie } = await adminSession();
    expect((await patch(cookie, admin.id, { role: 'member' })).json).toMatchObject({ code: 'last_admin' });
    const second = await createUser('second@example.com', { role: 'admin' });
    const secondCookie = await signIn(second);
    const answers = await Promise.all([patch(cookie, second.id, { role: 'member' }), patch(secondCookie, admin.id, { role: 'member' })]);
    expect(answers.map((answer) => answer.status).toSorted((a, b) => a - b)).toEqual([200, 409]);
    const admins = await db().select().from(users).where(eq(users.role, 'admin'));
    expect(admins).toHaveLength(1);
    // a disabled admin is not "active": the remaining one is the last
    const survivor = admins[0];
    const third = await createUser('third@example.com', { role: 'admin', status: 'disabled' });
    expect(third.id).not.toBe(survivor.id);
    const survivorCookie = survivor.id === admin.id ? cookie : secondCookie;
    expect((await patch(survivorCookie, survivor.id, { role: 'member' })).json).toMatchObject({ code: 'last_admin' });
  });

  it('alerts the other admins of a role change, and a promoted member gets the administrator-password gate', async () => {
    const { admin, cookie } = await adminSession();
    const other = await createUser('second@example.com', { role: 'admin' });
    const member = await createUser('member@example.com');
    expect((await patch(cookie, member.id, { role: 'admin' })).status).toBe(200);
    expect(await userRow(member.id)).toMatchObject({ role: 'admin', admin_password_upgrade_required: 1 });
    expect((await db().select().from(userSecurityEvents).where(eq(userSecurityEvents.user_id, other.id))).map((row) => row.kind)).toEqual([
      'alert_role_change'
    ]);
    // the promoted person is an administrator by then, so the notice reaches them too; the actor never gets one
    expect((await db().select().from(userSecurityEvents).where(eq(userSecurityEvents.user_id, member.id))).map((row) => row.kind)).toEqual([
      'alert_role_change'
    ]);
    expect(await db().select().from(userSecurityEvents).where(eq(userSecurityEvents.user_id, admin.id))).toEqual([]);
  });
});
