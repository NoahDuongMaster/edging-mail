import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { giveBackAttempt } from '../src/worker/auth/throttle';
import { loginAttempts, twoFactorChallenges, users } from '../src/worker/db/schema';
import { authFor, call, createUser, db, must, totpCode } from './helpers';
import type { TestUser } from './helpers';

// crypto-review.md section 22: PX-1 (a right password must not wipe the per-client counter) and PX-6 (the challenge counter is taken before the code
// is looked at).

const IP = '198.51.100.9';
const login = (email: string, auth: string, ip = IP) => call<{ code?: string }>('/api/auth/login', { body: { email, auth, kdf: 1 }, ip });
const wrong = (email: string) => authFor(email, 'not the password at all');
const counter = async (key: string) => (await db().select().from(loginAttempts).where(eq(loginAttempts.key, key)).get())?.failures;

describe('a right password does not make room for guesses (PX-1)', () => {
  it('stops a member who puts one own sign-in after every three guesses at colleagues: the sixth guess is refused, as with no own sign-ins', async () => {
    const mine = await createUser('mallory@example.com');
    const targets = ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com', 'e@example.com', 'f@example.com'];
    const guesses: number[] = [];
    const own: number[] = [];
    for (const [index, target] of targets.entries()) {
      guesses.push((await login(target, await wrong(target))).status);
      if (index % 3 === 2) {
        own.push((await login(mine.email, mine.auth)).status);
      }
    }
    // five guesses are let through (and are wrong), the sixth is refused, the own sign-in in between worked and cost nothing
    expect(guesses).toEqual([401, 401, 401, 401, 401, 429]);
    expect(own[0]).toBe(200);
    // once the client is locked an own sign-in is refused too: the lock is the client's, not the account's
    expect(own[1]).toBe(429);
    // the counter was not cleared by the own sign-in: five guesses stand (the sixth locked it)
    expect(await counter(IP)).toBeGreaterThanOrEqual(5);
  });

  it('forgets the counter of the account that signed in, and gives back only its own attempt on the client counter', async () => {
    const user = await createUser('alex@example.com');
    await db()
      .insert(loginAttempts)
      .values([
        { key: 'acct:alex@example.com', failures: 4, window_start: Date.now(), locked_until: 0, updated_at: Date.now() },
        { key: IP, failures: 3, window_start: Date.now(), locked_until: 0, updated_at: Date.now() }
      ]);
    expect((await login(user.email, user.auth)).status).toBe(200);
    expect(await counter('acct:alex@example.com')).toBeUndefined();
    // 3 guesses before + this request's own count, which is given back: 3 remain
    expect(await counter(IP)).toBe(3);
  });

  it('lets people behind one address sign in as often as they like (their right passwords do not count)', async () => {
    const people = await Promise.all(Array.from({ length: 12 }, (_, index) => createUser(`person${index}@example.com`)));
    const statuses: number[] = [];
    for (const person of people) {
      statuses.push((await login(person.email, person.auth)).status);
    }
    expect(statuses).toEqual(people.map(() => 200));
    expect(await counter(IP)).toBe(0);
  });

  it('counts a disabled account that proved its password like any attempt: nothing is cleared and nothing is given back', async () => {
    const gone = await createUser('gone@example.com', { status: 'disabled' });
    await db()
      .insert(loginAttempts)
      .values([
        { key: 'acct:gone@example.com', failures: 4, window_start: Date.now(), locked_until: 0, updated_at: Date.now() },
        { key: IP, failures: 2, window_start: Date.now(), locked_until: 0, updated_at: Date.now() }
      ]);
    expect((await login(gone.email, gone.auth)).json.code).toBe('account_disabled');
    expect(await counter('acct:gone@example.com')).toBe(5);
    expect(await counter(IP)).toBe(3);
  });

  it('gives back one attempt at most, never below zero, and leaves a lock that has begun alone', async () => {
    const now = Date.now();
    await db()
      .insert(loginAttempts)
      .values([
        { key: 'open', failures: 1, window_start: now, locked_until: 0, updated_at: now },
        { key: 'locked', failures: 6, window_start: now, locked_until: now + 600_000, updated_at: now }
      ]);
    await giveBackAttempt(db(), 'open');
    await giveBackAttempt(db(), 'open');
    await giveBackAttempt(db(), 'locked');
    await giveBackAttempt(db(), 'absent');
    expect([await counter('open'), await counter('locked'), await counter('absent')]).toEqual([0, 6, undefined]);
  });
});

