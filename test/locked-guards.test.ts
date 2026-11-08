import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { messages, userKeys, userSecurityEvents } from '../src/worker/db/schema';
import { LOCKED_DELETE_DELAY_MS } from '../src/worker/auth/locked';
import { purgeChunk, purgeLockedMail } from '../src/worker/locked-job';
import { getDb } from '../src/worker/db';
import { addMessage, authFor, call, createUser, db, must, setupKeys, signIn } from './helpers';
import type { TestUser } from './helpers';

// crypto-review.md 19: LK-1 (a recovery ends a pending deletion of locked mail), LK-3 (the event carries `delete_after`), LK-4 (a user_keys row
// that carries the person's LIVE key can never purge their mailbox).

const RETIRED = 'R'.repeat(22);
const FAR_FUTURE = (): number => Date.now() + LOCKED_DELETE_DELAY_MS + 3_600_000;

const retiredWithMail = async (userId: string, keyId: string, count = 2): Promise<void> => {
  await db()
    .insert(userKeys)
    .values({ key_id: keyId, user_id: userId, public_key: 'x', wrapped_private_key_recovery: 'x', retired_at: Date.now() - 86_400_000 });
  for (let index = 0; index < count; index += 1) {
    await addMessage(userId, {
      enc_fmt: 1,
      wrap_kind: 'user',
      key_id: keyId,
      subject: null,
      snippet: null,
      body_text: null,
      summary_blob: 'x',
      body_blob: 'x',
      wrapped_cek: 'x'
    });
  }
};
const markedNow = async (userId: string, keyId: string): Promise<void> => {
  const now = Date.now();
  await db()
    .update(userKeys)
    .set({ delete_requested_at: now, delete_after: now + LOCKED_DELETE_DELAY_MS })
    .where(and(eq(userKeys.user_id, userId), eq(userKeys.key_id, keyId)));
};
const markerOf = async (userId: string, keyId: string) => {
  const row = must(
    await db()
      .select()
      .from(userKeys)
      .where(and(eq(userKeys.user_id, userId), eq(userKeys.key_id, keyId)))
      .get()
  );
  return [row.delete_requested_at, row.delete_after];
};
const mailOf = async (userId: string): Promise<number> => (await db().select().from(messages).where(eq(messages.user_id, userId))).length;

/** After the recovery: no marker is left, and a cron run long after the seven days deletes nothing. */
const expectNothingPending = async (userId: string, keyId: string, mail: number): Promise<void> => {
  expect(await markerOf(userId, keyId)).toEqual([null, null]);
  expect(await purgeLockedMail(env, FAR_FUTURE())).toBe(0);
  expect(await mailOf(userId)).toBe(mail);
};

describe('a pending deletion of locked mail ends when the owner recovers the account (LK-1)', () => {
  it('forgot password: asked through the route, gone after complete, and another person\u2019s request is left alone', async () => {
    const alex = await createUser('alex@example.com');
    const blake = await createUser('blake@example.com');
    await retiredWithMail(alex.id, RETIRED);
    await retiredWithMail(blake.id, 'B'.repeat(22));
    const asked = await call<{ delete_after?: number }>('/api/keys/delete-locked', {
      cookie: await signIn(alex),
      body: { current_auth: alex.auth, key_id: RETIRED }
    });
    expect(asked.status).toBe(200);
    await markedNow(blake.id, 'B'.repeat(22));
    expect((await markerOf(alex.id, RETIRED)).at(1)).toBe(asked.json.delete_after);

    const verified = await call<{ ticket: string }>('/api/auth/forgot/verify', {
      body: { email: alex.email, recovery_auth: alex.recoveryAuth, kdf: 1 }
    });
    expect(verified.status).toBe(200);
    const keys = await setupKeys(alex.email);
    const completed = await call('/api/auth/forgot/complete', {
      body: {
        ticket: verified.json.ticket,
        kdf: 1,
        new_auth: await authFor(alex.email, 'another long password'),
        wrapped_private_key_pw: keys.wrapped_private_key_pw,
        wrapped_private_key_recovery: keys.wrapped_private_key_recovery,
        recovery_auth: keys.recovery_auth
      }
    });
    expect(completed.status).toBe(200);
    expect(await markerOf(alex.id, RETIRED)).toEqual([null, null]);
    // blake's request is still pending, so the cron deletes blake's mail (2) and nothing of alex's
    expect((await markerOf(blake.id, 'B'.repeat(22))).every((value) => value !== null)).toBe(true);
    expect(await purgeLockedMail(env, FAR_FUTURE())).toBe(2);
    expect(await mailOf(alex.id)).toBe(2);
    expect(await mailOf(blake.id)).toBe(0);
  });

  it('break-glass', async () => {
    const admin = await createUser('boss@example.com', { role: 'admin' });
    await retiredWithMail(admin.id, RETIRED);
    await markedNow(admin.id, RETIRED);
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
    await expectNothingPending(admin.id, RETIRED, 2);
  });

  it('a reissued temporary password', async () => {
    const admin = await createUser('boss@example.com', { role: 'admin' });
    const target = await createUser('new@example.com', { mustChange: true, keys: false });
    await retiredWithMail(target.id, RETIRED);
    await markedNow(target.id, RETIRED);
    const reissued = await call(`/api/admin/users/${target.id}/reissue`, {
      cookie: await signIn(admin),
      body: { auth: await authFor(target.email, 'a second temporary password'), kdf: 1 }
    });
    expect(reissued.status).toBe(200);
    await expectNothingPending(target.id, RETIRED, 2);
  });

  it('an applied reset of two-step verification', async () => {
    const admin = await createUser('boss@example.com', { role: 'admin' });
    const member: TestUser = await createUser('alex@example.com', { totp: true });
    await retiredWithMail(member.id, RETIRED);
    await markedNow(member.id, RETIRED);
    const reset = await call(`/api/admin/users/${member.id}/reset-2fa`, { cookie: await signIn(admin), body: {} });
    expect(reset.status).toBe(200);
    await expectNothingPending(member.id, RETIRED, 2);
  });

  it('is not touched by a failed recovery or by a sign-in', async () => {
    const member = await createUser('alex@example.com', { totp: true });
    await retiredWithMail(member.id, RETIRED);
    await markedNow(member.id, RETIRED);
    const before = await markerOf(member.id, RETIRED);
    const wrong = await call('/api/auth/forgot/verify', {
      body: { email: member.email, recovery_auth: member.recoveryAuth, kdf: 1, code: '000000' }
    });
    expect(wrong.status).toBe(401);
    expect(await markerOf(member.id, RETIRED)).toEqual(before);
    // signing in is not a recovery
    const signedIn = await call('/api/auth/login', { body: { email: member.email, auth: member.auth, kdf: 1 } });
    expect(signedIn.status).toBe(200);
    expect(await markerOf(member.id, RETIRED)).toEqual(before);
  });
});

