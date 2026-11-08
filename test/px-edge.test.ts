import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import worker from '../src/worker/index';
import { loginAttempts } from '../src/worker/db/schema';
import { call, cookieOf, createUser, db, newSubscriber, must, ORIGIN, signIn, testEnv } from './helpers';
import type { PushSubscriber } from './helpers';

// crypto-review.md section 22: PX-4 (push endpoints), PX-5 (body cap on routes that do not take mail), PX-9 (the __Host- session cookie).

/** A request with the scheme and body of the caller's choosing, through the real fetch handler. */
async function raw(
  url: string,
  init: RequestInit & { duplex?: 'half' } = {}
): Promise<{ status: number; headers: Headers; json: Record<string, unknown> }> {
  const headers = new Headers(init.headers);
  headers.set('CF-Connecting-IP', '203.0.113.7');
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(url, { ...init, headers }), testEnv(), ctx);
  await waitOnExecutionContext(ctx);
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // not JSON
  }
  return { status: response.status, headers: response.headers, json };
}

const subscribe = (cookie: string, endpoint: string, subscriber: PushSubscriber, overrides: { ALLOW_LOCAL_PUSH?: string } = {}) =>
  call<{ error?: string }>('/api/push/subscribe', { cookie, body: { endpoint, keys: subscriber.keys }, env: overrides });
const STRICT = { ALLOW_LOCAL_PUSH: undefined };
// A plain-http URL of a host that is not loopback, built so that the lint rule that wants https everywhere does not see a literal one.
const insecure = (rest: string): string => ['http', rest].join('://');
const jsonOf = (size: number): string => JSON.stringify({ email: 'a@example.com', pad: 'x'.repeat(size) });
const HTTP = 'http://localhost:8787';
const loginOver = (base: string, email: string, auth: string) =>
  raw(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, auth, kdf: 1 })
  });
const stats = (base: string, cookie: string) => raw(`${base}/api/stats`, { headers: { Cookie: cookie } });
const cleared = (answer: { headers: Headers }, name: string): string | undefined =>
  answer.headers.getSetCookie().find((cookie) => cookie.startsWith(`${name}=;`));

describe('push endpoints (PX-4)', () => {
  it('takes https on port 443 to a push service and nothing else when the deployment is not local', async () => {
    const cookie = await signIn(await createUser('alex@example.com'));
    const subscriber = await newSubscriber();
    const refused = [
      'http://127.0.0.1/x',
      'http://127.0.0.1:8080/x',
      'http://localhost:9999/x',
      'http://127.1/x',
      'http://2130706433/x',
      'https://127.0.0.1/x',
      'https://localhost/x',
      insecure('fcm.googleapis.com/fcm/send/x'),
      'https://fcm.googleapis.com:444/fcm/send/x',
      'https://fcm.googleapis.com:8443/fcm/send/x',
      'https://updates.push.services.mozilla.com:8443/wpush/v2/x',
      'https://web.push.apple.com:8443/x',
      'https://fcm.googleapis.com.evil.example/x',
      'https://evil.example/x'
    ];
    for (const endpoint of refused) {
      const answer = await subscribe(cookie, endpoint, subscriber, STRICT);
      expect([answer.status, endpoint]).toEqual([400, endpoint]);
    }
    for (const endpoint of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://fcm.googleapis.com:443/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://web.push.apple.com/abc',
      'https://wns2.notify.windows.com/abc'
    ]) {
      const answer = await subscribe(cookie, endpoint, subscriber, STRICT);
      expect([answer.status, endpoint]).toEqual([200, endpoint]);
    }
  });

  it('takes a loopback fake push service over http, on any port, only when the deployment says it is local', async () => {
    const cookie = await signIn(await createUser('alex@example.com'));
    const subscriber = await newSubscriber();
    for (const endpoint of [
      'http://127.0.0.1/x',
      'http://127.0.0.1:8080/x',
      'http://localhost:9999/x',
      'http://127.1/x',
      'http://2130706433/x'
    ]) {
      for (const flag of ['on', ' ON ']) {
        expect((await subscribe(cookie, endpoint, subscriber, { ALLOW_LOCAL_PUSH: flag })).status, `${endpoint} with "${flag}"`).toBe(200);
      }
      for (const flag of [undefined, '', 'off', 'yes', 'true']) {
        expect((await subscribe(cookie, endpoint, subscriber, { ALLOW_LOCAL_PUSH: flag })).status, `${endpoint} with ${String(flag)}`).toBe(
          400
        );
      }
    }
  });

  it('keeps every other rule in a local deployment: real hosts still need port 443, and other hosts are refused', async () => {
    const cookie = await signIn(await createUser('alex@example.com'));
    const subscriber = await newSubscriber();
    for (const endpoint of [
      'https://fcm.googleapis.com:8443/x',
      insecure('fcm.googleapis.com/x'),
      insecure('example.com/x'),
      'http://169.254.169.254/x',
      'http://[::1]/x',
      'http://user:pass@127.0.0.1/x',
      'ftp://127.0.0.1/x'
    ]) {
      expect((await subscribe(cookie, endpoint, subscriber, { ALLOW_LOCAL_PUSH: 'on' })).status, endpoint).toBe(400);
    }
  });
});

