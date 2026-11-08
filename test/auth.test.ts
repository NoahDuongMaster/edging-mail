import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { toBase64Url } from '../src/worker/base64url';
import {
  addresses,
  auditLog,
  domains,
  loginAttempts,
  messages,
  userKeys,
  userSecurityEvents,
  userSignIns,
  users
} from '../src/worker/db/schema';
import { addMessage, authFor, call, cookieOf, createUser, db, DEFAULT_PASSWORD, enrollTotp, fakeWrap, setupKeys, signIn } from './helpers';
import type { Answer } from './helpers';

const SETUP_KEY = env.APP_PASSWORD;
const goodSetup = async (email = 'admin@example.com', extra: Record<string, unknown> = {}) => ({
  setup_key: SETUP_KEY,
  email,
  display_name: 'Admin Example',
  auth: await authFor(email, DEFAULT_PASSWORD),
  kdf: 1,
  keys: await setupKeys(email.toLowerCase()),
  ...extra
});

const encodeJson = (value: unknown): string => toBase64Url(new TextEncoder().encode(JSON.stringify(value)));

async function signHmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload))));
}

async function timedWrongLogin(email: string): Promise<{ answer: Answer; took: number }> {
  const started = Date.now();
  const answer = await call('/api/auth/login', { body: { email, auth: await authFor(email, 'wrong password!'), kdf: 1 } });
  return { answer, took: Date.now() - started };
}

/** What a change of password must carry for a user who has keys: the private key wrapped under the new password (shape only here). */
const REWRAP = () => ({ keys: { wrapped_private_key_pw: fakeWrap() }, keys_version: 1 });

// Break-glass brings a NEW key set (a new pair and a new recovery key made in the browser); `keys: undefined` leaves it out.
const recover = async (body: Record<string, unknown>, ip?: string): Promise<Answer> =>
  call('/api/auth/recover', {
    body: { kdf: 1, keys: await setupKeys(typeof body.email === 'string' ? body.email.toLowerCase() : 'x@example.com'), ...body },
    ip
  });

