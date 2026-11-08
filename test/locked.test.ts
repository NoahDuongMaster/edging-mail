import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachments, auditLog, messages, userKeys, userSecurityEvents, userSignIns, users } from '../src/worker/db/schema';
import { purgeLockedMail } from '../src/worker/locked-job';
import { LOCKED_DELETE_DELAY_MS } from '../src/worker/auth/locked';
import {
  addMessage,
  authFor,
  call,
  createUser,
  db,
  decryptPush,
  fakePushService,
  setupKeys,
  signIn,
  subscribeDevice,
  testEnv,
  waitUntil
} from './helpers';
import type { TestUser } from './helpers';

// Mail locked under a retired key (crypto-design.md 15.7, M7): "keep" is doing nothing; "delete" is marked, waits seven days (the person can
// cancel), then the cron deletes it. The password (and the second step) are needed to ask, the owner is told, and every step is audited.

const RETIRED = 'R'.repeat(22);
const OTHER_RETIRED = 'O'.repeat(22);

interface Retired {
  key_id: string;
  wrapped_private_key_recovery: string | null;
  retired_at: number;
  locked: number;
  delete_requested_at: number | null;
  delete_after: number | null;
}
interface Me {
  success: boolean;
  retired: Retired[];
}
interface Marked {
  success: boolean;
  code?: string;
  key_id?: string;
  locked?: number;
  delete_requested_at?: number | null;
  delete_after?: number | null;
}

afterEach(() => {
  vi.restoreAllMocks();
});

const retire = (userId: string, keyId: string, at = Date.now() - 86_400_000) =>
  db().insert(userKeys).values({ key_id: keyId, user_id: userId, public_key: 'x', wrapped_private_key_recovery: 'x', retired_at: at });

/** Messages of `userId` that are sealed to `keyId`, each with a raw object and one attachment (row and object). Returns the message ids. */
async function lockedMail(userId: string, keyId: string, count: number): Promise<string[]> {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = crypto.randomUUID();
    const attachmentId = crypto.randomUUID();
    const raw = `em1/${userId}/${id}/raw`;
    const file = `em1/${userId}/${id}/att/${attachmentId}`;
    await env.BUCKET.put(raw, 'sealed raw');
    await env.BUCKET.put(file, 'sealed file');
    await addMessage(userId, {
      id,
      enc_fmt: 1,
      wrap_kind: 'user',
      key_id: keyId,
      subject: null,
      snippet: null,
      body_text: null,
      summary_blob: 'x',
      body_blob: 'x',
      wrapped_cek: 'x',
      r2_key: raw,
      has_attachments: 1
    });
    await db().insert(attachments).values({
      id: attachmentId,
      message_id: id,
      filename: '',
      mime_type: '',
      size: 1,
      r2_key: file,
      created_at: Date.now(),
      meta_blob: 'x'
    });
    ids.push(id);
  }
  return ids;
}

const ask = (cookie: string, user: Pick<TestUser, 'auth'>, keyId: string, extra: Record<string, unknown> = {}) =>
  call<Marked>('/api/keys/delete-locked', { cookie, body: { current_auth: user.auth, key_id: keyId, ...extra } });
const cancel = (cookie: string, keyId: string) => call<Marked>('/api/keys/cancel-delete-locked', { cookie, body: { key_id: keyId } });
const me = async (cookie: string): Promise<Retired[]> => (await call<Me>('/api/keys/me', { cookie })).json.retired;
const actions = async (): Promise<string[]> => (await db().select().from(auditLog)).map((row) => row.action);
const messageCount = async (userId: string): Promise<number> =>
  (await db().select().from(messages).where(eq(messages.user_id, userId))).length;
const objectCount = async (): Promise<number> => (await env.BUCKET.list()).objects.length;

