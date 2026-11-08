import { afterEach, describe, expect, it, vi } from 'vitest';
import { authFor, call, cookieOf, createUser, fakeWrap, signIn, totpCode } from './helpers';
import type { TestUser } from './helpers';

// crypto-review.md CK-17: a sign-in from a shared or public device ends the key AND the session. `shared: true` makes the cookie a browser-session
// cookie (no Max-Age) and the server ends the session after twelve hours, whatever the browser does; renewing the session keeps that.

afterEach(() => {
  vi.useRealTimers();
});

const HOUR = 3_600_000;
const login = (user: TestUser, extra: Record<string, unknown> = {}) =>
  call<{ challenge?: string; code?: string }>('/api/auth/login', { body: { email: user.email, auth: user.auth, kdf: 1, ...extra } });
const cookieHeader = (answer: { headers: Headers }): string => answer.headers.get('Set-Cookie') ?? '';
const works = async (cookie: string): Promise<boolean> => (await call('/api/stats', { cookie })).status === 200;

describe('a sign-in from a shared device (CK-17)', () => {
  it('sets a session cookie without Max-Age and ends the session after twelve hours; a normal sign-in keeps its fourteen days', async () => {
    const user = await createUser('alex@example.com');
    const normal = await login(user);
    expect(cookieHeader(normal)).toContain('Max-Age=1209600');
    const shared = await login(user, { shared: true });
    expect(cookieHeader(shared)).toContain('edging_session=');
    expect(cookieHeader(shared)).not.toMatch(/Max-Age|Expires/i);
    const sharedCookie = cookieOf(shared);
    const normalCookie = cookieOf(normal);
    expect(await works(sharedCookie)).toBe(true);

    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    vi.setSystemTime(start + 11 * HOUR);
    expect(await works(sharedCookie)).toBe(true);
    vi.setSystemTime(start + 13 * HOUR);
    expect(await works(sharedCookie)).toBe(false);
    // the other cookie is a different thing: still good
    expect(await works(normalCookie)).toBe(true);
  });

  it('carries the flag through the second step of a sign-in with two-step verification', async () => {
    const admin = await createUser('boss@example.com', { role: 'admin' });
    const first = await login(admin, { shared: true });
    expect(first.json.challenge).toBeTypeOf('string');
    expect(cookieHeader(first)).toBe('');
    const answer = await call('/api/auth/login/2fa', { body: { challenge: first.json.challenge, code: await totpCode(admin) } });
    expect(answer.status).toBe(200);
    expect(cookieHeader(answer)).not.toMatch(/Max-Age|Expires/i);
    const cookie = cookieOf(answer);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 13 * HOUR);
    expect(await works(cookie)).toBe(false);
  });

  it('is kept when the session is renewed by a password change, and a normal session stays normal', async () => {
    const user = await createUser('alex@example.com');
    const shared = cookieOf(await login(user, { shared: true }));
    const change = (cookie: string, password: string) =>
      authFor(user.email, password).then((newAuth) =>
        call('/api/auth/change-password', {
          cookie,
          body: { current_auth: user.auth, new_auth: newAuth, kdf: 1, keys: { wrapped_private_key_pw: fakeWrap() }, keys_version: 1 }
        })
      );
    const renewed = await change(shared, 'another long password');
    expect(renewed.status).toBe(200);
    expect(cookieHeader(renewed)).not.toMatch(/Max-Age|Expires/i);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 13 * HOUR);
    expect(await works(cookieOf(renewed))).toBe(false);
    vi.useRealTimers();

    const other = await createUser('other@example.com');
    const normal = await signIn(other);
    const again = await call('/api/auth/change-password', {
      cookie: normal,
      body: {
        current_auth: other.auth,
        new_auth: await authFor(other.email, 'another long password'),
        kdf: 1,
        keys: { wrapped_private_key_pw: fakeWrap() },
        keys_version: 1
      }
    });
    expect(cookieHeader(again)).toContain('Max-Age=1209600');
  });

  it('says on the session answer whether the session is a shared-device one, also after a renewal and after a second step (C-5b)', async () => {
    const user = await createUser('alex@example.com');
    const session = async (cookie?: string) =>
      (await call<{ authenticated: boolean; shared?: boolean }>('/api/auth/session', cookie === undefined ? {} : { cookie })).json;
    const sharedCookie = cookieOf(await login(user, { shared: true }));
    const normalCookie = cookieOf(await login(user, { shared: false }));
    expect(await session(sharedCookie)).toMatchObject({ authenticated: true, shared: true });
    expect(await session(normalCookie)).toMatchObject({ authenticated: true, shared: false });
    // nobody is signed in: no such field
    const signedOut = await session();
    expect(signedOut.authenticated).toBe(false);
    expect('shared' in signedOut).toBe(false);

    // a password change renews the session in the same answer, and the renewal inherits the mark (either way)
    const change = async (person: TestUser, cookie: string) =>
      call('/api/auth/change-password', {
        cookie,
        body: {
          current_auth: person.auth,
          new_auth: await authFor(person.email, 'another long password'),
          kdf: 1,
          keys: { wrapped_private_key_pw: fakeWrap() },
          keys_version: 1
        }
      });
    const renewedShared = await change(user, sharedCookie);
    expect(renewedShared.status).toBe(200);
    expect(await session(cookieOf(renewedShared))).toMatchObject({ authenticated: true, shared: true });
    const other = await createUser('other@example.com');
    const renewedNormal = await change(other, await signIn(other));
    expect(await session(cookieOf(renewedNormal))).toMatchObject({ authenticated: true, shared: false });

    // the second step of a sign-in with two-step verification carries the mark too
    const admin = await createUser('boss@example.com', { role: 'admin' });
    const first = await login(admin, { shared: true });
    const second = await call('/api/auth/login/2fa', { body: { challenge: first.json.challenge, code: await totpCode(admin) } });
    expect(await session(cookieOf(second))).toMatchObject({ authenticated: true, shared: true });
  });

  it('refuses a shared flag that is not a boolean, and a sign-in without it is not shared', async () => {
    const user = await createUser('alex@example.com');
    const refused = await login(user, { shared: 'yes' });
    expect([refused.status, refused.json.code]).toEqual([400, 'invalid_request']);
    expect(cookieHeader(await login(user, { shared: false }))).toContain('Max-Age=1209600');
  });
});