describe('first-run setup (AC1, AC2, AC3)', () => {
  it('shows only the setup screen on an empty database and keeps mail routes closed', async () => {
    const session = await call('/api/auth/session');
    expect(session.json).toMatchObject({ authenticated: false, configured: true, setup_required: true, default_from: 'hi@example.test' });
    for (const path of ['/api/messages', '/api/stats', '/api/labels', '/api/settings', '/api/drafts/x', '/api/ws', '/api/admin/users']) {
      expect((await call(path)).status, path).toBe(401);
    }
  });

  it('refuses a wrong setup key, then throttles after five (429 with Retry-After)', async () => {
    const wrong = { ...(await goodSetup()), setup_key: 'not the key at all' };
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await call('/api/auth/setup', { body: wrong })).status, `attempt ${attempt}`).toBe(401);
    }
    const blocked = await call('/api/auth/setup', { body: await goodSetup() });
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
    // The lock is per client address: someone else is not affected.
    expect((await call('/api/auth/setup', { body: await goodSetup(), ip: '198.51.100.9' })).status).toBe(200);
  }, 30_000);

  it('creates the admin, the domain and the aliases, signs in and opens the mailbox', async () => {
    const answer = await call('/api/auth/setup', {
      body: await goodSetup('Admin@Example.com', { aliases: ['Team@Example.com', 'ops@example.org', 'admin@example.com'] })
    });
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({ success: true, user: { email: 'admin@example.com', role: 'admin', must_change_password: false } });
    const first = cookieOf(answer);
    // The admin starts gated: two-step verification must be enrolled before anything else works (admins always need it).
    expect(answer.json).toMatchObject({ gate: 'two_factor_enrollment_required' });
    const gated = await call('/api/stats', { cookie: first });
    expect(gated.status).toBe(403);
    expect(gated.json).toMatchObject({ code: 'two_factor_enrollment_required' });
    const { cookie } = await enrollTotp(first, { auth: await authFor('admin@example.com', DEFAULT_PASSWORD) });
    expect((await call('/api/stats', { cookie })).status).toBe(200);

    const stored = await db().select().from(addresses).orderBy(addresses.address);
    expect(stored.map((row) => `${row.address}:${row.kind}`)).toEqual([
      'admin@example.com:primary',
      'ops@example.org:alias',
      'team@example.com:alias'
    ]);
    expect((await db().select().from(domains)).map((row) => row.name).toSorted()).toEqual(['example.com', 'example.org']);
    expect((await db().select().from(auditLog)).map((row) => row.action)).toEqual(['setup', '2fa_enabled']);
    // Everyone needs two-step verification until an admin says otherwise
    expect((await env.DB.prepare("SELECT value FROM settings WHERE key = 'require_2fa'").first<{ value: string }>())?.value).toBe('1');
    // The first admin has keys, a recovery wrap and a recovery verifier from the start (they are stored together)
    const [firstAdmin] = await db().select().from(users);
    expect(firstAdmin).toMatchObject({ role: 'admin', keys_version: 1 });
    expect(
      [firstAdmin.public_key, firstAdmin.wrapped_private_key_recovery, firstAdmin.recovery_verifier, firstAdmin.recovery_salt].every(
        (value) => value !== null
      )
    ).toBe(true);
    expect(firstAdmin.recovery_iterations).toBe(100_000);
    expect((await call('/api/auth/session', { cookie })).json).toMatchObject({ authenticated: true, setup_required: false });
  });

  it('refuses a second setup (409) and validates the request', async () => {
    expect((await call('/api/auth/setup', { body: await goodSetup() })).status).toBe(200);
    const again = await call('/api/auth/setup', { body: await goodSetup('other@example.com') });
    expect(again.status).toBe(409);
    expect(again.json).toMatchObject({ code: 'already_set_up' });
    expect(await db().select().from(users)).toHaveLength(1);
  });

  it.each([
    ['an invalid address', { email: 'not an address' }],
    ['a double dot', { email: 'a..b@example.com' }],
    ['a short auth value', { auth: 'abc' }],
    ['no kdf', { kdf: undefined }],
    ['an alias that is not an address', { aliases: ['nope'] }],
    ['a multi-line display name', { display_name: 'a\nb' }]
  ])('answers 400 for %s', async (_name, change) => {
    const answer = await call('/api/auth/setup', { body: { ...(await goodSetup()), ...change } });
    expect(answer.status).toBe(400);
    expect(await db().select().from(users)).toHaveLength(0);
  });

  it('lets only one of two simultaneous setups win and leaves nothing of the loser', async () => {
    const [first, second] = await Promise.all([
      call('/api/auth/setup', { body: await goodSetup('one@example.com'), ip: '198.51.100.1' }),
      call('/api/auth/setup', { body: await goodSetup('two@example.com'), ip: '198.51.100.2' })
    ]);
    expect([first.status, second.status].toSorted((x, y) => x - y)).toEqual([200, 409]);
    expect(await db().select().from(users)).toHaveLength(1);
    expect(await db().select().from(addresses)).toHaveLength(1);
  });

  it('answers 503 "Server is not configured" when a secret is missing, short or malformed, and names none of them', async () => {
    const body = await goodSetup();
    for (const overrides of [
      { JWT_SECRET: undefined },
      { JWT_SECRET: 'too short' },
      { APP_PASSWORD: undefined },
      { APP_PASSWORD: 'short' },
      { DATA_KEY: undefined },
      { DATA_KEY: 'not base64 of 32 bytes' },
      { DATA_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
      // one leaked secret must not open the other's data
      { DATA_KEY: env.JWT_SECRET }
    ]) {
      const refused = await call('/api/auth/setup', { body, env: overrides });
      expect(refused.status, JSON.stringify(overrides)).toBe(503);
      expect(refused.json, JSON.stringify(overrides)).toEqual({
        success: false,
        error: 'Server is not configured',
        code: 'not_configured'
      });
    }
    expect(await db().select().from(users)).toHaveLength(0);
  });

  it('lists the NAMES of the missing secrets while Setup is pending, never a value, and never afterwards', async () => {
    const pending = await call('/api/auth/session', { env: { DATA_KEY: undefined, APP_PASSWORD: 'short' } });
    expect(pending.json).toMatchObject({ setup_required: true, configured: false, missing_secrets: ['APP_PASSWORD', 'DATA_KEY'] });
    expect(pending.text).not.toContain(env.JWT_SECRET);
    expect((await call('/api/auth/session')).json).toMatchObject({ configured: true, missing_secrets: [] });
    await createUser('alex@example.com');
    const after = await call('/api/auth/session', { env: { DATA_KEY: undefined } });
    expect(after.json).not.toHaveProperty('missing_secrets');
    expect(after.json).toMatchObject({ setup_required: false, configured: false });
    // sign-in answers 503 too, with no name in it
    const refused = await call('/api/auth/login', {
      body: { email: 'alex@example.com', auth: await authFor('alex@example.com', DEFAULT_PASSWORD), kdf: 1 },
      env: { DATA_KEY: undefined }
    });
    expect(refused.status).toBe(503);
    expect(refused.json).toEqual({ success: false, error: 'Server is not configured', code: 'not_configured' });
  });

  it('assigns everything of a single-user install to the admin (AC2)', async () => {
    const mail = await addMessage(null, { subject: 'Before setup', labels: '["work"]', is_read: 1 });
    const draft = await addMessage(null, { folder: 'drafts', subject: 'My draft' });
    const snoozed = await addMessage(null, { folder: 'snoozed', snoozed_until: Date.now() + 3_600_000 });
    await env.DB.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, 1), (?, ?, 1), (?, ?, 1), (?, ?, 1)')
      .bind('display_name', 'Old Name', 'signature', 'Old signature', 'default_from', 'old@example.com', 'sessions_valid_after', '5')
      .run();
    await env.DB.prepare('INSERT INTO push_subscriptions (endpoint, p256dh, auth, created_at) VALUES (?, ?, ?, 1)')
      .bind('https://fcm.googleapis.com/x', 'k', 'a')
      .run();

    const session = await call('/api/auth/session');
    expect(session.json).toMatchObject({ setup_required: true, default_from: 'old@example.com', default_display_name: 'Old Name' });

    const answer = await call('/api/auth/setup', { body: await goodSetup('old@example.com', { display_name: '' }) });
    expect(answer.status).toBe(200);
    const admin = await db().select().from(users).get();
    expect(admin).toMatchObject({ display_name: 'Old Name', signature: 'Old signature' });
    for (const id of [mail, draft, snoozed]) {
      expect((await db().select().from(messages).where(eq(messages.id, id)).get())?.user_id).toBe(admin?.id);
    }
    expect((await env.DB.prepare('SELECT user_id FROM push_subscriptions').first<{ user_id: string }>())?.user_id).toBe(admin?.id);
    // The old key/value rows are consumed.
    expect((await env.DB.prepare('SELECT key FROM settings').all<{ key: string }>()).results.map((row) => row.key)).toEqual([
      'require_2fa'
    ]);
    const { cookie } = await enrollTotp(cookieOf(answer), { auth: await authFor('old@example.com', DEFAULT_PASSWORD) });
    expect((await call(`/api/drafts/${draft}`, { cookie })).status).toBe(200);
    expect(((await call('/api/messages?folder=snoozed', { cookie })).json as { messages: unknown[] }).messages).toHaveLength(1);
  });
});