describe('what GET /api/keys/me says about locked mail', () => {
  it('counts the messages under each retired key, only the person\u2019s own, and shows a pending deletion', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    await retire(alice.id, RETIRED);
    await retire(bob.id, OTHER_RETIRED);
    await lockedMail(alice.id, RETIRED, 3);
    await lockedMail(bob.id, OTHER_RETIRED, 5);
    await addMessage(alice.id, { key_id: alice.keys?.keyId, enc_fmt: 1, wrap_kind: 'user' });
    const cookie = await signIn(alice);
    expect(await me(cookie)).toEqual([
      expect.objectContaining({
        key_id: RETIRED,
        locked: 3,
        delete_requested_at: null,
        delete_after: null,
        wrapped_private_key_recovery: 'x'
      })
    ]);
    expect(Object.keys((await me(cookie))[0] ?? {}).toSorted()).toEqual(
      ['delete_after', 'delete_requested_at', 'key_id', 'locked', 'retired_at', 'wrapped_private_key_recovery'].toSorted()
    );
    expect((await ask(cookie, alice, RETIRED)).status).toBe(200);
    const listed = (await me(cookie)).at(0);
    expect(listed?.delete_after).toBe((listed?.delete_requested_at ?? 0) + LOCKED_DELETE_DELAY_MS);
    // a person without any retired key gets an empty list
    expect(await me(await signIn(await createUser('carol@example.com')))).toEqual([]);
  });
});

