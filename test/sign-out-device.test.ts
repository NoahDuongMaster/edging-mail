import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signToken } from '../src/worker/auth/tokens';
import { revokedSessions } from '../src/worker/db/schema';
import worker from '../src/worker/index';
import { pruneActivity } from '../src/worker/maintenance';
import { authFor, call, cookieOf, createUser, db, fakeWrap, must, ORIGIN, signIn, testEnv } from './helpers';
import type { TestUser } from './helpers';

// Signing out ends THIS device: its cookie carries a `sid` that goes on a deny list, and only the sockets opened with that cookie close. Every other
// way a session ends (password change, disable, role change ...) still ends every device through `sessions_valid_after`.

afterEach(() => {
  vi.useRealTimers();
});

const DAY = 86_400_000;
const works = async (cookie: string): Promise<boolean> => (await call('/api/stats', { cookie })).status === 200;
const signOut = (cookie: string) => call('/api/auth/logout', { method: 'POST', cookie, body: {} });

interface Tab {
  events: { type: string }[];
  /** Resolves with the close code, or 'open' when the socket is still open after a short wait from the moment of asking. */
  closed: () => Promise<number | 'open'>;
  close: () => void;
}

async function openTab(cookie: string): Promise<Tab> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`${ORIGIN}/api/ws`, {
      headers: { Upgrade: 'websocket', Cookie: cookie, Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.7' }
    }),
    testEnv(),
    ctx
  );
  expect(response.status).toBe(101);
  const socket = must(response.webSocket);
  const events: { type: string }[] = [];
  let code: number | undefined;
  socket.addEventListener('close', (event) => {
    code = event.code;
  });
  socket.addEventListener('message', (event) => {
    events.push(JSON.parse(String(event.data)) as { type: string });
  });
  socket.accept();
  const started = Date.now();
  while (!events.some((event) => event.type === 'hello')) {
    if (Date.now() - started > 3000) {
      throw new Error('no hello');
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }
  await waitOnExecutionContext(ctx);
  return {
    events,
    closed: () =>
      new Promise((resolve) => {
        const asked = Date.now();
        const look = (): void => {
          if (code !== undefined) {
            resolve(code);
          } else if (Date.now() - asked > 600) {
            resolve('open');
          } else {
            setTimeout(look, 20);
          }
        };
        look();
      }),
    close: () => {
      socket.close();
    }
  };
}

