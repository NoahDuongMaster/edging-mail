import { afterEach, describe, expect, it, vi } from 'vitest';
import { userSecurityEvents } from '../src/worker/db/schema';
import { ACCOUNT_POLICY, claimAttempt } from '../src/worker/auth/throttle';
import { call, createUser, db, totpCode } from './helpers';
import type { TestUser } from './helpers';

// crypto-review.md PB-1: the forgot-password flow must not be lockable for good by anybody who only knows an address.
//   (a) a wrong key: per client address (escalating) and per account with the FIXED account policy;
//   (b) the right key with a missing or wrong code: an escalating per-account budget (`forgot2fa:<id>`) that only a key holder can spend, and
//       when it is locked the answer is exactly that of a wrong key.

afterEach(() => {
  vi.useRealTimers();
});

const WRONG_KEY = 'AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM';
const ip = (n: number): string => `198.51.100.${n}`;
const verify = (user: Pick<TestUser, 'email' | 'recoveryAuth'>, extra: Record<string, unknown>, address: string) =>
  call<{ success?: boolean; ticket?: string; code?: string }>('/api/auth/forgot/verify', {
    body: { email: user.email, recovery_auth: user.recoveryAuth, kdf: 1, ...extra },
    ip: address
  });

describe('a wrong key (PB-1a)', () => {
  it('locks the address for 15 minutes only, and the owner gets in again afterwards', async () => {
    const owner = await createUser('alex@example.com');
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    // a stranger who knows the address, from ten different places
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const wrong = await verify({ ...owner, recoveryAuth: WRONG_KEY }, {}, ip(attempt));
      expect([wrong.status, wrong.json.code], `attempt ${attempt}`).toEqual([401, 'recovery_failed']);
    }
    const locked = await verify({ ...owner, recoveryAuth: WRONG_KEY }, {}, ip(11));
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('Retry-After'))).toBeLessThanOrEqual(15 * 60);
    // the owner, with the right key, is turned away during the lock ...
    expect((await verify(owner, {}, ip(12))).status).toBe(429);
    // ... and let in once the 15 minutes are over
    vi.setSystemTime(start + 15 * 60_000 + 5000);
    const answer = await verify(owner, {}, ip(13));
    expect([answer.status, answer.json.success]).toEqual([200, true]);
  }, 60_000);

  it('never makes the lock longer, however long the stranger keeps at it (100 wrong attempts, every lock 15 minutes)', async () => {
    let now = Date.now();
    let longest = 0;
    let locks = 0;
    for (let attempt = 1; attempt <= 100; attempt += 1) {
      const claim = await claimAttempt(db(), 'forgotacct:ghost@example.com', now, ACCOUNT_POLICY);
      if (!claim.allowed) {
        locks += 1;
        longest = Math.max(longest, claim.retryAfter);
        // the stranger comes back the moment it unlocks
        now += claim.retryAfter * 1000 + 1;
      }
    }
    expect(locks).toBeGreaterThanOrEqual(8);
    expect(longest).toBeLessThanOrEqual(15 * 60);
    expect((await claimAttempt(db(), 'forgotacct:ghost@example.com', now, ACCOUNT_POLICY)).allowed).toBe(true);
  });
});

describe('the right key with a missing or wrong code (PB-1b)', () => {
  it('is an escalating budget of its own: after five failures the owner is locked, and the lock answers exactly like a wrong key', async () => {
    const admin = await createUser('boss@example.com', { role: 'admin' });
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    // three wrong codes and two missing codes, all with the right key
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const extra = attempt <= 3 ? { code: '000000' } : {};
      const refused = await verify(admin, extra, ip(attempt));
      expect([refused.status, refused.json.code], `attempt ${attempt}`).toEqual([401, 'recovery_failed']);
    }
    const events = (await db().select().from(userSecurityEvents)).length;
    const code = await totpCode(admin);
    const lockedAnswer = await verify(admin, { code }, ip(6));
    const wrongKeyAnswer = await verify({ ...admin, recoveryAuth: WRONG_KEY }, { code }, ip(7));
    // right key AND right code, but the budget is spent: the same status and the same body as a wrong key
    expect([lockedAnswer.status, lockedAnswer.json]).toEqual([401, wrongKeyAnswer.json]);
    expect(lockedAnswer.json.ticket).toBeUndefined();
    expect((await db().select().from(userSecurityEvents)).length).toBe(events);

    // after the lock (15 minutes the first time) the right key and the right code work, and the budget is forgotten
    vi.setSystemTime(start + 15 * 60_000 + 5000);
    const answer = await verify(admin, { code: await totpCode(admin) }, ip(8));
    expect([answer.status, answer.json.success]).toEqual([200, true]);
    const again = await verify(admin, {}, ip(9));
    expect(again.status).toBe(401);
  }, 60_000);

  it('does not touch an account without two-step verification, whatever is typed', async () => {
    const plain = await createUser('plain@example.com');
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const answer = await verify(plain, {}, ip(20 + attempt));
      expect([answer.status, answer.json.success], `attempt ${attempt}`).toEqual([200, true]);
    }
  });
});
