import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { auditLog, recoveryCodes, recoveryTickets, userSecurityEvents, userSignIns, users } from '../src/worker/db/schema';
import { WRONG_CREDENTIAL_DELAY_MS } from '../src/worker/auth/throttle';
import {
  authFor,
  call,
  createUser,
  db,
  decryptPush,
  enrollTotp,
  fakePushService,
  fakeWrap,
  setupKeys,
  signIn,
  subscribeDevice,
  totpCode,
  userRow,
  waitUntil
} from './helpers';
import type { TestUser } from './helpers';

// Forgot password (crypto-design.md 15.3, crypto-review.md FG-1..FG-11): verify (no state change), then complete (one guarded batch).

afterEach(() => {
  vi.restoreAllMocks();
});

const verifyBody = (user: Pick<TestUser, 'email' | 'recoveryAuth'>, extra: Record<string, unknown> = {}) => ({
  email: user.email,
  recovery_auth: user.recoveryAuth,
  kdf: 1,
  ...extra
});
const verify = (body: Record<string, unknown>, ip?: string) => call<{ ticket: string }>('/api/auth/forgot/verify', { body, ip });

interface Fresh {
  new_auth: string;
  wrapped_private_key_pw: string;
  wrapped_private_key_recovery: string;
  recovery_auth: string;
}
async function freshMaterial(user: TestUser, password = 'a brand new password!'): Promise<Fresh> {
  const keys = await setupKeys(user.email);
  return {
    new_auth: await authFor(user.email, password),
    wrapped_private_key_pw: keys.wrapped_private_key_pw,
    wrapped_private_key_recovery: keys.wrapped_private_key_recovery,
    recovery_auth: keys.recovery_auth
  };
}
const complete = async (ticket: string, material: Fresh, extra: Record<string, unknown> = {}, ip?: string) =>
  call('/api/auth/forgot/complete', { body: { ticket, kdf: 1, ...material, ...extra }, ip });
const kinds = async (): Promise<string[]> => (await db().select().from(userSecurityEvents)).map((row) => row.kind);

