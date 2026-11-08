import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditLog, users } from '../src/worker/db/schema';
import { userById } from '../src/worker/auth/accounts';
import { applyReissue } from '../src/worker/admin/reissue';
import { authFor, call, createUser, db, fakeWrap, must, setupKeys, signIn, totpCode } from './helpers';
import type { TestUser } from './helpers';

// crypto-review.md PB-2 (a sign-in challenge older than the last revocation of the person's sessions is dead) and PB-3 (the tests that were missing).

afterEach(() => {
  vi.useRealTimers();
});

const challengeOf = async (user: TestUser): Promise<string> => {
  const answer = await call<{ challenge: string }>('/api/auth/login', { body: { email: user.email, auth: user.auth, kdf: 1 } });
  return answer.json.challenge;
};
const second = async (challenge: string, user: TestUser) => {
  await db().update(users).set({ totp_last_step: 0 }).where(eq(users.id, user.id));
  return call<{ code?: string }>('/api/auth/login/2fa', { body: { challenge, code: await totpCode(user) } });
};
const pause = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
const expectDead = async (challenge: string, user: TestUser) => {
  const answer = await second(challenge, user);
  expect([answer.status, answer.json.code]).toEqual([401, 'challenge_invalid']);
};

describe('login/2fa refuses a challenge made before the sessions were last revoked (PB-2)', () => {
  it('whatever revoked them, and without relying on any flow to delete the challenge', async () => {
    const user = await createUser('boss@example.com', { role: 'admin' });
    const old = await challengeOf(user);
    await pause(5);
    // revoked by something that deletes nothing: only the check can stop the old challenge
    await db().update(users).set({ sessions_valid_after: Date.now() }).where(eq(users.id, user.id));
    await expectDead(old, user);
    // a challenge made after the revocation works
    await pause(5);
    const fresh = await second(await challengeOf(user), user);
    expect(fresh.status).toBe(200);
  });
});

describe('an open challenge dies with every flow that ends the sessions (PB-3a)', () => {
  it('break-glass', async () => {
    const admin = await createUser('boss@example.com', { role: 'admin' });
    const challenge = await challengeOf(admin);
    const recovered = await call('/api/auth/recover', {
      body: {
        setup_key: env.APP_PASSWORD,
        email: admin.email,
        new_auth: await authFor(admin.email, 'a different long password'),
        kdf: 1,
        keys: await setupKeys(admin.email)
      }
    });
    expect(recovered.status).toBe(200);
    await expectDead(challenge, admin);
  });

  it('forgot password (complete)', async () => {
    const user = await createUser('alex@example.com', { totp: true });
    const challenge = await challengeOf(user);
    const verified = await call<{ ticket: string }>('/api/auth/forgot/verify', {
      body: { email: user.email, recovery_auth: user.recoveryAuth, kdf: 1, code: await totpCode(user) }
    });
    expect(verified.status).toBe(200);
    const keys = await setupKeys(user.email);
    const completed = await call('/api/auth/forgot/complete', {
      body: {
        ticket: verified.json.ticket,
        kdf: 1,
        new_auth: await authFor(user.email, 'another long password'),
        wrapped_private_key_pw: keys.wrapped_private_key_pw,
        wrapped_private_key_recovery: keys.wrapped_private_key_recovery,
        recovery_auth: keys.recovery_auth
      }
    });
    expect(completed.status).toBe(200);
    await expectDead(challenge, user);
  });

  it('a reissued temporary password', async () => {
    const admin = await createUser('boss@example.com', { role: 'admin' });
    const target = await createUser('new@example.com', { mustChange: true, keys: false, totp: true });
    const challenge = await challengeOf(target);
    const reissued = await call(`/api/admin/users/${target.id}/reissue`, {
      cookie: await signIn(admin),
      body: { auth: await authFor(target.email, 'a second temporary password'), kdf: 1 }
    });
    expect(reissued.status).toBe(200);
    await expectDead(challenge, target);
  });

  it('a reset of two-step verification', async () => {
    const admin = await createUser('boss@example.com', { role: 'admin' });
    const member = await createUser('alex@example.com', { totp: true });
    const challenge = await challengeOf(member);
    const reset = await call(`/api/admin/users/${member.id}/reset-2fa`, { cookie: await signIn(admin), body: {} });
    expect(reset.status).toBe(200);
    await expectDead(challenge, member);
  });

  it('a password change', async () => {
    const user = await createUser('alex@example.com', { totp: true });
    const cookie = await signIn(user);
    const challenge = await challengeOf(user);
    const changed = await call('/api/auth/change-password', {
      cookie,
      body: {
        current_auth: user.auth,
        new_auth: await authFor(user.email, 'another long password'),
        kdf: 1,
        keys: { wrapped_private_key_pw: fakeWrap() },
        keys_version: 1
      }
    });
    expect(changed.status).toBe(200);
    await expectDead(challenge, user);
  });
});