describe('the event of a requested deletion carries its date (LK-3)', () => {
  it('has key_id and delete_after in the detail, equal to the answer, and the notices route returns it', async () => {
    const alex = await createUser('alex@example.com');
    await retiredWithMail(alex.id, RETIRED);
    const cookie = await signIn(alex);
    const asked = await call<{ delete_after: number }>('/api/keys/delete-locked', {
      cookie,
      body: { current_auth: alex.auth, key_id: RETIRED }
    });
    expect(asked.status).toBe(200);
    const [event] = await db().select().from(userSecurityEvents).where(eq(userSecurityEvents.kind, 'locked_delete_requested'));
    expect(JSON.parse(must(event).detail)).toEqual({ key_id: RETIRED, delete_after: asked.json.delete_after });
    const notices = await call<{ notices: { kind: string; detail: unknown }[] }>('/api/auth/notices', { cookie });
    expect(notices.json.notices.find((notice) => notice.kind === 'locked_delete_requested')?.detail).toEqual({
      key_id: RETIRED,
      delete_after: asked.json.delete_after
    });
    // asking again changes nothing and adds no second event
    await call('/api/keys/delete-locked', { cookie, body: { current_auth: alex.auth, key_id: RETIRED } });
    expect(await db().select().from(userSecurityEvents).where(eq(userSecurityEvents.kind, 'locked_delete_requested'))).toHaveLength(1);
  });
});

describe('a user_keys row that carries the live key (LK-4)', () => {
  it('is refused by the route (404) and never purged by the cron, whatever its marker says', async () => {
    const alice = await createUser('alice@example.com');
    const live = must(alice.keys).keyId;
    // the anomaly: the live key also sits in user_keys, and the mailbox is sealed to it
    await retiredWithMail(alice.id, live, 3);
    const refused = await call<{ code?: string }>('/api/keys/delete-locked', {
      cookie: await signIn(alice),
      body: { current_auth: alice.auth, key_id: live }
    });
    expect([refused.status, refused.json.code]).toEqual([404, 'not_found']);
    expect(await markerOf(alice.id, live)).toEqual([null, null]);

    // even a marker written by some other way (a bug, a restore) deletes nothing
    await db().update(userKeys).set({ delete_requested_at: 1, delete_after: 2 }).where(eq(userKeys.key_id, live));
    expect(await purgeLockedMail(env, Date.now())).toBe(0);
    expect(await mailOf(alice.id)).toBe(3);
  });

  it('purgeChunk itself refuses a live key, whatever the selection before it did', async () => {
    const alice = await createUser('alice@example.com');
    const live = must(alice.keys).keyId;
    await retiredWithMail(alice.id, live, 3);
    await db().update(userKeys).set({ delete_requested_at: 1, delete_after: 2 }).where(eq(userKeys.key_id, live));
    expect(await purgeChunk(env, getDb(env.DB), { key_id: live, user_id: alice.id }, Date.now())).toEqual({ deleted: 0, more: false });
    expect(await mailOf(alice.id)).toBe(3);
  });

  it('does not let rows that carry a live key take the places of the cron: a real request still gets done', async () => {
    // more such rows than the cron takes per run (3), all marked and due, inserted BEFORE the real request
    for (const name of ['a', 'b', 'c', 'd']) {
      const person = await createUser(`${name}@example.com`);
      await retiredWithMail(person.id, must(person.keys).keyId, 1);
      await db().update(userKeys).set({ delete_requested_at: 1, delete_after: 2 }).where(eq(userKeys.user_id, person.id));
    }
    const bob = await createUser('bob@example.com');
    await retiredWithMail(bob.id, RETIRED, 2);
    await db().update(userKeys).set({ delete_requested_at: 1, delete_after: 2 }).where(eq(userKeys.key_id, RETIRED));
    expect(await purgeLockedMail(env, Date.now())).toBe(2);
    expect(await mailOf(bob.id)).toBe(0);
  });

  it('does not stop a normal retired key next to it', async () => {
    const alice = await createUser('alice@example.com');
    await retiredWithMail(alice.id, RETIRED, 2);
    await retiredWithMail(alice.id, must(alice.keys).keyId, 1);
    await db().update(userKeys).set({ delete_requested_at: 1, delete_after: 2 });
    expect(await purgeLockedMail(env, Date.now())).toBe(2);
    expect(await mailOf(alice.id)).toBe(1);
  });
});