const challengeOf = async (user: TestUser): Promise<string> =>
  must((await call<{ challenge?: string }>('/api/auth/login', { body: { email: user.email, auth: user.auth, kdf: 1 } })).json.challenge);
const badCode = async (user: TestUser): Promise<string> => {
  const valid = await Promise.all([-1, 0, 1].map((ahead) => totpCode(user, ahead)));
  return must(['000000', '111111', '222222', '333333'].find((code) => !valid.includes(code)));
};
const attemptsOf = async (challenge: string): Promise<number | undefined> => {
  const jti = JSON.parse(atob(challenge.split('.', 1)[0]?.replaceAll('-', '+').replaceAll('_', '/') ?? '')) as { jti: string };
  return (await db().select().from(twoFactorChallenges).where(eq(twoFactorChallenges.jti, jti.jti)).get())?.attempts;
};

describe('the challenge counter is taken before the code is looked at (PX-6)', () => {
  it('evaluates exactly five of thirty parallel wrong codes, and the others find the challenge spent', async () => {
    const user = await createUser('boss@example.com', { role: 'admin' });
    const challenge = await challengeOf(user);
    const code = await badCode(user);
    const answers = await Promise.all(
      Array.from({ length: 30 }, () => call<{ code?: string }>('/api/auth/login/2fa', { body: { challenge, code } }))
    );
    const codes = answers.map((answer) => answer.json.code);
    expect(codes.filter((entry) => entry === 'wrong_code')).toHaveLength(5);
    expect(codes.filter((entry) => entry === 'challenge_invalid')).toHaveLength(25);
    expect(await attemptsOf(challenge)).toBe(5);
    // the right code no longer helps: the challenge is burned
    await db().update(users).set({ totp_last_step: 0 }).where(eq(users.id, user.id));
    const late = await call<{ code?: string }>('/api/auth/login/2fa', { body: { challenge, code: await totpCode(user) } });
    expect([late.status, late.json.code]).toEqual([401, 'challenge_invalid']);
  });

  it('still lets the fifth try be the right one', async () => {
    const user = await createUser('boss@example.com', { role: 'admin' });
    const challenge = await challengeOf(user);
    const code = await badCode(user);
    for (let index = 0; index < 4; index += 1) {
      expect((await call('/api/auth/login/2fa', { body: { challenge, code } })).status).toBe(401);
    }
    await db().update(users).set({ totp_last_step: 0 }).where(eq(users.id, user.id));
    expect((await call('/api/auth/login/2fa', { body: { challenge, code: await totpCode(user) } })).status).toBe(200);
  });

  it('gives the try back when the code was never looked at (the account is locked): the challenge keeps its five', async () => {
    const user = await createUser('boss@example.com', { role: 'admin' });
    const challenge = await challengeOf(user);
    const now = Date.now();
    await db()
      .insert(loginAttempts)
      .values({ key: `2fa:${user.id}`, failures: 11, window_start: now, locked_until: now + 600_000, updated_at: now });
    const refused = await call<{ code?: string }>('/api/auth/login/2fa', { body: { challenge, code: await totpCode(user) } });
    expect([refused.status, refused.json.code]).toEqual([429, 'too_many_attempts']);
    expect(await attemptsOf(challenge)).toBe(0);
  });
});