describe('verify: the recovery key (and the code) prove possession, and nothing changes', () => {
  it('hands out a ticket, the wraps and the rules, stores only an HMAC of it, and notifies the person at once', async () => {
    const user = await createUser('alex@example.com');
    const before = await userRow(user.id);
    const answer = await verify(verifyBody(user));
    expect(answer.status).toBe(200);
    expect(answer.headers.get('Set-Cookie')).toBeNull();
    expect(answer.json).toMatchObject({
      success: true,
      public_key: before.public_key,
      key_id: before.key_id,
      keys_version: before.keys_version,
      wrapped_private_key_recovery: before.wrapped_private_key_recovery,
      min_password_length: 12
    });
    expect(answer.json.ticket).toMatch(/^[\w-]{43}$/);
    const [stored] = await db().select().from(recoveryTickets);
    expect(stored).toMatchObject({ user_id: user.id, key_id: before.key_id, keys_version: before.keys_version, used_at: null });
    expect(JSON.stringify(stored)).not.toContain(answer.json.ticket);
    expect(stored.exp - stored.created_at).toBe(10 * 60_000);
    // no state change: the account is as it was, and the person sees the attempt (event, history, audit)
    expect(await userRow(user.id)).toEqual(before);
    expect(await kinds()).toEqual(['recovery_started']);
    expect((await db().select().from(userSignIns)).map((row) => row.kind)).toEqual(['recovery_started']);
    expect((await db().select().from(auditLog)).map((row) => row.action)).toContain('recovery_started');
    const [event] = await db().select().from(userSecurityEvents);
    expect(event.dismissible_after - event.at).toBe(7 * 24 * 60 * 60_000);
  });

  it('asks an admin for 16 characters, and accepts the address in any letter case', async () => {
    const admin = await createUser('boss@example.com', { role: 'admin' });
    const answer = await verify(verifyBody({ ...admin, email: 'Boss@Example.COM' }, { code: await totpCode(admin) }));
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({ min_password_length: 16 });
  });

  it('gives ONE generic answer, after one fixed delay, for every kind of failure', async () => {
    const plain = await createUser('plain@example.com');
    const guarded = await createUser('guarded@example.com', { totp: true });
    const keyless = await createUser('keyless@example.com', { keys: false });
    const aliased = await createUser('owner@example.com', { aliases: ['sales@example.com'] });
    const wrongKey = { ...verifyBody(plain), recovery_auth: guarded.recoveryAuth };
    const cases: [string, Record<string, unknown>][] = [
      ['an unknown address', verifyBody({ email: 'nobody@example.com', recoveryAuth: plain.recoveryAuth })],
      ['a wrong key', wrongKey],
      ['a right key with 2FA enrolled and no code', verifyBody(guarded)],
      ['a right key with a wrong code', verifyBody(guarded, { code: '000000' })],
      ['an account that has no keys', verifyBody({ email: keyless.email, recoveryAuth: plain.recoveryAuth })],
      ['an alias instead of the primary address', verifyBody({ email: 'sales@example.com', recoveryAuth: aliased.recoveryAuth })]
    ];
    const answers: string[] = [];
    for (const [name, body] of cases) {
      const started = Date.now();
      const answer = await verify(body, `198.51.100.${answers.length + 10}`);
      expect(answer.status, name).toBe(401);
      expect(Date.now() - started, name).toBeGreaterThanOrEqual(WRONG_CREDENTIAL_DELAY_MS - 20);
      expect(Date.now() - started, name).toBeLessThan(WRONG_CREDENTIAL_DELAY_MS + 900);
      answers.push(answer.text);
    }
    // and when the right key AND the right code meet a spent second-factor budget (PB-1b): the two failures above plus three more make five
    for (const extra of [0, 1, 2]) {
      await verify(verifyBody(guarded, { code: '000000' }), `198.51.100.${40 + extra}`);
    }
    const spentAt = Date.now();
    const spent = await verify(verifyBody(guarded, { code: await totpCode(guarded) }), '198.51.100.50');
    expect(spent.status, 'a right key and a right code with the budget spent').toBe(401);
    expect(Date.now() - spentAt).toBeGreaterThanOrEqual(WRONG_CREDENTIAL_DELAY_MS - 20);
    expect(Date.now() - spentAt).toBeLessThan(WRONG_CREDENTIAL_DELAY_MS + 900);
    answers.push(spent.text);
    expect(new Set(answers).size).toBe(1);
    // addendum 4.13: one generic answer for every failure; only the text names what may be missing, so it does not say which part was wrong
    expect(JSON.parse(answers[0])).toEqual({
      success: false,
      error:
        'The recovery key or the authenticator code is not correct. If you use two-factor sign-in, enter the code from your authenticator app too.',
      code: 'recovery_failed'
    });
    expect(await db().select().from(recoveryTickets)).toHaveLength(0);
    expect(await kinds()).toEqual([]);
  }, 60_000);

  it('answers a disabled account with its own message only after a right key (and code)', async () => {
    const off = await createUser('off@example.com', { status: 'disabled' });
    expect((await verify({ ...verifyBody(off), recovery_auth: 'A'.repeat(43) })).status).toBe(401);
    const answer = await verify(verifyBody(off));
    expect([answer.status, answer.json]).toEqual([403, expect.objectContaining({ code: 'account_disabled' })]);
    expect(await db().select().from(recoveryTickets)).toHaveLength(0);
    const guarded = await createUser('guarded@example.com', { totp: true, status: 'disabled' });
    expect((await verify(verifyBody(guarded))).status).toBe(401);
  });

  it('validates strictly: unknown fields, a bad kdf, a non-canonical recovery_auth and a malformed code are refused', async () => {
    const user = await createUser('alex@example.com');
    for (const body of [
      { ...verifyBody(user), extra: 1 },
      { ...verifyBody(user), kdf: 2 },
      { ...verifyBody(user), recovery_auth: `${user.recoveryAuth ?? ''}=` },
      { ...verifyBody(user), recovery_auth: 'short' },
      { ...verifyBody(user), code: '12ab56' },
      { ...verifyBody(user), code: '123456', recovery_code: 'AAAA-AAAA-AAAA' },
      { email: user.email, kdf: 1 }
    ]) {
      expect((await verify(body)).status, JSON.stringify(Object.keys(body))).toBe(400);
    }
  });

  it('is off (503) without a usable DATA_KEY: the ticket is sealed under it', async () => {
    const user = await createUser('alex@example.com');
    const answer = await call('/api/auth/forgot/verify', { body: verifyBody(user), env: { DATA_KEY: undefined } });
    expect([answer.status, answer.json]).toEqual([503, { success: false, error: 'Server is not configured', code: 'not_configured' }]);
  });

  it('replaces an older ticket: one open ticket per user', async () => {
    const user = await createUser('alex@example.com');
    const first = (await verify(verifyBody(user))).json.ticket;
    const second = (await verify(verifyBody(user))).json.ticket;
    expect(await db().select().from(recoveryTickets)).toHaveLength(1);
    const material = await freshMaterial(user);
    expect((await complete(first, material)).status).toBe(401);
    expect((await complete(second, material)).status).toBe(200);
  });
});

