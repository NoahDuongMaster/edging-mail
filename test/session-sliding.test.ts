import { afterEach, describe, expect, it, vi } from 'vitest';
import { authFor, call, cookieOf, createUser, fakeWrap, signIn } from './helpers';
import type { Answer } from './helpers';

// A session that is being used does not run out: a request that finds the cookie more than a day old renews it for fourteen days (never past
// ninety days after the sign-in, never for a shared device), and a database that cannot be read is a 503, not a signed-out person.

afterEach(() => {
  vi.useRealTimers();
});

const DAY = 86_400_000;
const NAME = '__Host-edging_session';
const sessionCookies = (answer: Answer): string[] => answer.headers.getSetCookie().filter((cookie) => cookie.startsWith(`${NAME}=`));
const maxAge = (cookie: string | undefined): number => Number(/Max-Age=(\d+)/.exec(cookie ?? '')?.[1]);
const pairOf = (cookie: string | undefined): string => /^[^;]+/.exec(cookie ?? '')?.[0] ?? '';
const works = async (cookie: string): Promise<boolean> => (await call('/api/stats', { cookie })).status === 200;
const travel = (days: number, from: number): void => {
  vi.setSystemTime(from + days * DAY);
};

describe('a session that is in use is renewed', () => {
  it('leaves a cookie issued today alone', async () => {
    const cookie = await signIn(await createUser('alex@example.com'));
    const answer = await call('/api/stats', { cookie });
    expect(answer.status).toBe(200);
    expect(sessionCookies(answer)).toEqual([]);
  });

  it('gives a cookie more than a day old fourteen more days, so it outlives the one it replaces', async () => {
    const cookie = await signIn(await createUser('alex@example.com'));
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    travel(2, start);
    const answer = await call('/api/stats', { cookie });
    const [renewed] = sessionCookies(answer);
    expect(sessionCookies(answer)).toHaveLength(1);
    expect(maxAge(renewed)).toBe(14 * 86_400);
    expect(renewed).toMatch(/HttpOnly/i);
    expect(renewed).toMatch(/Secure/i);
    expect(renewed).toMatch(/SameSite=Lax/i);
    expect(renewed).toMatch(/Path=\//);

    travel(15, start);
    expect(await works(cookie)).toBe(false);
    expect(await works(pairOf(renewed))).toBe(true);
  });

  it('renews a device in use for months, and stops ninety days after the sign-in', async () => {
    let cookie = await signIn(await createUser('alex@example.com'));
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    for (let day = 10; day <= 80; day += 10) {
      travel(day, start);
      const answer = await call('/api/stats', { cookie });
      expect(answer.status, `day ${day}`).toBe(200);
      cookie = pairOf(sessionCookies(answer)[0]);
      expect(cookie, `day ${day}`).not.toBe('');
    }
    // The last renewal was cut to the ninety-day limit (ten days from day 80), and a request near the end gets no further extension.
    travel(85, start);
    const near = await call('/api/stats', { cookie });
    expect(near.status).toBe(200);
    expect(sessionCookies(near)).toEqual([]);
    travel(91, start);
    expect(await works(cookie)).toBe(false);
  });

  it('is still ended by a revocation of every device: the renewed cookie carries the old issue time', async () => {
    const user = await createUser('alex@example.com');
    const first = await signIn(user, '203.0.113.20');
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    travel(2, start);
    const renewed = pairOf(sessionCookies(await call('/api/stats', { cookie: first }))[0]);
    expect(await works(renewed)).toBe(true);
    const second = await signIn(user, '203.0.113.21');
    const change = await call('/api/auth/change-password', {
      cookie: second,
      body: {
        current_auth: user.auth,
        new_auth: await authFor(user.email, 'another long password'),
        kdf: 1,
        keys: { wrapped_private_key_pw: fakeWrap() },
        keys_version: 1
      }
    });
    expect(change.status).toBe(200);
    expect(await works(renewed)).toBe(false);
    expect(await works(first)).toBe(false);
  });

  it('keeps the second-factor mark of the session', async () => {
    const admin = await createUser('boss@example.com', { role: 'admin' });
    const cookie = await signIn(admin);
    const stepUp = async (value: string): Promise<number> =>
      (await call<{ user: { step_up_at: number } }>('/api/auth/session', { cookie: value })).json.user.step_up_at;
    const before = await stepUp(cookie);
    expect(before).toBeGreaterThan(0);
    vi.useFakeTimers({ toFake: ['Date'] });
    travel(2, Date.now());
    const renewed = pairOf(sessionCookies(await call('/api/stats', { cookie }))[0]);
    expect(await stepUp(renewed)).toBe(before);
  });

  it('never renews a shared-device session', async () => {
    const user = await createUser('alex@example.com');
    const shared = cookieOf(await call('/api/auth/login', { body: { email: user.email, auth: user.auth, kdf: 1, shared: true } }));
    vi.useFakeTimers({ toFake: ['Date'] });
    travel(0.25, Date.now());
    const answer = await call('/api/stats', { cookie: shared });
    expect(answer.status).toBe(200);
    expect(sessionCookies(answer)).toEqual([]);
  });

  it('does not overwrite the cookie of a request that starts or ends a session itself', async () => {
    const user = await createUser('alex@example.com');
    const cookie = await signIn(user);
    vi.useFakeTimers({ toFake: ['Date'] });
    travel(2, Date.now());
    const out = await call('/api/auth/logout', { method: 'POST', cookie });
    expect(out.status).toBe(200);
    expect(sessionCookies(out)).toHaveLength(1);
    expect(sessionCookies(out)[0]).toMatch(/Max-Age=0/);

    const again = await signIn(user, '203.0.113.30');
    travel(4, Date.now());
    const change = await call('/api/auth/change-password', {
      cookie: again,
      body: {
        current_auth: user.auth,
        new_auth: await authFor(user.email, 'another long password'),
        kdf: 1,
        keys: { wrapped_private_key_pw: fakeWrap() },
        keys_version: 1
      }
    });
    expect(change.status).toBe(200);
    expect(sessionCookies(change)).toHaveLength(1);
    expect(await works(cookieOf(change))).toBe(true);
  });

  it('does not renew a cookie that is not a session', async () => {
    const answer = await call('/api/stats', { cookie: `${NAME}=forged.value` });
    expect(answer.status).toBe(401);
    expect(sessionCookies(answer)).toEqual([]);
  });
});

describe('a database that cannot be read is not a signed-out person', () => {
  const broken = {
    prepare: () => {
      throw new Error('database is down');
    },
    batch: () => {
      throw new Error('database is down');
    }
  } as unknown as D1Database;

  it('answers 503 on every private route, so the browser keeps its session and its key', async () => {
    const cookie = await signIn(await createUser('alex@example.com'));
    for (const path of ['/api/stats', '/api/auth/session', '/api/messages']) {
      const answer = await call(path, { cookie, env: { DB: broken } });
      expect(answer.status, path).toBe(503);
      expect(answer.json, path).toMatchObject({ success: false, code: 'unavailable' });
    }
    // The same cookie works again as soon as the database does.
    expect(await works(cookie)).toBe(true);
  });

  it('still answers 401 for a cookie that is not genuine, without touching the database', async () => {
    const answer = await call('/api/stats', { cookie: `${NAME}=forged.value`, env: { DB: broken } });
    expect(answer.status).toBe(401);
    const none = await call('/api/stats', { env: { DB: broken } });
    expect(none.status).toBe(401);
  });
});
