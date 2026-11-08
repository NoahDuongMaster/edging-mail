import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { applyDueTwoFactorResets } from '../src/worker/admin/user-actions';
import { claimAttempt, SECOND_FACTOR_POLICY } from '../src/worker/auth/throttle';
import { pruneActivity } from '../src/worker/maintenance';
import { auditLog, recoveryTickets, userSecurityEvents, users } from '../src/worker/db/schema';
import { authFor, call, createUser, db, must, setupKeys, signIn, testEnv } from './helpers';

// crypto-review.md PB-4 (second-factor budget), PB-5 (pending admin 2FA reset), PB-6 (setup key), PB-7 (key-set check), PB-8 (ticket purge).

const eventsOf = async (kind: string, userId?: string) =>
  (await db().select().from(userSecurityEvents)).filter((row) => row.kind === kind && (userId === undefined || row.user_id === userId));

const pendingBy = async (target: { id: string }, requester: string) =>
  db()
    .update(users)
    .set({ reset_2fa_due_at: Date.now() - 1000, reset_2fa_by: requester })
    .where(eq(users.id, target.id));
const totpOn = async (id: string): Promise<number> => must(await db().select().from(users).where(eq(users.id, id)).get()).totp_enabled;

describe('the second-factor budget (PB-4)', () => {
  it('locks 15 minutes twice, then 24 hours, and says which attempt started each lock', async () => {
    let now = Date.now();
    const locks: { retryAfter: number; fresh: boolean }[] = [];
    for (let cycle = 0; cycle < 3; cycle += 1) {
      for (let attempt = 1; attempt <= 10; attempt += 1) {
        const claim = await claimAttempt(db(), 'pb4-simulation', now, SECOND_FACTOR_POLICY);
        expect(claim.allowed, `cycle ${cycle} attempt ${attempt}`).toBe(true);
      }
      const locked = await claimAttempt(db(), 'pb4-simulation', now, SECOND_FACTOR_POLICY);
      expect(locked.allowed).toBe(false);
      locks.push({ retryAfter: locked.retryAfter, fresh: locked.fresh });
      // an attempt during the lock is refused too, but it did not start the lock
      const during = await claimAttempt(db(), 'pb4-simulation', now + 1000, SECOND_FACTOR_POLICY);
      expect([during.allowed, during.fresh]).toEqual([false, false]);
      now += locked.retryAfter * 1000 + 1000;
    }
    expect(locks).toEqual([
      { retryAfter: 900, fresh: true },
      { retryAfter: 900, fresh: true },
      { retryAfter: 86_400, fresh: true }
    ]);
  });

  it('tells the owner ONCE, when the lock starts, and a refused attempt during the lock tells nobody', async () => {
    const admin = await createUser('boss@example.com', { role: 'admin' });
    const cookie = await signIn(admin);
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const wrong = await call<{ code?: string }>('/api/auth/step-up', { cookie, body: { code: '000000' }, ip: `198.51.100.${attempt}` });
      expect([wrong.status, wrong.json.code], `attempt ${attempt}`).toEqual([401, 'wrong_code']);
    }
    expect(await eventsOf('second_factor_locked')).toHaveLength(0);
    const locked = await call<{ code?: string }>('/api/auth/step-up', { cookie, body: { code: '000000' }, ip: '198.51.100.11' });
    expect([locked.status, locked.json.code]).toEqual([429, 'too_many_attempts']);
    const during = await call('/api/auth/step-up', { cookie, body: { code: '000000' }, ip: '198.51.100.12' });
    expect(during.status).toBe(429);
    const events = await eventsOf('second_factor_locked', admin.id);
    expect(events).toHaveLength(1);
    expect(events.at(0)?.actor_email).toBeNull();
    expect(await eventsOf('second_factor_locked')).toHaveLength(1);
  }, 60_000);
});

describe('a pending reset of an admin\u2019s two-step verification (PB-5)', () => {
  it('is applied while the admin who asked is still an active admin', async () => {
    const asker = await createUser('asker@example.com', { role: 'admin' });
    const target = await createUser('target@example.com', { role: 'admin' });
    await pendingBy(target, asker.email);
    expect(await applyDueTwoFactorResets(testEnv(), db())).toBe(1);
    expect(await totpOn(target.id)).toBe(0);
  });

  it('dies with a requester who was disabled, demoted or deleted: nothing is applied and the request is cleared', async () => {
    const disabled = await createUser('disabled@example.com', { role: 'admin', status: 'disabled' });
    const demoted = await createUser('demoted@example.com', { role: 'member' });
    const targets = [
      await createUser('t1@example.com', { role: 'admin' }),
      await createUser('t2@example.com', { role: 'admin' }),
      await createUser('t3@example.com', { role: 'admin' })
    ];
    await pendingBy(must(targets.at(0)), disabled.email);
    await pendingBy(must(targets.at(1)), demoted.email);
    await pendingBy(must(targets.at(2)), 'deleted@example.com');
    expect(await applyDueTwoFactorResets(testEnv(), db())).toBe(0);
    for (const target of targets) {
      const row = must(await db().select().from(users).where(eq(users.id, target.id)).get());
      expect([row.totp_enabled, row.reset_2fa_due_at, row.reset_2fa_by], target.email).toEqual([1, null, null]);
    }
    const cancelled = (await db().select().from(auditLog)).filter((row) => row.action === '2fa_reset_cancelled');
    expect(cancelled).toHaveLength(3);
    expect(cancelled.every((row) => row.detail.includes('requester_not_active_admin'))).toBe(true);
  });

  it('can be cancelled by any other admin (not only the target), without a step-up; members and unknown ids cannot', async () => {
    const asker = await createUser('asker@example.com', { role: 'admin' });
    const target = await createUser('target@example.com', { role: 'admin' });
    const other = await createUser('other@example.com', { role: 'admin' });
    const member = await createUser('member@example.com');
    await db()
      .update(users)
      .set({ reset_2fa_due_at: Date.now() + 3_600_000, reset_2fa_by: asker.email })
      .where(eq(users.id, target.id));
    const path = `/api/admin/users/${target.id}/cancel-2fa-reset`;
    expect((await call(path, { cookie: await signIn(member), body: {} })).status).toBe(403);
    expect((await call(path, { cookie: await signIn(other), method: 'POST' })).status).toBe(400);
    const cancelled = await call(path, { cookie: await signIn(other), body: {} });
    expect(cancelled.status).toBe(200);
    const row = must(await db().select().from(users).where(eq(users.id, target.id)).get());
    expect([row.reset_2fa_due_at, row.reset_2fa_by, row.totp_enabled]).toEqual([null, null, 1]);
    const entry = (await db().select().from(auditLog)).find((item) => item.action === '2fa_reset_cancelled');
    expect([entry?.actor_email, entry?.target]).toEqual([other.email, target.email]);
    const again = await call<{ code?: string }>(path, { cookie: await signIn(other), body: {} });
    expect([again.status, again.json.code]).toEqual([409, 'no_pending_reset']);
    const unknown = await call<{ code?: string }>('/api/admin/users/no-such-id/cancel-2fa-reset', {
      cookie: await signIn(other),
      body: {}
    });
    expect([unknown.status, unknown.json.code]).toEqual([404, 'user_not_found']);
  });
});