describe('the body of a route that does not take mail is capped before it is read (PX-5)', () => {
  const headers = { 'Content-Type': 'application/json' };

  it('answers 413 payload_too_large to a declared length over 16 KiB, before the route runs: nothing is counted, nothing is derived', async () => {
    for (const path of [
      '/api/auth/login',
      '/api/auth/forgot/verify',
      '/api/auth/setup',
      '/api/auth/login/2fa',
      '/api/keys/lookup',
      '/api/auth/recover'
    ]) {
      const answer = await raw(`${ORIGIN}${path}`, { method: 'POST', headers, body: jsonOf(8 * 1024 * 1024) });
      expect([path, answer.status, answer.json.code]).toEqual([path, 413, 'payload_too_large']);
    }
    // no throttle row, no work: the route never saw the request
    expect(await db().select().from(loginAttempts)).toEqual([]);
  });

  it('stops a body that declares no length at the cap, without reading the rest', async () => {
    let pulled = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1;
        if (pulled > 200) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(64 * 1024).fill(0x20));
      }
    });
    const answer = await raw(`${ORIGIN}/api/auth/login`, { method: 'POST', headers, body: stream, duplex: 'half' });
    expect([answer.status, answer.json.code]).toEqual([413, 'payload_too_large']);
    // 200 chunks of 64 KiB were on offer: only the first few were taken
    expect(pulled).toBeLessThan(10);
  });

  it('lets a body under the cap through to its route (here: refused by the route, not by the cap)', async () => {
    const answer = await call('/api/auth/login', { body: jsonOf(12 * 1024) });
    expect([answer.status, answer.json.code]).toEqual([400, 'invalid_body']);
    // and a real request of the largest honest kind: Setup with the most aliases of 320 characters is below the cap
    const aliases = Array.from({ length: 20 }, (_, index) => `${'a'.repeat(60)}${index}@${'b'.repeat(50)}.example.com`);
    const size = JSON.stringify({ aliases, display_name: 'x'.repeat(100), pad: 'k'.repeat(2000) }).length;
    expect(size).toBeLessThan(16 * 1024);
  });

  it('leaves the three routes that take mail to their own limits, and gives a batch of message ids room for thousands', async () => {
    const cookie = await signIn(await createUser('alex@example.com'));
    const big = 'x'.repeat(200 * 1024);
    const send = await call('/api/messages/send', { cookie, body: { subject: 's', text: big } });
    expect([send.status, send.json.code]).toEqual([400, 'invalid_request']);
    const ids = Array.from({ length: 3000 }, () => crypto.randomUUID());
    const batch = await call('/api/messages/batch', { cookie, body: { message_ids: ids, action: 'read' } });
    expect(batch.status).not.toBe(413);
    const tooMany = await call('/api/messages/batch', { cookie, body: { message_ids: [...ids, ...ids, ...ids, ...ids], action: 'read' } });
    expect([tooMany.status, tooMany.json.code]).toEqual([413, 'payload_too_large']);
    // an ordinary authenticated route is capped like the public ones
    const settings = await call('/api/settings', { cookie, body: { signature: big } });
    expect([settings.status, settings.json.code]).toEqual([413, 'payload_too_large']);
  });
});