describe('sign-in (AC4, AC5, AC9)', () => {
  it('signs in with address and auth, case-insensitively, and records it', async () => {
    const user = await createUser('alex@example.com', { display_name: 'Alex' });
    const answer = await call('/api/auth/login', { body: { email: ' Alex@Example.COM ', auth: user.auth, kdf: 1 } });
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({ user: { id: user.id, email: 'alex@example.com', role: 'member', display_name: 'Alex' } });
    const setCookie = answer.headers.get('Set-Cookie') ?? '';
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Secure/i);
    expect((await db().select().from(users).where(eq(users.id, user.id)).get())?.last_login_at).toBeGreaterThan(0);
    expect((await db().select().from(auditLog)).map((row) => row.action)).toEqual(['sign_in']);
    const history = await call('/api/auth/activity', { cookie: cookieOf(answer) });
    expect(history.json).toMatchObject({ activity: [{ ok: true, kind: 'sign_in', ip: '203.0.113.7' }] });
  });

  it('answers an unknown address and a wrong credential identically, with the same delay', async () => {
    const user = await createUser('alex@example.com');
    const unknown = await timedWrongLogin('nobody@example.com');
    const wrong = await timedWrongLogin(user.email);
    expect(unknown.answer.status).toBe(401);
    expect(wrong.answer.status).toBe(401);
    expect(unknown.answer.text).toBe(wrong.answer.text);
    expect(unknown.answer.json).toMatchObject({ error: 'Wrong email or password' });
    expect(unknown.answer.headers.get('Set-Cookie')).toBeNull();
    expect(Math.min(unknown.took, wrong.took)).toBeGreaterThanOrEqual(380);
    expect(Math.abs(unknown.took - wrong.took)).toBeLessThan(250);
    // Only the known account leaves a trace in its own history; the unknown address leaves none.
    expect((await db().select().from(userSignIns)).map((row) => row.user_id)).toEqual([user.id]);
    expect((await db().select().from(auditLog)).map((row) => row.action)).toEqual(['sign_in_failed']);
  });

  it('refuses a malformed request with 400, before any credential is compared', async () => {
    expect((await call('/api/auth/login', { body: '[1]' })).status).toBe(400);
    expect((await call('/api/auth/login', { body: { email: 'a@example.com', auth: 'short', kdf: 1 } })).status).toBe(400);
    expect((await call('/api/auth/login', { body: { email: 'a@example.com', auth: await authFor('a', 'b'), kdf: 2 } })).status).toBe(400);
  });

  it('throttles per client address: five attempts, then 429 with Retry-After', async () => {
    const attempt = async (n: number) =>
      call('/api/auth/login', { body: { email: `nobody${n}@example.com`, auth: await authFor('x', 'y'), kdf: 1 }, ip: '198.51.100.20' });
    for (let n = 1; n <= 5; n += 1) {
      expect((await attempt(n)).status).toBe(401);
    }
    const blocked = await attempt(6);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(800);
    expect(
      (
        await call('/api/auth/login', {
          body: { email: 'nobody7@example.com', auth: await authFor('x', 'y'), kdf: 1 },
          ip: '198.51.100.21'
        })
      ).status
    ).toBe(401);
  }, 30_000);

  it('locks one account after ten failures for fifteen minutes, from any address, without escalating', async () => {
    const user = await createUser('alex@example.com');
    const other = await createUser('blake@example.com');
    const wrong = await authFor('alex@example.com', 'wrong');
    const key = 'acct:alex@example.com';
    // Nine failures are already on record; the tenth is a real attempt from a fresh address each time.
    await db().insert(loginAttempts).values({ key, failures: 9, window_start: Date.now(), locked_until: 0, updated_at: Date.now() });
    expect((await call('/api/auth/login', { body: { email: user.email, auth: wrong, kdf: 1 }, ip: '198.51.100.31' })).status).toBe(401);
    const locked = await call('/api/auth/login', { body: { email: user.email, auth: user.auth, kdf: 1 }, ip: '198.51.100.32' });
    expect(locked.status).toBe(429);
    const retryAfter = Number(locked.headers.get('Retry-After'));
    expect(retryAfter).toBeGreaterThan(800);
    expect(retryAfter).toBeLessThanOrEqual(900);
    // Another account is not affected.
    expect((await call('/api/auth/login', { body: { email: other.email, auth: other.auth, kdf: 1 }, ip: '198.51.100.33' })).status).toBe(
      200
    );
    // After the lock has run out, the next attempts are let through again (12th..21st); the 22nd locks again for the same fifteen minutes.
    await db()
      .update(loginAttempts)
      .set({ locked_until: Date.now() - 1 })
      .where(eq(loginAttempts.key, key));
    expect((await call('/api/auth/login', { body: { email: user.email, auth: wrong, kdf: 1 }, ip: '198.51.100.34' })).status).toBe(401);
    await db().update(loginAttempts).set({ failures: 21 }).where(eq(loginAttempts.key, key));
    const again = await call('/api/auth/login', { body: { email: user.email, auth: wrong, kdf: 1 }, ip: '198.51.100.35' });
    expect(again.status).toBe(429);
    expect(Number(again.headers.get('Retry-After'))).toBeLessThanOrEqual(900);
  });

  it('locks an unknown address the same way, so the lock reveals nothing', async () => {
    await db()
      .insert(loginAttempts)
      .values({ key: 'acct:ghost@example.com', failures: 10, window_start: Date.now(), locked_until: 0, updated_at: Date.now() });
    const answer = await call('/api/auth/login', { body: { email: 'ghost@example.com', auth: await authFor('x', 'y'), kdf: 1 } });
    expect(answer.status).toBe(429);
  });

  it("clears the account's counter after a correct sign-in (the client's is only given back its own attempt: px-throttle.test.ts)", async () => {
    const user = await createUser('alex@example.com');
    await db()
      .insert(loginAttempts)
      .values({ key: 'acct:alex@example.com', failures: 4, window_start: Date.now(), locked_until: 0, updated_at: Date.now() });
    expect((await call('/api/auth/login', { body: { email: user.email, auth: user.auth, kdf: 1 } })).status).toBe(200);
    expect((await db().select().from(loginAttempts)).map((row) => row.key)).not.toContain('acct:alex@example.com');
  });

  it('tells a disabled user only after a correct credential, and issues no cookie', async () => {
    const user = await createUser('gone@example.com', { status: 'disabled' });
    const right = await call('/api/auth/login', { body: { email: user.email, auth: user.auth, kdf: 1 } });
    expect(right.status).toBe(403);
    expect(right.json).toMatchObject({ error: 'This account is disabled. Contact your administrator.' });
    expect(right.headers.get('Set-Cookie')).toBeNull();
    const wrong = await call('/api/auth/login', { body: { email: user.email, auth: await authFor(user.email, 'nope nope nope'), kdf: 1 } });
    expect(wrong.status).toBe(401);
    expect(wrong.json).toMatchObject({ error: 'Wrong email or password' });
  });

  it('ends the open sessions of a user who is disabled afterwards (next request is 401)', async () => {
    const user = await createUser('alex@example.com');
    const cookie = await signIn(user);
    expect((await call('/api/stats', { cookie })).status).toBe(200);
    await db().update(users).set({ status: 'disabled' }).where(eq(users.id, user.id));
    expect((await call('/api/stats', { cookie })).status).toBe(401);
    expect((await call('/api/auth/session', { cookie })).json).toMatchObject({ authenticated: false });
  });

  it('treats a cookie of the single-user version, and garbage, as signed out (never a 500)', async () => {
    await createUser('alex@example.com');
    const now = Date.now();
    const oldPayload = encodeJson({ iat: now, exp: Math.floor(now / 1000) + 3600 });
    const oldCookie = `__Host-edging_session=${oldPayload}.${await signHmac(`${env.JWT_SECRET ?? ''}\u0000${env.APP_PASSWORD ?? ''}`, oldPayload)}`;
    // Even correctly signed with the new key, a token without a user id is not a session.
    const noUid = `__Host-edging_session=${oldPayload}.${await signHmac(env.JWT_SECRET ?? '', oldPayload)}`;
    const forged = ['garbage', 'a.b', '%%%.%%%', ''].map((value) => `__Host-edging_session=${value}`);
    for (const cookie of [oldCookie, noUid, ...forged]) {
      const stats = await call('/api/stats', { cookie });
      expect(stats.status, cookie).toBe(401);
      expect((await call('/api/auth/session', { cookie })).json, cookie).toMatchObject({ authenticated: false, success: true });
    }
  });

  it('works without the setup key after setup, and goes dark without JWT_SECRET (AC3)', async () => {
    const user = await createUser('alex@example.com', { role: 'admin' });
    const body = { email: user.email, auth: user.auth, kdf: 1 };
    const cookie = await signIn(user);
    expect((await call('/api/auth/login', { body, env: { APP_PASSWORD: undefined } })).status).toBe(200);
    expect((await call('/api/stats', { cookie, env: { APP_PASSWORD: undefined } })).status).toBe(200);
    expect(
      (
        await call('/api/auth/recover', {
          body: { setup_key: 'x'.repeat(20), email: user.email, new_auth: user.auth, kdf: 1 },
          env: { APP_PASSWORD: undefined }
        })
      ).status
    ).toBe(503);
    for (const overrides of [{ JWT_SECRET: undefined }, { JWT_SECRET: 'short' }]) {
      expect((await call('/api/auth/login', { body, env: overrides })).status).toBe(503);
      expect((await call('/api/stats', { cookie, env: overrides })).status).toBe(401);
      expect((await call('/api/auth/session', { cookie, env: overrides })).json).toMatchObject({
        authenticated: false,
        configured: false,
        setup_required: false
      });
    }
  });
});