describe('POST /api/keys/delete-locked: marks the deletion, deletes nothing yet', () => {
  it('needs the password and a well-formed body, and only the person\u2019s own retired keys', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    await retire(alice.id, RETIRED);
    await retire(bob.id, OTHER_RETIRED);
    await lockedMail(alice.id, RETIRED, 2);
    await lockedMail(bob.id, OTHER_RETIRED, 2);
    const cookie = await signIn(alice);
    const refusals: [string, () => Promise<{ status: number; json: Marked }>, number, string][] = [
      ['a wrong password', () => ask(cookie, { auth: 'A'.repeat(43) }, RETIRED), 403, 'wrong_password'],
      ['a malformed password value', () => ask(cookie, { auth: 'short' }, RETIRED), 400, 'invalid_request'],
      ['an unknown field', () => ask(cookie, alice, RETIRED, { all: true }), 400, 'invalid_body'],
      ['a key id that is not one', () => ask(cookie, alice, 'short'), 400, 'invalid_request'],
      ['a key id that is the current key', () => ask(cookie, alice, alice.keys?.keyId ?? ''), 404, 'not_found'],
      ['a key id that does not exist', () => ask(cookie, alice, 'N'.repeat(22)), 404, 'not_found'],
      ["somebody else's retired key", () => ask(cookie, alice, OTHER_RETIRED), 404, 'not_found']
    ];
    for (const [name, send, status, code] of refusals) {
      const answer = await send();
      expect([answer.status, answer.json.code], name).toEqual([status, code]);
    }
    expect((await db().select().from(userKeys)).every((row) => row.delete_after === null)).toBe(true);
    expect(await actions()).not.toContain('locked_mail_delete_requested');
    expect([await messageCount(alice.id), await messageCount(bob.id)]).toEqual([2, 2]);
  });

  it('marks it for seven days, tells the owner, audits it, and asking again changes nothing', async () => {
    const alice = await createUser('alice@example.com');
    await retire(alice.id, RETIRED);
    await lockedMail(alice.id, RETIRED, 4);
    const push = fakePushService();
    const cookie = await signIn(alice);
    const device = await subscribeDevice(cookie, 'alice-phone');

    const first = await ask(cookie, alice, RETIRED);
    expect(first.status).toBe(200);
    expect(first.json).toMatchObject({ success: true, key_id: RETIRED, locked: 4 });
    expect(first.json.delete_after).toBe((first.json.delete_requested_at ?? 0) + 7 * 24 * 60 * 60_000);
    // nothing is deleted by the request itself
    expect(await messageCount(alice.id)).toBe(4);
    expect(await objectCount()).toBe(8);

    // audited (with the count, never a message), a notice that cannot be dismissed for seven days, a sign-in history entry, and a push
    const audit = (await db().select().from(auditLog)).filter((row) => row.action === 'locked_mail_delete_requested');
    expect(audit).toHaveLength(1);
    expect([audit[0]?.actor_email, audit[0]?.target]).toEqual(['alice@example.com', 'alice@example.com']);
    expect(JSON.parse(audit[0]?.detail ?? '{}')).toEqual({ key_id: RETIRED, locked: 4, delete_after: first.json.delete_after });
    const notice = (await db().select().from(userSecurityEvents).where(eq(userSecurityEvents.kind, 'locked_delete_requested'))).at(0);
    expect(notice?.dismissible_after).toBe((notice?.at ?? 0) + 7 * 24 * 60 * 60_000);
    expect((await db().select().from(userSignIns)).map((row) => row.kind)).toContain('locked_delete_requested');
    await waitUntil(() => push.posted.length === 1);
    expect(await decryptPush(push.bodies[0] ?? new Uint8Array(), device)).toMatchObject({
      title: 'Deleting your locked old mail was requested'
    });

    // again: the first time stands, and no second audit row, notice or push
    const again = await ask(cookie, alice, RETIRED);
    expect(again.json).toMatchObject({
      success: true,
      delete_requested_at: first.json.delete_requested_at,
      delete_after: first.json.delete_after
    });
    expect((await actions()).filter((action) => action === 'locked_mail_delete_requested')).toHaveLength(1);
    expect(await db().select().from(userSecurityEvents).where(eq(userSecurityEvents.kind, 'locked_delete_requested'))).toHaveLength(1);
    expect(push.posted).toHaveLength(1);
  });

  it('needs a recent second-factor check when the account has two-step verification', async () => {
    const blake = await createUser('blake@example.com', { totp: true });
    await retire(blake.id, RETIRED);
    await lockedMail(blake.id, RETIRED, 1);
    const cookie = await signIn(blake);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 6 * 60_000);
      expect((await ask(cookie, blake, RETIRED)).json).toMatchObject({ code: 'step_up_required' });
    } finally {
      vi.useRealTimers();
    }
    expect((await db().select().from(userKeys))[0]?.delete_after).toBeNull();
    expect((await ask(cookie, blake, RETIRED)).status).toBe(200);
  });

  it('is closed to a signed-out caller and to a person whose key setup is still open', async () => {
    const alice = await createUser('alice@example.com');
    await retire(alice.id, RETIRED);
    expect((await call('/api/keys/delete-locked', { body: { current_auth: alice.auth, key_id: RETIRED } })).status).toBe(401);
    expect((await call('/api/keys/cancel-delete-locked', { body: { key_id: RETIRED } })).status).toBe(401);
    const keyless = await createUser('late@example.com', { keys: false });
    const gated = await ask(await signIn(keyless), keyless, RETIRED);
    expect([gated.status, gated.json.code]).toEqual([403, 'key_setup_required']);
  });
});

describe('POST /api/keys/cancel-delete-locked', () => {
  it('cancels a pending deletion (audited) and refuses when none is pending; the cron then deletes nothing', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    await retire(alice.id, RETIRED);
    await retire(bob.id, OTHER_RETIRED);
    await lockedMail(alice.id, RETIRED, 2);
    const cookie = await signIn(alice);

    expect((await cancel(cookie, RETIRED)).json).toMatchObject({ success: false, code: 'conflict' });
    expect((await cancel(cookie, 'N'.repeat(22))).json).toMatchObject({ code: 'not_found' });
    expect((await cancel(cookie, OTHER_RETIRED)).json).toMatchObject({ code: 'not_found' });
    expect((await call('/api/keys/cancel-delete-locked', { cookie, body: {} })).json).toMatchObject({ code: 'invalid_request' });
    expect((await call('/api/keys/cancel-delete-locked', { cookie, body: { key_id: RETIRED, extra: 1 } })).json).toMatchObject({
      code: 'invalid_body'
    });

    const marked = await ask(cookie, alice, RETIRED);
    expect((await cancel(cookie, RETIRED)).json).toMatchObject({ success: true, key_id: RETIRED });
    expect((await me(cookie))[0]).toMatchObject({ delete_requested_at: null, delete_after: null, locked: 2 });
    expect((await actions()).filter((action) => action === 'locked_mail_delete_canceled')).toHaveLength(1);
    expect(await purgeLockedMail(testEnv(), (marked.json.delete_after ?? 0) + 1000)).toBe(0);
    expect(await messageCount(alice.id)).toBe(2);
    // and it can be asked again afterwards
    expect((await ask(cookie, alice, RETIRED)).status).toBe(200);
  });
});

