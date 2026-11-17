import { desc } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { auditLog } from '../src/worker/db/schema';
import { call, cookieOf, createUser, db, signIn } from './helpers';

// POST /api/auth/sign-out-others: the caller's password, then every other session of the account ends and this device gets a fresh cookie.

const works = async (cookie: string): Promise<boolean> => (await call('/api/stats', { cookie })).status === 200;
const signOutOthers = (cookie: string, auth: string) => call('/api/auth/sign-out-others', { cookie, body: { current_auth: auth } });

describe('signing out the other devices', () => {
  it('ends every other session of the person, keeps this device signed in and leaves other people alone', async () => {
    const alex = await createUser('alex@example.com');
    const blake = await createUser('blake@example.com');
    const laptop = await signIn(alex, '203.0.113.60');
    const phone = await signIn(alex, '203.0.113.61');
    const tablet = await signIn(alex, '203.0.113.62');
    const blakeCookie = await signIn(blake, '203.0.113.63');

    const answer = await signOutOthers(laptop, alex.auth);
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({ success: true });
    const fresh = cookieOf(answer);
    expect(answer.headers.get('Set-Cookie')).toMatch(/Max-Age=1209600/);
    expect(await works(fresh)).toBe(true);
    expect(await works(phone)).toBe(false);
    expect(await works(tablet)).toBe(false);
    expect(await works(blakeCookie)).toBe(true);
    // The cookie this device had is one of the revoked ones (a renewal replaces it): the browser uses the new one.
    expect(await works(laptop)).toBe(false);
    // The device that stayed can still sign itself out, which does not touch anything else.
    expect((await call('/api/auth/logout', { cookie: fresh, body: {} })).status).toBe(200);
    expect(await works(blakeCookie)).toBe(true);
  });

  it('asks for the right password, and a wrong one changes nothing', async () => {
    const alex = await createUser('alex@example.com');
    const laptop = await signIn(alex, '203.0.113.64');
    const phone = await signIn(alex, '203.0.113.65');
    const wrong = await signOutOthers(laptop, 'A'.repeat(43));
    expect(wrong.status).toBe(403);
    expect(wrong.json).toMatchObject({ code: 'wrong_password' });
    expect(wrong.headers.get('Set-Cookie') ?? '').not.toMatch(/edging_session=[^;]/);
    expect(await works(laptop)).toBe(true);
    expect(await works(phone)).toBe(true);
  });

  it('refuses a request without the password, without a session, and with extra fields', async () => {
    const alex = await createUser('alex@example.com');
    const cookie = await signIn(alex, '203.0.113.66');
    expect((await call('/api/auth/sign-out-others', { cookie, body: {} })).status).toBe(400);
    expect((await call('/api/auth/sign-out-others', { cookie, body: { current_auth: 'short' } })).status).toBe(400);
    expect((await call('/api/auth/sign-out-others', { cookie, body: { current_auth: alex.auth, everyone: true } })).status).toBe(400);
    expect((await call('/api/auth/sign-out-others', { body: { current_auth: alex.auth } })).status).toBe(401);
    expect(await works(cookie)).toBe(true);
  });

  it('writes an audit entry for the person who did it', async () => {
    const alex = await createUser('alex@example.com');
    const cookie = await signIn(alex, '203.0.113.67');
    await signOutOthers(cookie, alex.auth);
    const [latest] = await db().select().from(auditLog).orderBy(desc(auditLog.id)).limit(1);
    expect(latest).toMatchObject({ action: 'sessions_revoked', actor_email: 'alex@example.com', target: 'alex@example.com' });
  });

  it('keeps a shared-device session a shared-device session', async () => {
    const alex = await createUser('alex@example.com');
    const shared = cookieOf(await call('/api/auth/login', { body: { email: alex.email, auth: alex.auth, kdf: 1, shared: true } }));
    const answer = await signOutOthers(shared, alex.auth);
    expect(answer.status).toBe(200);
    expect(answer.headers.get('Set-Cookie')).not.toMatch(/Max-Age|Expires/i);
    expect((await call<{ shared?: boolean }>('/api/auth/session', { cookie: cookieOf(answer) })).json.shared).toBe(true);
  });
});