describe('forced password change, change password, sign out (AC6, AC7, AC8)', () => {
  it('lets a temporary password do nothing but choose a new one (AC6)', async () => {
    const user = await createUser('new@example.com', { mustChange: true });
    const login = await call('/api/auth/login', { body: { email: user.email, auth: user.auth, kdf: 1 } });
    expect(login.json).toMatchObject({ user: { must_change_password: true } });
    const cookie = cookieOf(login);
    for (const path of ['/api/stats', '/api/messages', '/api/settings', '/api/labels', '/api/auth/activity']) {
      const blocked = await call(path, { cookie });
      expect(blocked.status, path).toBe(403);
      expect(blocked.json, path).toEqual({ success: false, error: 'password_change_required', code: 'password_change_required' });
    }
    expect((await call('/api/messages/send', { cookie, body: { to: 'a@example.org', subject: 's' } })).status).toBe(403);
    expect((await call('/api/auth/session', { cookie })).json).toMatchObject({ authenticated: true, user: { must_change_password: true } });

    const newAuth = await authFor(user.email, 'a brand new password');
    // The temporary password is asked for again: the client always has it in hand (no exemption while the gate is open).
    expect((await call('/api/auth/change-password', { cookie, body: { new_auth: newAuth, kdf: 1 } })).status).toBe(400);
    const wrongCurrent = await call('/api/auth/change-password', {
      cookie,
      body: { current_auth: await authFor(user.email, 'not the temporary one'), new_auth: newAuth, kdf: 1, ...REWRAP() }
    });
    expect(wrongCurrent.status).toBe(403);
    const changed = await call('/api/auth/change-password', {
      cookie,
      body: { current_auth: user.auth, new_auth: newAuth, kdf: 1, ...REWRAP() }
    });
    expect(changed.status).toBe(200);
    const fresh = cookieOf(changed);
    expect((await call('/api/stats', { cookie: fresh })).status).toBe(200);
    // The temporary password is dead, and so is the cookie issued before the change.
    expect((await call('/api/auth/login', { body: { email: user.email, auth: user.auth, kdf: 1 } })).status).toBe(401);
    expect((await call('/api/stats', { cookie })).status).toBe(401);
    expect((await call('/api/auth/login', { body: { email: user.email, auth: newAuth, kdf: 1 } })).status).toBe(200);
  });

  it('changes the password with the current one and ends the other sessions, keeping this device (AC7)', async () => {
    const user = await createUser('alex@example.com');
    const phone = await signIn(user);
    const laptop = await signIn(user);
    const newAuth = await authFor(user.email, 'another long password');

    expect((await call('/api/auth/change-password', { cookie: laptop, body: { new_auth: newAuth, kdf: 1 } })).status).toBe(400);
    const wrong = await call('/api/auth/change-password', {
      cookie: laptop,
      body: { current_auth: newAuth, new_auth: newAuth, kdf: 1, ...REWRAP() }
    });
    expect(wrong.status).toBe(403);
    expect(wrong.json).toMatchObject({ code: 'wrong_password' });
    const same = await call('/api/auth/change-password', {
      cookie: laptop,
      body: { current_auth: user.auth, new_auth: user.auth, kdf: 1, ...REWRAP() }
    });
    expect(same.status).toBe(400);
    expect(same.json).toMatchObject({ code: 'same_password' });

    const changed = await call('/api/auth/change-password', {
      cookie: laptop,
      body: { current_auth: user.auth, new_auth: newAuth, kdf: 1, ...REWRAP() }
    });
    expect(changed.status).toBe(200);
    expect((await call('/api/stats', { cookie: cookieOf(changed) })).status).toBe(200);
    expect((await call('/api/stats', { cookie: laptop })).status).toBe(401);
    expect((await call('/api/stats', { cookie: phone })).status).toBe(401);
    expect((await call('/api/auth/login', { body: { email: user.email, auth: user.auth, kdf: 1 } })).status).toBe(401);
    expect((await db().select().from(auditLog)).map((row) => row.action)).toContain('password_change');
  });

  it('counts wrong current passwords under their own key, so they can never lock the owner out of signing in', async () => {
    const user = await createUser('alex@example.com');
    const cookie = await signIn(user);
    const wrong = await call('/api/auth/change-password', {
      cookie,
      body: { current_auth: await authFor(user.email, 'guess'), new_auth: await authFor('x', 'y'), kdf: 1, ...REWRAP() }
    });
    expect(wrong.status).toBe(403);
    const keys = (await db().select().from(loginAttempts)).map((row) => row.key);
    expect(keys).toContain(`stepup:${user.id}`);
    expect(keys).not.toContain('acct:alex@example.com');

    await db()
      .insert(loginAttempts)
      .values({
        key: `stepup:${user.id}`,
        failures: 11,
        window_start: Date.now(),
        locked_until: Date.now() + 600_000,
        updated_at: Date.now()
      })
      .onConflictDoUpdate({ target: loginAttempts.key, set: { failures: 11, locked_until: Date.now() + 600_000 } });
    const locked = await call('/api/auth/change-password', {
      cookie,
      body: { current_auth: user.auth, new_auth: await authFor('x', 'y'), kdf: 1, ...REWRAP() }
    });
    expect(locked.status).toBe(429);
    // Signing in is not affected by the lock on the password-change key.
    expect((await call('/api/auth/login', { body: { email: user.email, auth: user.auth, kdf: 1 } })).status).toBe(200);
  });

  it('expires a temporary password: sign-in fails like a wrong one and an open temporary session ends (M6)', async () => {
    const user = await createUser('new@example.com', { mustChange: true });
    const cookie = await signIn(user);
    expect((await call('/api/auth/session', { cookie })).json).toMatchObject({ authenticated: true });
    await db()
      .update(users)
      .set({ temp_password_expires_at: Date.now() - 1000 })
      .where(eq(users.id, user.id));
    const login = await call('/api/auth/login', { body: { email: user.email, auth: user.auth, kdf: 1 } });
    const wrong = await call('/api/auth/login', { body: { email: user.email, auth: await authFor(user.email, 'nope'), kdf: 1 } });
    expect(login.status).toBe(401);
    expect(login.text).toBe(wrong.text);
    expect(login.headers.get('Set-Cookie')).toBeNull();
    expect((await db().select().from(auditLog)).map((row) => row.action)).toContain('temp_password_expired');
    expect((await call('/api/auth/session', { cookie })).json).toMatchObject({ authenticated: false });
    // Before the expiry it works, and a normal password change clears the deadline.
    await db()
      .update(users)
      .set({ temp_password_expires_at: Date.now() + 3_600_000 })
      .where(eq(users.id, user.id));
    expect((await call('/api/auth/login', { body: { email: user.email, auth: user.auth, kdf: 1 } })).status).toBe(200);
  });

  it('signs out every device of this user and nobody else (AC8)', async () => {
    const alex = await createUser('alex@example.com');
    const blake = await createUser('blake@example.com');
    const alexPhone = await signIn(alex);
    const alexLaptop = await signIn(alex);
    const blakeCookie = await signIn(blake);
    const out = await call('/api/auth/logout', { cookie: alexPhone, body: {} });
    expect(out.status).toBe(200);
    expect(out.headers.get('Set-Cookie') ?? '').toMatch(/__Host-edging_session=;|Max-Age=0|Expires=/i);
    expect((await call('/api/stats', { cookie: alexPhone })).status).toBe(401);
    expect((await call('/api/stats', { cookie: alexLaptop })).status).toBe(401);
    expect((await call('/api/stats', { cookie: blakeCookie })).status).toBe(200);
    // Idempotent, and harmless when signed out.
    expect((await call('/api/auth/logout', { body: {} })).status).toBe(200);
    expect((await call('/api/auth/logout', { cookie: alexPhone, body: {} })).status).toBe(200);
    expect((await call('/api/stats', { cookie: blakeCookie })).status).toBe(200);
  });

  it('signs in again right after signing out, even within the same millisecond', async () => {
    const user = await createUser('alex@example.com');
    const first = await signIn(user);
    await call('/api/auth/logout', { cookie: first, body: {} });
    const second = await signIn(user);
    expect((await call('/api/stats', { cookie: second })).status).toBe(200);
  });
});