describe('verify: the second factor is used only when the key is right too (FG-1)', () => {
  it('uses a code once, only on overall success', async () => {
    const user = await createUser('alex@example.com', { totp: true });
    const code = await totpCode(user);
    // a wrong key with a RIGHT code: refused, and the time step is not burned
    const wrongKey = await verify({ ...verifyBody(user), recovery_auth: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI', code });
    expect(wrongKey.status).toBe(401);
    expect((await userRow(user.id)).totp_last_step).toBe(0);
    // the quick retry with the right key works...
    const ok = await verify(verifyBody(user, { code }));
    expect(ok.status).toBe(200);
    expect((await userRow(user.id)).totp_last_step).toBeGreaterThan(0);
    // ...and the same code never works twice
    expect((await verify(verifyBody(user, { code }))).status).toBe(401);
  });

  it('uses a 2FA recovery code once, only on overall success', async () => {
    const user = await createUser('alex@example.com', { totp: false });
    const { recoveryCodes: codes } = await enrollTotp(await signIn(user), user);
    const wrongKey = await verify({
      ...verifyBody(user),
      recovery_auth: 'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI',
      recovery_code: codes[0]
    });
    expect(wrongKey.status).toBe(401);
    expect((await db().select().from(recoveryCodes)).filter((row) => row.used_at !== null)).toHaveLength(0);
    expect((await verify(verifyBody(user, { recovery_code: codes[0] }))).status).toBe(200);
    expect((await db().select().from(recoveryCodes)).filter((row) => row.used_at !== null)).toHaveLength(1);
    expect((await verify(verifyBody(user, { recovery_code: codes[0] }))).status).toBe(401);
  });

  it('lets two parallel verifies with ONE code produce only one ticket', async () => {
    const user = await createUser('alex@example.com', { totp: true });
    const code = await totpCode(user);
    const answers = await Promise.all([verify(verifyBody(user, { code })), verify(verifyBody(user, { code }))]);
    expect(answers.map((answer) => answer.status).toSorted((a, b) => a - b)).toEqual([200, 401]);
    expect(await db().select().from(recoveryTickets)).toHaveLength(1);
  });
});

describe('verify: throttled in its own key spaces, with an escalating lock (FG-2)', () => {
  it('locks after five wrong keys per client and ten per account, for known and unknown addresses alike, without touching sign-in', async () => {
    const user = await createUser('alex@example.com');
    const wrong = { ...verifyBody(user), recovery_auth: 'AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM' };
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      expect((await verify(wrong, '198.51.100.50')).status, `attempt ${attempt}`).toBe(401);
    }
    const started = Date.now();
    const locked = await verify(verifyBody(user), '198.51.100.50');
    expect(locked.status).toBe(429);
    expect(Number(locked.headers.get('Retry-After'))).toBeGreaterThan(0);
    // refused before any key derivation: no failure delay, no work
    expect(Date.now() - started).toBeLessThan(WRONG_CREDENTIAL_DELAY_MS);
    // another client with the right key still gets in: the per-account counter is the FIXED one (ten attempts, then 15 minutes), so it cannot be
    // used to keep the owner out (PB-1); an unknown address is counted like a known one and locks at the same attempt, so the lock tells nothing
    const ghost = { email: 'ghost@example.com', recovery_auth: 'BAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQ', kdf: 1 };
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      expect((await verify(ghost, `198.51.100.${60 + attempt}`)).status, `ghost attempt ${attempt}`).toBe(401);
    }
    const ghostLocked = await verify(ghost, '198.51.100.99');
    expect(ghostLocked.status).toBe(429);
    expect(Number(ghostLocked.headers.get('Retry-After'))).toBeLessThanOrEqual(15 * 60);
    expect((await verify(verifyBody(user), '198.51.100.51')).status).toBe(200);
    // signing in is a different key space: it still works
    expect((await call('/api/auth/login', { body: { email: user.email, auth: user.auth, kdf: 1 }, ip: '198.51.100.50' })).status).toBe(200);
  }, 60_000);
});