describe('the cron (purgeLockedMail)', () => {
  it('does nothing before the time, then deletes only the mail sealed to that key, with its attachment rows and R2 objects', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    await retire(alice.id, RETIRED);
    await retire(alice.id, 'S'.repeat(22));
    await retire(bob.id, OTHER_RETIRED);
    await lockedMail(alice.id, RETIRED, 3);
    const keptOld = await lockedMail(alice.id, 'S'.repeat(22), 2);
    const bobs = await lockedMail(bob.id, OTHER_RETIRED, 2);
    const current = await addMessage(alice.id, { key_id: alice.keys?.keyId, enc_fmt: 1, wrap_kind: 'user' });
    const cookie = await signIn(alice);
    const marked = await ask(cookie, alice, RETIRED);
    const due = marked.json.delete_after ?? 0;
    expect(await objectCount()).toBe(14);

    expect(await purgeLockedMail(testEnv(), due - 1)).toBe(0);
    expect(await messageCount(alice.id)).toBe(6);

    expect(await purgeLockedMail(testEnv(), due)).toBe(3);
    expect(await messageCount(alice.id)).toBe(3);
    const left = (await db().select().from(messages).where(eq(messages.user_id, alice.id))).map((row) => row.id);
    expect(left.toSorted()).toEqual([...keptOld, current].toSorted());
    expect(await messageCount(bob.id)).toBe(bobs.length);
    expect((await db().select().from(attachments)).length).toBe(4);
    expect(await objectCount()).toBe(8);
    // the request is finished (the marker is gone), the retired key and the audit remain
    const row = (await db().select().from(userKeys).where(eq(userKeys.key_id, RETIRED))).at(0);
    expect([row?.delete_requested_at, row?.delete_after]).toEqual([null, null]);
    const done = (await db().select().from(auditLog)).filter((entry) => entry.action === 'locked_mail_deleted');
    expect(done).toHaveLength(1);
    expect(JSON.parse(done[0]?.detail ?? '{}')).toEqual({ key_id: RETIRED, deleted: 3 });
    expect(done[0]?.actor_user_id).toBeNull();
    expect(await purgeLockedMail(testEnv(), due + 1000)).toBe(0);
  });

  it('works in chunks: a big backlog takes more than one run, and the request stays marked until nothing is left', async () => {
    const alice = await createUser('alice@example.com');
    await retire(alice.id, RETIRED);
    const base = Date.now();
    for (let batch = 0; batch < 5; batch += 1) {
      await Promise.all(
        Array.from({ length: 50 }, () => addMessage(alice.id, { key_id: RETIRED, enc_fmt: 1, wrap_kind: 'user', created_at: base }))
      );
    }
    expect(await messageCount(alice.id)).toBe(250);
    const cookie = await signIn(alice);
    const due = (await ask(cookie, alice, RETIRED)).json.delete_after ?? 0;
    expect(await purgeLockedMail(testEnv(), due)).toBe(200);
    expect((await db().select().from(userKeys))[0]?.delete_after).toBe(due);
    expect(await purgeLockedMail(testEnv(), due)).toBe(50);
    expect(await messageCount(alice.id)).toBe(0);
    expect((await db().select().from(userKeys))[0]?.delete_after).toBeNull();
  }, 60_000);

  it('deletes nothing for a request that was cancelled, even when the cron already looked at it', async () => {
    const alice = await createUser('alice@example.com');
    await retire(alice.id, RETIRED);
    await lockedMail(alice.id, RETIRED, 2);
    const cookie = await signIn(alice);
    const due = (await ask(cookie, alice, RETIRED)).json.delete_after ?? 0;
    // the person cancels in the middle of the run: the first read of the rows has happened, the delete must then be a no-op
    let cancelled = false;
    const racing = new Proxy(env.DB, {
      get(target, property) {
        if (property === 'batch') {
          return async (...args: Parameters<D1Database['batch']>) => {
            if (!cancelled) {
              cancelled = true;
              await db().update(userKeys).set({ delete_requested_at: null, delete_after: null }).where(eq(userKeys.key_id, RETIRED));
            }
            return target.batch(...args);
          };
        }
        const value: unknown = Reflect.get(target, property);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      }
    });
    expect(await purgeLockedMail(testEnv({ DB: racing }), due)).toBe(0);
    expect(cancelled).toBe(true);
    expect(await messageCount(alice.id)).toBe(2);
    expect(await objectCount()).toBe(4);
  });

  it('never logs a message, an address or a key (only a class) when it fails', async () => {
    const alice = await createUser('alice@example.com');
    await retire(alice.id, RETIRED);
    await lockedMail(alice.id, RETIRED, 1);
    const due = (await ask(await signIn(alice), alice, RETIRED)).json.delete_after ?? 0;
    const logs = [vi.spyOn(console, 'error'), vi.spyOn(console, 'log'), vi.spyOn(console, 'warn')];
    const broken = new Proxy(env.DB, {
      get(target, property) {
        if (property === 'batch') {
          return () => Promise.reject(new Error(`boom alice@example.com ${RETIRED}`));
        }
        const value: unknown = Reflect.get(target, property);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      }
    });
    expect(await purgeLockedMail(testEnv({ DB: broken }), due)).toBe(0);
    const text = JSON.stringify(logs.map((spy) => spy.mock.calls));
    expect(text).toContain('The deletion of locked mail failed');
    for (const secret of ['boom', 'alice@example.com', RETIRED]) {
      expect(text, secret).not.toContain(secret);
    }
    expect(await messageCount(alice.id)).toBe(1);
  });
});