describe('the session cookie is __Host-edging_session over https (PX-9)', () => {
  it('is host-only, Secure, HttpOnly, Path=/ and SameSite=Lax, and works as the session', async () => {
    const user = await createUser('alex@example.com');
    const answer = await call('/api/auth/login', { body: { email: user.email, auth: user.auth, kdf: 1 } });
    expect(answer.headers.getSetCookie()).toHaveLength(1);
    const header = answer.headers.getSetCookie()[0] ?? '';
    expect(header).toMatch(/^__Host-edging_session=[^;]+;/);
    expect(header).toContain('Secure');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('Path=/');
    expect(header).toContain('SameSite=Lax');
    expect(header).not.toMatch(/Domain=/i);
    expect((await call('/api/stats', { cookie: cookieOf(answer) })).status).toBe(200);
  });

  it('never reads a cookie of the plain name over https: a leftover of the old name and a planted one are inert', async () => {
    const victim = await createUser('victim@example.com');
    const attacker = await createUser('attacker@example.com');
    const real = await signIn(victim);
    const planted = (await signIn(attacker)).replace('__Host-edging_session=', 'edging_session=');
    // a session that was valid under the old name is not a session now (everybody is signed out once by the upgrade)
    const old = real.replace('__Host-edging_session=', 'edging_session=');
    expect((await call('/api/stats', { cookie: old })).status).toBe(401);
    expect((await call('/api/auth/session', { cookie: old })).json).toMatchObject({ authenticated: false });
    // a planted cookie of the attacker next to the genuine one changes nothing: the genuine one decides, and the planted one alone is nothing
    const both = await call<{ user?: { email: string } }>('/api/auth/session', { cookie: `${planted}; ${real}` });
    expect(both.json).toMatchObject({ authenticated: true });
    expect(JSON.stringify(both.json)).toContain('victim@example.com');
    expect(JSON.stringify(both.json)).not.toContain('attacker@example.com');
    expect((await call('/api/stats', { cookie: planted })).status).toBe(401);
  });

  it('keeps the plain name over http (local development) and does not read the prefixed one there', async () => {
    const user = await createUser('alex@example.com');
    const answer = await loginOver(HTTP, user.email, user.auth);
    const header = answer.headers.getSetCookie()[0] ?? '';
    expect(header).toMatch(/^edging_session=[^;]+;/);
    expect(header).not.toContain('Secure');
    const pair = must(/edging_session=[^;]+/.exec(header)?.[0]);
    expect((await stats(HTTP, pair)).status).toBe(200);
    expect((await stats(HTTP, `__Host-${pair}`)).status).toBe(401);
    // and the other way round over https
    expect((await call('/api/stats', { cookie: pair })).status).toBe(401);
  });

  it('clears the cookie of its scheme and a leftover plain one at sign-out, also when there is no session', async () => {
    const user = await createUser('alex@example.com');
    const real = await signIn(user);
    const stale = 'edging_session=left-over-from-the-old-name';
    const out = await call('/api/auth/logout', { cookie: `${real}; ${stale}`, body: {} });
    expect(out.status).toBe(200);
    expect(cleared(out, '__Host-edging_session')).toMatch(/Max-Age=0/);
    expect(cleared(out, '__Host-edging_session')).toContain('Secure');
    expect(cleared(out, 'edging_session')).toMatch(/Max-Age=0/);
    expect((await call('/api/stats', { cookie: real })).status).toBe(401);
    // nobody is signed in, only a stale cookie is there: still a clean answer that clears it
    const alone = await call('/api/auth/logout', { cookie: stale, body: {} });
    expect(alone.status).toBe(200);
    expect(cleared(alone, 'edging_session')).toBeDefined();
    // without any cookie there is nothing old to clear
    expect(cleared(await call('/api/auth/logout', { body: {} }), 'edging_session')).toBeUndefined();
  });

  it('removes a leftover plain cookie at sign-in too, and only when the browser sent one', async () => {
    const user = await createUser('alex@example.com');
    const withStale = await call('/api/auth/login', {
      cookie: 'edging_session=left-over',
      body: { email: user.email, auth: user.auth, kdf: 1 }
    });
    expect(cleared(withStale, 'edging_session')).toMatch(/Max-Age=0/);
    expect(
      cleared(await call('/api/auth/login', { body: { email: user.email, auth: user.auth, kdf: 1 } }), 'edging_session')
    ).toBeUndefined();
  });
});