describe('complete: one guarded batch, sessions revoked, no sign-in', () => {
  it('swaps the password, both wraps and both verifiers, revokes every session, and rotates the recovery key', async () => {
    const user = await createUser('alex@example.com');
    const cookie = await signIn(user);
    const before = await userRow(user.id);
    const ticket = (await verify(verifyBody(user))).json.ticket;
    const material = await freshMaterial(user);
    const done = await complete(ticket, material);
    expect(done.status).toBe(200);
    expect(done.headers.get('Set-Cookie')).toBeNull();
    expect(done.json).toEqual({ success: true });
    const after = await userRow(user.id);
    expect(after).toMatchObject({
      wrapped_private_key_pw: material.wrapped_private_key_pw,
      wrapped_private_key_recovery: material.wrapped_private_key_recovery,
      keys_version: before.keys_version + 1,
      key_id: before.key_id,
      public_key: before.public_key,
      must_change_password: 0
    });
    expect(after.auth_verifier).not.toBe(before.auth_verifier);
    expect(after.recovery_verifier).not.toBe(before.recovery_verifier);
    expect(after.sessions_valid_after).toBeGreaterThan(0);
    expect((await call('/api/stats', { cookie })).status).toBe(401);
    // the new password signs in, the old one does not; the new recovery key works, the old one is dead
    expect((await call('/api/auth/login', { body: { email: user.email, auth: material.new_auth, kdf: 1 } })).status).toBe(200);
    expect((await call('/api/auth/login', { body: { email: user.email, auth: user.auth, kdf: 1 } })).status).toBe(401);
    expect((await verify(verifyBody(user), '198.51.100.70')).status).toBe(401);
    expect((await verify({ email: user.email, recovery_auth: material.recovery_auth, kdf: 1 }, '198.51.100.71')).status).toBe(200);
    expect((await db().select().from(auditLog)).map((row) => row.action)).toContain('password_recovered');
    expect(await kinds()).toEqual(expect.arrayContaining(['recovery_started', 'password_recovered']));
    expect((await db().select().from(userSignIns)).map((row) => row.kind)).toEqual(expect.arrayContaining(['password_recovered']));
  });

  it('works once: the ticket is consumed, a replay is refused', async () => {
    const user = await createUser('alex@example.com');
    const ticket = (await verify(verifyBody(user))).json.ticket;
    expect((await complete(ticket, await freshMaterial(user))).status).toBe(200);
    const replay = await complete(ticket, await freshMaterial(user, 'another new password'));
    expect([replay.status, replay.json]).toEqual([401, expect.objectContaining({ code: 'ticket_invalid' })]);
    expect((await userRow(user.id)).wrapped_private_key_pw).not.toBe((await freshMaterial(user)).wrapped_private_key_pw);
  });

  it('refuses an expired, a foreign, a malformed and a stale ticket; the state of the account never changes by them', async () => {
    const user = await createUser('alex@example.com');
    const other = await createUser('blake@example.com');
    const before = await userRow(user.id);
    const material = await freshMaterial(user);
    const ticket = (await verify(verifyBody(user))).json.ticket;
    const foreignTicket = (await verify(verifyBody(other))).json.ticket;
    for (const [name, value, status] of [
      ['a random ticket', 'A'.repeat(43), 401],
      ['a malformed ticket', 'not a ticket', 400],
      ['a ticket with a trailing character', `${ticket}x`, 400]
    ] as const) {
      expect((await complete(value, material)).status, name).toBe(status);
    }
    // another person's ticket completes THAT person's reset, never this account's: the account of the ticket is the one that changes
    await db()
      .update(recoveryTickets)
      .set({ exp: Date.now() - 1 });
    expect((await complete(ticket, material)).status).toBe(401);
    expect((await complete(foreignTicket, material)).status).toBe(401);
    expect(await userRow(user.id)).toEqual(before);
    // a ticket whose key state moved on (a password change in another tab, a new recovery key) is stale
    const fresh = (await verify(verifyBody(user), '198.51.100.80')).json.ticket;
    await db()
      .update(users)
      .set({ keys_version: before.keys_version + 1 })
      .where(eq(users.id, user.id));
    const stale = await complete(fresh, material);
    expect([stale.status, stale.json]).toEqual([409, expect.objectContaining({ code: 'recovery_stale' })]);
  });

  it('is killed by a password change or a new recovery key made after verify (the ticket dies with its key version)', async () => {
    const user = await createUser('alex@example.com');
    const cookie = await signIn(user);
    const ticket = (await verify(verifyBody(user))).json.ticket;
    const material = await freshMaterial(user);
    const changed = await call('/api/auth/change-password', {
      cookie,
      body: {
        current_auth: user.auth,
        new_auth: await authFor(user.email, 'changed meanwhile!'),
        kdf: 1,
        keys: { wrapped_private_key_pw: fakeWrap() },
        keys_version: 1
      }
    });
    expect(changed.status).toBe(200);
    expect((await complete(ticket, material)).status).toBe(401);
  });

  it('lets only one of two parallel completes win, and the loser changes nothing', async () => {
    const user = await createUser('alex@example.com');
    const ticket = (await verify(verifyBody(user))).json.ticket;
    const one = await freshMaterial(user, 'first new password');
    const two = await freshMaterial(user, 'second new password');
    const answers = await Promise.all([complete(ticket, one), complete(ticket, two)]);
    for (const loser of answers.filter((answer) => answer.status !== 200)) {
      expect([401, 409]).toContain(loser.status);
    }
    expect(answers.filter((answer) => answer.status === 200)).toHaveLength(1);
    const after = await userRow(user.id);
    const winner = answers[0].status === 200 ? one : two;
    expect(after.wrapped_private_key_pw).toBe(winner.wrapped_private_key_pw);
    expect(after.keys_version).toBe(2);
  });

  it('does not require the new password to differ from the old one (that rule would make it an oracle)', async () => {
    const user = await createUser('alex@example.com');
    const ticket = (await verify(verifyBody(user))).json.ticket;
    expect((await complete(ticket, { ...(await freshMaterial(user)), new_auth: user.auth })).status).toBe(200);
  });

  it('validates strictly and clears a temporary password; a disabled account is refused', async () => {
    const user = await createUser('alex@example.com');
    await db()
      .update(users)
      .set({ must_change_password: 1, temp_password_expires_at: Date.now() + 60_000 })
      .where(eq(users.id, user.id));
    const ticket = (await verify(verifyBody(user))).json.ticket;
    const material = await freshMaterial(user);
    for (const extra of [{ extra: 1 }, { kdf: 2 }, { wrapped_private_key_pw: 'AQID' }, { recovery_auth: 'AAAA' }, { new_auth: 'short' }]) {
      expect((await complete(ticket, material, extra)).status, JSON.stringify(extra)).toBe(400);
    }
    expect((await complete(ticket, material)).status).toBe(200);
    expect(await userRow(user.id)).toMatchObject({ must_change_password: 0, temp_password_expires_at: null });

    const off = await createUser('off@example.com');
    const offTicket = (await verify(verifyBody(off), '198.51.100.90')).json.ticket;
    await db().update(users).set({ status: 'disabled' }).where(eq(users.id, off.id));
    expect((await complete(offTicket, await freshMaterial(off), {}, '198.51.100.90')).status).toBe(403);
  });
});