describe('break-glass recovery (AC10)', () => {
  it('sets a new credential for an admin with the setup key, revokes sessions and signs nobody in', async () => {
    const admin = await createUser('boss@example.com', { role: 'admin', mustChange: true });
    const cookie = await signIn(admin);
    const newAuth = await authFor(admin.email, 'recovered password!');
    const answer = await recover({ setup_key: SETUP_KEY, email: 'Boss@Example.com', new_auth: newAuth });
    expect(answer.status).toBe(200);
    expect(answer.headers.get('Set-Cookie')).toBeNull();
    expect((await call('/api/stats', { cookie })).status).toBe(401);
    expect((await call('/api/auth/login', { body: { email: admin.email, auth: admin.auth, kdf: 1 } })).status).toBe(401);
    // The setup key restores the console, it does not bypass the second factor: the password step still ends in a challenge
    const login = await call('/api/auth/login', { body: { email: admin.email, auth: newAuth, kdf: 1 } });
    expect(login.status).toBe(200);
    expect(login.json).toMatchObject({ two_factor_required: true });
    expect(login.headers.get('Set-Cookie')).toBeNull();
    expect(login.json).not.toHaveProperty('keys');
    // 2FA is never cleared, the key pair is NEW (the old one is retired with its recovery wrap only), and the version moved on
    const [after] = await db().select().from(users).where(eq(users.id, admin.id));
    expect([after.totp_enabled, after.keys_version]).toEqual([1, 2]);
    expect(after.key_id).not.toBe(admin.keys?.keyId);
    const [retired] = await db().select().from(userKeys);
    expect(retired).toMatchObject({ key_id: admin.keys?.keyId, user_id: admin.id });
    expect(retired.wrapped_private_key_recovery).not.toBeNull();
    expect(Object.keys(retired)).not.toContain('wrapped_private_key_pw');
    expect((await db().select().from(auditLog)).filter((row) => row.action === 'break_glass')).toHaveLength(1);
    expect((await db().select().from(userSecurityEvents)).map((row) => row.kind)).toEqual(['break_glass']);
  });

  it('does not work for members or unknown addresses, and does not re-enable a disabled admin', async () => {
    const member = await createUser('member@example.com');
    const off = await createUser('off@example.com', { role: 'admin', status: 'disabled' });
    const newAuth = await authFor('x', 'recovered password!');
    expect((await recover({ setup_key: SETUP_KEY, email: member.email, new_auth: newAuth })).status).toBe(404);
    expect((await recover({ setup_key: SETUP_KEY, email: 'ghost@example.com', new_auth: newAuth })).status).toBe(404);
    expect((await recover({ setup_key: SETUP_KEY, email: off.email, new_auth: newAuth })).status).toBe(200);
    expect((await call('/api/auth/login', { body: { email: off.email, auth: newAuth, kdf: 1 } })).status).toBe(403);
    expect((await call('/api/auth/login', { body: { email: member.email, auth: member.auth, kdf: 1 } })).status).toBe(200);
  });

  it('is throttled per client address like setup', async () => {
    await createUser('boss@example.com', { role: 'admin' });
    const body = { setup_key: 'a wrong setup key', email: 'boss@example.com', new_auth: await authFor('x', 'y') };
    for (let n = 1; n <= 5; n += 1) {
      expect((await recover(body, '198.51.100.40')).status).toBe(401);
    }
    const blocked = await recover({ ...body, setup_key: SETUP_KEY }, '198.51.100.40');
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('Retry-After')).not.toBeNull();
  }, 30_000);

  it('is off (503) without the setup key', async () => {
    const admin = await createUser('boss@example.com', { role: 'admin' });
    const body = { setup_key: SETUP_KEY, email: admin.email, new_auth: await authFor('x', 'y') };
    expect((await call('/api/auth/recover', { body: { kdf: 1, ...body }, env: { APP_PASSWORD: undefined } })).status).toBe(503);
  });
});

describe('the auth rules are in the middleware, not in the routes', () => {
  it('answers 401 to every route without a session, including ones that do not exist', async () => {
    for (const [method, path] of [
      ['GET', '/api/nothing-here'],
      ['POST', '/api/messages/batch'],
      ['GET', '/api/attachments/x'],
      ['GET', '/api/raw/x'],
      ['PUT', '/api/drafts/00000000-0000-4000-8000-000000000000'],
      ['POST', '/api/push/subscribe'],
      ['POST', '/api/auth/change-password'],
      ['GET', '/api/auth/activity']
    ]) {
      expect((await call(path, { method, body: method === 'GET' ? undefined : {} })).status, `${method} ${path}`).toBe(401);
    }
    expect((await call('/api/health')).status).toBe(200);
  });
});