describe('the setup key (PB-6)', () => {
  it('needs 24 characters', async () => {
    const short = await call<{ missing_secrets: string[] }>('/api/auth/session', { env: { APP_PASSWORD: 'x'.repeat(23) } });
    expect(short.json.missing_secrets).toEqual(['APP_PASSWORD']);
    const enough = await call<{ missing_secrets: string[] }>('/api/auth/session', { env: { APP_PASSWORD: 'x'.repeat(24) } });
    expect(enough.json.missing_secrets).toEqual([]);
  });

  it('counts the failures of break-glass in one hourly counter and alerts every admin at the tenth, once', async () => {
    const target = await createUser('boss@example.com', { role: 'admin' });
    const other = await createUser('second@example.com', { role: 'admin' });
    const body = {
      setup_key: 'a-wrong-setup-key-a-wrong-setup-key',
      email: target.email,
      new_auth: await authFor(target.email, 'a different long password'),
      kdf: 1,
      keys: await setupKeys(target.email)
    };
    for (let attempt = 1; attempt <= 9; attempt += 1) {
      const wrong = await call<{ code?: string }>('/api/auth/recover', { body, ip: `198.51.100.${attempt}` });
      expect([wrong.status, wrong.json.code], `attempt ${attempt}`).toEqual([401, 'wrong_setup_key']);
    }
    expect(await eventsOf('alert_break_glass_failures')).toHaveLength(0);
    await call('/api/auth/recover', { body, ip: '198.51.100.10' });
    expect((await eventsOf('alert_break_glass_failures', target.id)).length).toBe(1);
    expect((await eventsOf('alert_break_glass_failures', other.id)).length).toBe(1);
    await call('/api/auth/recover', { body, ip: '198.51.100.11' });
    expect(await eventsOf('alert_break_glass_failures')).toHaveLength(2);
  }, 60_000);
});

describe('the key set is checked as a whole by the database (PB-7)', () => {
  it('refuses a public key without the rest, and a key set with a part missing', async () => {
    const keyless = await createUser('late@example.com', { keys: false });
    const keyed = await createUser('keyed@example.com');
    const breakers = [
      async () => db().update(users).set({ public_key: 'x' }).where(eq(users.id, keyless.id)),
      async () => db().update(users).set({ key_id: null }).where(eq(users.id, keyed.id)),
      async () => db().update(users).set({ wrapped_private_key_pw: null }).where(eq(users.id, keyed.id)),
      async () => db().update(users).set({ recovery_salt: null }).where(eq(users.id, keyed.id)),
      async () => db().update(users).set({ recovery_iterations: null }).where(eq(users.id, keyed.id))
    ];
    for (const [index, breaker] of breakers.entries()) {
      await expect(breaker(), `breaker ${index}`).rejects.toThrow();
    }
  });
});

describe('forgot-password tickets are purged (PB-8)', () => {
  it('drops tickets that expired or were used more than a day ago, and keeps the rest', async () => {
    const now = Date.now();
    const day = 86_400_000;
    const tickets = [
      { exp: now - 2 * day, used_at: null },
      { exp: now + 1000, used_at: now - 2 * day },
      { exp: now - 1_800_000, used_at: null },
      { exp: now + 600_000, used_at: null },
      { exp: now + 600_000, used_at: now - 60_000 }
    ];
    // one open ticket per person (a unique index on user_id), so each ticket belongs to its own person
    const owners = await Promise.all(tickets.map((_ticket, index) => createUser(`person${index}@example.com`)));
    await db()
      .insert(recoveryTickets)
      .values(
        tickets.map((ticket, index) => ({
          ticket_hmac: `ticket-${index}`,
          user_id: must(owners.at(index)).id,
          key_id: 'k',
          keys_version: 1,
          created_at: now,
          ip: '203.0.113.9',
          ...ticket
        }))
      );
    await pruneActivity(testEnv());
    const left = (await db().select().from(recoveryTickets)).map((row) => row.ticket_hmac).toSorted();
    expect(left).toEqual(['ticket-2', 'ticket-3', 'ticket-4']);
  });
});