describe('the person is told, in their language, with no mail content (R3b-style push)', () => {
  it('pushes at verify success and at complete, and names no key, code or address of the person', async () => {
    const user = await createUser('alex@example.com');
    const phone = await subscribeDevice(await signIn(user), 'alex-phone');
    const sink = fakePushService();
    const ticket = (await verify(verifyBody(user))).json.ticket;
    await waitUntil(() => sink.posted.length > 0);
    const first = await decryptPush(sink.bodies[0], phone);
    expect(first).toMatchObject({ title: 'Your recovery key was used', url: '/app' });
    expect(String(first.body)).toMatch(/^Someone used your recovery key at .+ UTC\. /);
    await complete(ticket, await freshMaterial(user));
    await waitUntil(() => sink.posted.length >= 2);
    const second = await decryptPush(sink.bodies[1], phone);
    expect(second).toMatchObject({ title: 'Your password was reset' });
    expect(String(second.body)).toMatch(/^Your password was reset with your recovery key at .+ UTC\.$/);
    for (const note of [first, second]) {
      expect(JSON.stringify(note)).not.toMatch(/alex@example|recovery_auth|Subject|rk/i);
    }
  });

  it('uses the language of the recipient, and never lets a failed push undo or hide the reset', async () => {
    const user = await createUser('alex@example.com');
    await db().update(users).set({ language: 'vi' }).where(eq(users.id, user.id));
    const phone = await subscribeDevice(await signIn(user), 'alex-phone');
    const sink = fakePushService();
    await verify(verifyBody(user));
    await waitUntil(() => sink.posted.length > 0);
    expect(await decryptPush(sink.bodies[0], phone)).toMatchObject({ title: 'Khóa khôi phục của bạn vừa được dùng' });
    // a push service that fails: the reset still happens, and the notice is still there
    vi.restoreAllMocks();
    const original = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) =>
      (input instanceof Request ? input.url : input.toString()).includes('fcm.googleapis.com')
        ? Promise.reject(new Error('push down'))
        : original(input, init)
    );
    const ticket = (await verify(verifyBody(user), '198.51.100.95')).json.ticket;
    expect((await complete(ticket, await freshMaterial(user))).status).toBe(200);
    expect(await kinds()).toContain('password_recovered');
  });
});