describe('signing out ends this device only', () => {
  it('revokes the cookie of the device that signed out and none of the person\u2019s other cookies', async () => {
    const user = await createUser('alex@example.com');
    const phone = await signIn(user, '203.0.113.40');
    const laptop = await signIn(user, '203.0.113.41');
    expect((await signOut(phone)).status).toBe(200);
    expect(await works(phone)).toBe(false);
    expect(await works(laptop)).toBe(true);
    // The deny list holds the sid of the phone's cookie, for as long as that cookie could have worked.
    const rows = await db().select().from(revokedSessions).where(eq(revokedSessions.user_id, user.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.expires_at).toBeGreaterThan(Date.now() + 89 * DAY);
    // Signing out twice is harmless, and the laptop can sign out later on its own.
    expect((await signOut(phone)).status).toBe(200);
    expect(await db().select().from(revokedSessions)).toHaveLength(1);
    expect(await works(laptop)).toBe(true);
    expect((await signOut(laptop)).status).toBe(200);
    expect(await works(laptop)).toBe(false);
  });

  it('keeps a renewed cookie tied to the same sign-in, so signing out ends the cookie it replaced too', async () => {
    const user = await createUser('alex@example.com');
    const first = await signIn(user, '203.0.113.42');
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 2 * DAY);
    const answer = await call('/api/stats', { cookie: first });
    const renewed =
      /^[^;]+/.exec(answer.headers.getSetCookie().find((cookie) => cookie.startsWith('__Host-edging_session=')) ?? '')?.[0] ?? '';
    expect(renewed).not.toBe('');
    expect(renewed).not.toBe(first);
    expect(await works(renewed)).toBe(true);
    expect((await signOut(renewed)).status).toBe(200);
    expect(await works(renewed)).toBe(false);
    expect(await works(first)).toBe(false);
  });

  it('is not what a password change does: that still ends every other device', async () => {
    const user = await createUser('alex@example.com');
    const phone = await signIn(user, '203.0.113.43');
    const laptop = await signIn(user, '203.0.113.44');
    const change = await call('/api/auth/change-password', {
      cookie: laptop,
      body: {
        current_auth: user.auth,
        new_auth: await authFor(user.email, 'another long password'),
        kdf: 1,
        keys: { wrapped_private_key_pw: fakeWrap() },
        keys_version: 1
      }
    });
    expect(change.status).toBe(200);
    expect(await works(phone)).toBe(false);
    expect(await works(cookieOf(change))).toBe(true);
  });

  it('still ends every device for a cookie from before sign-out became per device (it has no sid)', async () => {
    const user = await createUser('alex@example.com');
    const modern = await signIn(user, '203.0.113.45');
    const legacy = `__Host-edging_session=${await signToken(must(env.JWT_SECRET), 'session', { uid: user.id, iat: Date.now(), su: 0 }, 3600)}`;
    expect(await works(legacy)).toBe(true);
    expect((await signOut(legacy)).status).toBe(200);
    expect(await works(legacy)).toBe(false);
    expect(await works(modern)).toBe(false);
    expect(await db().select().from(revokedSessions)).toHaveLength(0);
  });

  it('lets the person sign in again at once on the device that signed out', async () => {
    const user = await createUser('alex@example.com');
    const first = await signIn(user, '203.0.113.46');
    await signOut(first);
    const second = await signIn(user, '203.0.113.46');
    expect(await works(second)).toBe(true);
    expect(await works(first)).toBe(false);
  });

  it('forgets a revoked sign-in once its cookie could no longer work (the cron)', async () => {
    const user = await createUser('alex@example.com');
    await db()
      .insert(revokedSessions)
      .values([
        { sid: 'long-gone', user_id: user.id, expires_at: Date.now() - 1000 },
        { sid: 'still-needed', user_id: user.id, expires_at: Date.now() + DAY }
      ]);
    await pruneActivity(testEnv());
    expect((await db().select().from(revokedSessions)).map((row) => row.sid)).toEqual(['still-needed']);
  });
});

const twoDevices = async (user: TestUser) => {
  const phone = await signIn(user, '203.0.113.47');
  const laptop = await signIn(user, '203.0.113.48');
  return { phone, laptop, phoneTab: await openTab(phone), laptopTab: await openTab(laptop) };
};

describe('the live socket follows the device that signed out', () => {
  it('closes the sockets of that device with 4401 and leaves the other device\u2019s socket open', async () => {
    const user = await createUser('alex@example.com');
    const { phone, laptop, phoneTab, laptopTab } = await twoDevices(user);
    expect((await signOut(phone)).status).toBe(200);
    expect(await phoneTab.closed()).toBe(4401);
    expect(await laptopTab.closed()).toBe('open');
    expect(await works(laptop)).toBe(true);
    phoneTab.close();
    laptopTab.close();
  });

  it('refuses a new socket from the cookie that signed out', async () => {
    const user = await createUser('alex@example.com');
    const phone = await signIn(user, '203.0.113.49');
    await signOut(phone);
    const answer = await call('/api/ws', { headers: { Upgrade: 'websocket', Origin: ORIGIN }, cookie: phone });
    expect(answer.status).toBe(401);
  });

  it('closes every socket of the person for a cookie that has no sid', async () => {
    const user = await createUser('alex@example.com');
    const modern = await signIn(user, '203.0.113.50');
    const legacy = `__Host-edging_session=${await signToken(must(env.JWT_SECRET), 'session', { uid: user.id, iat: Date.now(), su: 0 }, 3600)}`;
    const modernTab = await openTab(modern);
    const legacyTab = await openTab(legacy);
    await signOut(legacy);
    expect(await legacyTab.closed()).toBe(4401);
    expect(await modernTab.closed()).toBe(4401);
  });
});
