import { env } from 'cloudflare:workers';
import { createExecutionContext, runDurableObjectAlarm, runInDurableObject, waitOnExecutionContext } from 'cloudflare:test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { signToken } from '../src/worker/auth/tokens';
import worker from '../src/worker/index';
import { broadcast } from '../src/worker/realtime';
import { call, cookieOf, createUser, must, ORIGIN, testEnv } from './helpers';
import type { TestUser } from './helpers';

// crypto-review.md PX-8: an open WebSocket does not outlive the session behind it. The Worker tells the hub when the session's cookie ends, the hub
// stores that with the socket, closes it with 4401 from an alarm at that time, and never sends it an event after it.

afterEach(() => {
  vi.useRealTimers();
});

const HOUR = 3_600_000;

interface Tab {
  events: { type: string }[];
  closed: Promise<number>;
}

async function openTab(cookie: string, extraHeaders: Record<string, string> = {}): Promise<Tab> {
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`${ORIGIN}/api/ws`, {
      headers: { Upgrade: 'websocket', Cookie: cookie, Origin: ORIGIN, 'CF-Connecting-IP': '203.0.113.7', ...extraHeaders }
    }),
    testEnv(),
    ctx
  );
  expect(response.status).toBe(101);
  const socket = must(response.webSocket);
  const events: { type: string }[] = [];
  const closed = new Promise<number>((resolve) => {
    socket.addEventListener('close', (event) => {
      resolve(event.code);
    });
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
  return { events, closed };
}

/** A session cookie of this user that ends `seconds` from now (the tests run over https). */
async function shortCookie(user: TestUser, seconds: number): Promise<string> {
  const token = await signToken(must(env.JWT_SECRET), 'session', { uid: user.id, iat: Date.now(), su: 0 }, seconds);
  return `__Host-edging_session=${token}`;
}

const hubOf = (user: TestUser) => env.MAIL_HUB.get(env.MAIL_HUB.idFromName(`user:${user.id}`));
const attachments = (user: TestUser) =>
  runInDurableObject(hubOf(user), (_instance, state) =>
    state.getWebSockets().map((socket) => socket.deserializeAttachment() as { end: number })
  );
const login = (user: TestUser, shared: boolean) =>
  call('/api/auth/login', { body: { email: user.email, auth: user.auth, kdf: 1, ...(shared ? { shared: true } : {}) } });

describe('a socket ends with its session (PX-8)', () => {
  it('is closed with 4401 when the cookie it came with expires, without any event or request to wake it', async () => {
    const user = await createUser('alex@example.com');
    const tab = await openTab(await shortCookie(user, 2));
    const code = await Promise.race([
      tab.closed,
      new Promise<number>((resolve) => {
        setTimeout(() => {
          resolve(-1);
        }, 8000);
      })
    ]);
    expect(code).toBe(4401);
  });

  it('takes the end from the cookie, whatever header the caller sent', async () => {
    const user = await createUser('alex@example.com');
    const tab = await openTab(await shortCookie(user, 2), { 'X-Session-End': '99999999999999' });
    expect((await attachments(user))[0]?.end).toBeLessThan(Date.now() + 3000);
    expect(
      await Promise.race([
        tab.closed,
        new Promise<number>((resolve) => {
          setTimeout(() => {
            resolve(-1);
          }, 8000);
        })
      ])
    ).toBe(4401);
  });

  it('stores twelve hours for a shared device and fourteen days for a normal one, and arms the alarm for the earliest', async () => {
    const user = await createUser('alex@example.com');
    const sharedTab = await openTab(cookieOf(await login(user, true)));
    const [shared] = await attachments(user);
    expect(shared.end).toBeGreaterThan(Date.now() + 12 * HOUR - 60_000);
    expect(shared.end).toBeLessThanOrEqual(Date.now() + 12 * HOUR);
    const normalTab = await openTab(cookieOf(await login(user, false)));
    const ends = (await attachments(user)).map((entry) => entry.end).toSorted((a, b) => a - b);
    expect(ends).toHaveLength(2);
    expect(ends[1]).toBeGreaterThan(Date.now() + 14 * 24 * HOUR - 60_000);
    expect(await runInDurableObject(hubOf(user), (_instance, state) => state.storage.getAlarm())).toBe(ends[0]);
    // it is still open now
    expect(sharedTab.events.map((event) => event.type)).toEqual(['hello']);
    expect(normalTab.events.map((event) => event.type)).toEqual(['hello']);
  });

  it('closes the shared-device socket at twelve hours (the alarm) and keeps the other open, and re-arms for it', async () => {
    const user = await createUser('alex@example.com');
    const shared = await openTab(cookieOf(await login(user, true)));
    const normal = await openTab(cookieOf(await login(user, false)));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 13 * HOUR);
    expect(await runDurableObjectAlarm(hubOf(user))).toBe(true);
    expect(await shared.closed).toBe(4401);
    const alarm = await runInDurableObject(hubOf(user), (_instance, state) => state.storage.getAlarm());
    expect(alarm).toBeGreaterThan(Date.now() + 13 * 24 * HOUR - 13 * HOUR);
    const stillOpen = await Promise.race([normal.closed, Promise.resolve(-1)]);
    expect(stillOpen).toBe(-1);
  });

  it('sends nothing to a socket whose session is over even if the alarm has not run: the event closes it instead', async () => {
    const user = await createUser('alex@example.com');
    const tab = await openTab(cookieOf(await login(user, true)));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 13 * HOUR);
    await broadcast(testEnv(), user.id, { type: 'mail.changed' });
    expect(await tab.closed).toBe(4401);
    expect(tab.events.map((event) => event.type)).toEqual(['hello']);
  });

  it('refuses a connection the hub was not told an end for, or one that is already over', async () => {
    const user = await createUser('alex@example.com');
    const variants: Record<string, string>[] = [
      {},
      { 'X-Session-End': 'soon' },
      { 'X-Session-End': String(Date.now() - 1000) },
      { 'X-Session-End': '' }
    ];
    for (const headers of variants) {
      const answer = await hubOf(user).fetch('https://mail-hub/ws', { headers: { Upgrade: 'websocket', ...headers } });
      expect(answer.status, JSON.stringify(headers)).toBe(401);
    }
    expect(await attachments(user)).toEqual([]);
  });
});