describe('after a real break-glass', () => {
  it('lists the retired key with its locked mail, deletes it after the delay, and keeps the new mail', async () => {
    const admin = await createUser('boss@example.com', { role: 'admin' });
    const oldKey = admin.keys?.keyId ?? '';
    await lockedMail(admin.id, oldKey, 2);
    const newAuth = await authFor(admin.email, 'recovered password!');
    const recovered = await call('/api/auth/recover', {
      body: { setup_key: env.APP_PASSWORD, email: admin.email, new_auth: newAuth, kdf: 1, keys: await setupKeys(admin.email) }
    });
    expect(recovered.status).toBe(200);
    const after: TestUser = { ...admin, auth: newAuth };
    const cookie = await signIn(after);
    const listed = (await me(cookie)).at(0);
    expect(listed).toMatchObject({ key_id: oldKey, locked: 2, delete_requested_at: null, delete_after: null });
    const newMail = await addMessage(admin.id, {
      key_id: (await db().select().from(users).where(eq(users.id, admin.id)))[0]?.key_id,
      enc_fmt: 1,
      wrap_kind: 'user'
    });

    const marked = await ask(cookie, after, oldKey);
    expect(marked.status).toBe(200);
    expect(await purgeLockedMail(testEnv(), (marked.json.delete_after ?? 0) + 1)).toBe(2);
    expect((await db().select().from(messages).where(eq(messages.user_id, admin.id))).map((row) => row.id)).toEqual([newMail]);
    expect((await me(cookie))[0]).toMatchObject({ key_id: oldKey, locked: 0, delete_after: null });
  });
});