describe('the compare-and-set of a reissue, from a snapshot taken before the person signed in (PB-3b)', () => {
  it('changes nothing when the person chose their own password in the meantime, or was disabled', async () => {
    const admin = await createUser('boss@example.com', { role: 'admin' });
    const by = { id: admin.id, email: admin.email };
    const target = await createUser('new@example.com', { mustChange: true, keys: false });
    const stale = must(await userById(db(), target.id));
    // the person completes their first sign-in after the snapshot was read
    await db().update(users).set({ must_change_password: 0 }).where(eq(users.id, target.id));
    expect(await applyReissue(db(), stale, by, await authFor(target.email, 'a second temporary password'), Date.now())).toBe(false);
    const after = must(await userById(db(), target.id));
    expect([after.auth_verifier, after.auth_salt, after.sessions_valid_after]).toEqual([
      stale.auth_verifier,
      stale.auth_salt,
      stale.sessions_valid_after
    ]);
    const actions = (await db().select().from(auditLog)).map((row) => row.action);
    expect(actions).not.toContain('temp_password_reissued');

    // the same for a person who was disabled after the snapshot
    const other = await createUser('other@example.com', { mustChange: true, keys: false });
    const staleOther = must(await userById(db(), other.id));
    await db().update(users).set({ status: 'disabled' }).where(eq(users.id, other.id));
    expect(await applyReissue(db(), staleOther, by, await authFor(other.email, 'a second temporary password'), Date.now())).toBe(false);

    // and the same call with a current row does apply, so the guard is not simply always false
    const third = await createUser('third@example.com', { mustChange: true, keys: false });
    const current = must(await userById(db(), third.id));
    expect(await applyReissue(db(), current, by, await authFor(third.email, 'a second temporary password'), Date.now())).toBe(true);
  });
});

describe('key-material endpoints keep their step-up (PB-3c)', () => {
  it('POST /api/keys/recovery with two-step verification and no recent step-up answers step_up_required', async () => {
    const user = await createUser('alex@example.com', { totp: true });
    const cookie = await signIn(user);
    const fresh = await setupKeys(user.email);
    const body = {
      current_auth: user.auth,
      wrapped_private_key_recovery: fresh.wrapped_private_key_recovery,
      recovery_auth: fresh.recovery_auth,
      keys_version: 1
    };
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 6 * 60_000);
    const refused = await call<{ code?: string }>('/api/keys/recovery', { cookie, body });
    expect([refused.status, refused.json.code]).toEqual([403, 'step_up_required']);
  });
});

describe('cancelling a pending reset (PB-3d)', () => {
  it('cancelling my own leaves another admin\u2019s pending reset alone', async () => {
    const alice = await createUser('alice@example.com', { role: 'admin' });
    const bob = await createUser('bob@example.com', { role: 'admin' });
    const due = Date.now() + 3_600_000;
    await db().update(users).set({ reset_2fa_due_at: due, reset_2fa_by: 'carol@example.com' }).where(eq(users.id, alice.id));
    await db().update(users).set({ reset_2fa_due_at: due, reset_2fa_by: 'carol@example.com' }).where(eq(users.id, bob.id));
    const cancelled = await call('/api/auth/2fa/cancel-reset', { cookie: await signIn(alice), body: {} });
    expect(cancelled.status).toBe(200);
    const mine = must(await userById(db(), alice.id));
    const theirs = must(await userById(db(), bob.id));
    expect([mine.reset_2fa_due_at, mine.reset_2fa_by]).toEqual([null, null]);
    expect([theirs.reset_2fa_due_at, theirs.reset_2fa_by]).toEqual([due, 'carol@example.com']);
  });
});
