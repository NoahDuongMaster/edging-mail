import { env } from 'cloudflare:workers';
import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { toBase64Url } from '../src/worker/base64url';
import { attachments, messages, pushSubscriptions } from '../src/worker/db/schema';
import { addMessage, call, createUser, db, draftBody, messageRow, openRow, signIn } from './helpers';
import type { TestUser } from './helpers';

// AC11, AC14, AC15: user A never sees, counts, changes or downloads user B's data, on every route that reads or changes mail.
// Foreign ids answer exactly like ids that do not exist.

interface Victim {
  user: TestUser;
  inbox: string;
  starred: string;
  draft: string;
  snoozed: string;
  sent: string;
  withAttachment: string;
  attachmentId: string;
  rawKey: string;
}

async function seedVictim(user: TestUser, marker: string): Promise<Victim> {
  const inbox = await addMessage(user.id, {
    subject: `${marker} inbox`,
    labels: JSON.stringify([`${marker}-label`]),
    message_id: `<${marker}-1@example.org>`,
    thread_id: `<${marker}-thread@example.org>`
  });
  const starred = await addMessage(user.id, { subject: `${marker} starred`, is_starred: 1 });
  const draft = await addMessage(user.id, { folder: 'drafts', subject: `${marker} draft`, is_read: 1 });
  const snoozed = await addMessage(user.id, { folder: 'snoozed', snoozed_until: Date.now() + 3_600_000 });
  const sent = await addMessage(user.id, { folder: 'sent', subject: `${marker} sent`, is_read: 1 });
  const rawKey = `raw/${inbox}.eml`;
  await env.BUCKET.put(rawKey, `raw of ${marker}`);
  await db().update(messages).set({ r2_key: rawKey }).where(eq(messages.id, inbox));
  const withAttachment = await addMessage(user.id, { subject: `${marker} with file`, has_attachments: 1 });
  const attachmentId = crypto.randomUUID();
  const attachmentKey = `attachments/${withAttachment}/${attachmentId}_file.txt`;
  await env.BUCKET.put(attachmentKey, `file of ${marker}`);
  await db()
    .insert(attachments)
    .values({
      id: attachmentId,
      message_id: withAttachment,
      filename: `${marker}.txt`,
      mime_type: 'text/plain',
      size: 10,
      r2_key: attachmentKey,
      created_at: Date.now()
    });
  return { user, inbox, starred, draft, snoozed, sent, withAttachment, attachmentId, rawKey };
}

const allOf = (victim: Victim): string[] => [
  victim.inbox,
  victim.starred,
  victim.draft,
  victim.snoozed,
  victim.sent,
  victim.withAttachment
];

async function snapshot(ids: string[]): Promise<string> {
  const rows = await Promise.all(ids.map((id) => messageRow(id)));
  return JSON.stringify(rows);
}

async function twoUsers(): Promise<{ a: TestUser; b: TestUser; cookieA: string; victim: Victim }> {
  const a = await createUser('alice@example.com');
  const b = await createUser('bob@example.com');
  const cookieA = await signIn(a);
  const victim = await seedVictim(b, 'BOBSECRET');
  return { a, b, cookieA, victim };
}

const MISSING = '00000000-0000-4000-8000-0000000000aa';

const putDraft = async (user: TestUser, cookie: string, id: string, subject: string) =>
  call(`/api/drafts/${id}`, { cookie, method: 'PUT', body: await draftBody(user, id, { subject, text: 'overwritten' }) });

const sendBinding = () => {
  const sent: unknown[] = [];
  return {
    sent,
    binding: {
      send: (builder: unknown) => {
        sent.push(builder);
        return Promise.resolve({ messageId: '<sent-1@example.com>' });
      }
    } as unknown as SendEmail
  };
};

async function subscription(endpoint: string): Promise<Record<string, unknown>> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const p256dh = toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey)));
  return { endpoint, keys: { p256dh, auth: toBase64Url(crypto.getRandomValues(new Uint8Array(16))) } };
}
const rowsOf = (endpoint: string) => db().select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));

describe('reading is per user (AC11, AC14)', () => {
  it("lists, counts and searches only the caller's own mail", async () => {
    const { a, cookieA } = await twoUsers();
    await addMessage(a.id, { subject: 'ALICEMARK hello', labels: '["mine"]' });
    for (const folder of ['inbox', 'starred', 'drafts', 'snoozed', 'sent', 'archive', 'label:BOBSECRET-label']) {
      const list = await call<{ messages: { subject: string }[] }>(`/api/messages?folder=${encodeURIComponent(folder)}`, {
        cookie: cookieA
      });
      expect(list.status).toBe(200);
      expect(JSON.stringify(list.json.messages), folder).not.toContain('BOBSECRET');
    }
    const mine = await call<{ messages: { subject: string }[] }>('/api/messages?folder=inbox', { cookie: cookieA });
    expect(mine.json.messages.map((m) => m.subject)).toEqual(['ALICEMARK hello']);
    // A search for the other person's words finds nothing, in any folder view.
    for (const folder of ['inbox', 'starred', 'sent', 'drafts']) {
      const found = await call<{ messages: unknown[] }>(`/api/messages?folder=${folder}&q=BOBSECRET`, { cookie: cookieA });
      expect(found.json.messages, folder).toHaveLength(0);
    }
    const stats = await call<{ stats: Record<string, { total: number; unread: number }> }>('/api/stats', { cookie: cookieA });
    expect(stats.json.stats.inbox).toEqual({ total: 1, unread: 1 });
    expect(stats.json.stats.sent.total).toBe(0);
    expect(stats.json.stats.starred.total).toBe(0);
    expect(stats.json.stats.drafts.total).toBe(0);
    expect(stats.json.stats.snoozed.total).toBe(0);
    const labels = await call<{ labels: string[] }>('/api/labels', { cookie: cookieA });
    expect(labels.json.labels).toEqual(['mine']);
  });

  it('answers a foreign id exactly like an id that does not exist', async () => {
    const { cookieA, victim } = await twoUsers();
    const check = async (path: string, options: Parameters<typeof call>[1] = {}) => {
      const foreign = await call(path.replace('{id}', victim.inbox), { cookie: cookieA, ...options });
      const missing = await call(path.replace('{id}', MISSING), { cookie: cookieA, ...options });
      expect(foreign.status, path).toBe(missing.status);
      expect(foreign.text.replace(victim.inbox, MISSING), path).toBe(missing.text);
      expect(foreign.status, path).toBe(404);
    };
    await check('/api/messages/{id}');
    await check('/api/messages/{id}?peek=1');
    await check('/api/raw/{id}');
    const foreignLabel = await call('/api/messages/labels', { cookie: cookieA, body: { id: victim.inbox, labels: ['x'] } });
    const missingLabel = await call('/api/messages/labels', { cookie: cookieA, body: { id: MISSING, labels: ['x'] } });
    expect([foreignLabel.status, foreignLabel.text]).toEqual([missingLabel.status, missingLabel.text]);
    expect(foreignLabel.status).toBe(404);
    const foreignAtt = await call(`/api/attachments/${victim.attachmentId}`, { cookie: cookieA });
    const missingAtt = await call(`/api/attachments/${MISSING}`, { cookie: cookieA });
    expect([foreignAtt.status, foreignAtt.text]).toEqual([missingAtt.status, missingAtt.text]);
    expect(foreignAtt.status).toBe(404);
    // The data itself did not move and the owner can still read it.
    expect((await messageRow(victim.inbox))?.labels).toContain('BOBSECRET-label');
    const cookieB = await signIn(victim.user);
    expect((await call(`/api/attachments/${victim.attachmentId}`, { cookie: cookieB })).text).toBe('file of BOBSECRET');
    expect((await call(`/api/raw/${victim.inbox}`, { cookie: cookieB })).text).toBe('raw of BOBSECRET');
    expect((await call(`/api/messages/${victim.inbox}`, { cookie: cookieB })).status).toBe(200);
  });

  it("does not mark another user's mail as read when it is opened (peek or not)", async () => {
    const { cookieA, victim } = await twoUsers();
    await call(`/api/messages/${victim.inbox}`, { cookie: cookieA });
    expect((await messageRow(victim.inbox))?.is_read).toBe(0);
  });
});

describe('changing is per user (AC11)', () => {
  it("a batch with mixed ids changes and counts only the caller's rows, for every action", async () => {
    const { a, cookieA, victim } = await twoUsers();
    const before = await snapshot(allOf(victim));
    const actions: { action: string; extra?: Record<string, unknown> }[] = [
      { action: 'read' },
      { action: 'unread' },
      { action: 'star' },
      { action: 'unstar' },
      { action: 'trash' },
      { action: 'archive' },
      { action: 'restore' },
      { action: 'move', extra: { folder: 'spam' } },
      { action: 'snooze', extra: { until: Date.now() + 7_200_000 } },
      { action: 'delete' }
    ];
    for (const { action, extra } of actions) {
      const mine = await addMessage(a.id, { subject: `own ${action}` });
      const answer = await call<{ count: number }>('/api/messages/batch', {
        cookie: cookieA,
        body: { message_ids: [mine, ...allOf(victim), MISSING], action, ...extra }
      });
      expect(answer.status, action).toBe(200);
      expect(answer.json.count, action).toBe(1);
      expect(await snapshot(allOf(victim)), action).toBe(before);
    }
    // The R2 objects of the other user survived the "delete" too.
    expect(await env.BUCKET.head(victim.rawKey)).not.toBeNull();
    expect(await db().select().from(attachments).where(eq(attachments.id, victim.attachmentId))).toHaveLength(1);
    expect(await env.BUCKET.head(`attachments/${victim.withAttachment}/${victim.attachmentId}_file.txt`)).not.toBeNull();
  });

  it('a batch of only foreign ids changes nothing and counts zero', async () => {
    const { cookieA, victim } = await twoUsers();
    const before = await snapshot(allOf(victim));
    const answer = await call<{ count: number }>('/api/messages/batch', {
      cookie: cookieA,
      body: { message_ids: allOf(victim), action: 'delete' }
    });
    expect(answer.json.count).toBe(0);
    expect(await snapshot(allOf(victim))).toBe(before);
  });

  it('handles more ids than one D1 statement can bind', async () => {
    const { a, cookieA } = await twoUsers();
    const ids = await Promise.all(Array.from({ length: 130 }, (_, n) => addMessage(a.id, { subject: `bulk ${n}` })));
    const answer = await call<{ count: number }>('/api/messages/batch', { cookie: cookieA, body: { message_ids: ids, action: 'star' } });
    expect(answer.json.count).toBe(130);
  });

  it("read-all marks only the caller's mail", async () => {
    const { a, cookieA, victim } = await twoUsers();
    await addMessage(a.id);
    await addMessage(a.id);
    const answer = await call<{ count: number }>('/api/messages/read-all', { cookie: cookieA, body: { folder: 'inbox' } });
    expect(answer.json.count).toBe(2);
    expect((await messageRow(victim.inbox))?.is_read).toBe(0);
    const search = await call<{ count: number }>('/api/messages/read-all', { cookie: cookieA, body: { folder: 'inbox', q: 'BOBSECRET' } });
    expect(search.json.count).toBe(0);
  });

  it("labels only the caller's own mail", async () => {
    const { a, cookieA } = await twoUsers();
    const mine = await addMessage(a.id);
    expect((await call('/api/messages/labels', { cookie: cookieA, body: { id: mine, labels: ['Home'] } })).status).toBe(200);
    expect((await messageRow(mine))?.labels).toBe('["Home"]');
  });
});

describe('drafts are per user (AC11)', () => {
  it("never lets a PUT on another user's draft or mail overwrite it", async () => {
    const { a, cookieA, victim } = await twoUsers();
    const before = await snapshot(allOf(victim));
    for (const id of allOf(victim)) {
      const answer = await putDraft(a, cookieA, id, 'HIJACKED');
      expect(answer.status, id).toBe(404);
    }
    expect(await snapshot(allOf(victim))).toBe(before);
    // The same PUT for a missing id creates it, and for the caller's own non-draft mail it is a conflict (409), not a 404.
    expect((await putDraft(a, cookieA, crypto.randomUUID(), 'fresh')).status).toBe(200);
  });

  it("reads, updates and deletes only the caller's own drafts", async () => {
    const { a, cookieA, victim } = await twoUsers();
    const own = crypto.randomUUID();
    expect((await putDraft(a, cookieA, own, 'first')).status).toBe(200);
    expect((await putDraft(a, cookieA, own, 'second')).status).toBe(200);
    expect((await messageRow(own))?.user_id).toBe(a.id);
    const saved = (await call(`/api/drafts/${own}`, { cookie: cookieA })).json as { draft: Parameters<typeof openRow>[0] };
    expect((await openRow({ ...saved.draft, id: own }, a)).subject).toBe('second');
    const mail = await addMessage(a.id);
    expect((await putDraft(a, cookieA, mail, 'x')).status).toBe(409);

    expect((await call(`/api/drafts/${victim.draft}`, { cookie: cookieA })).status).toBe(404);
    expect((await call(`/api/drafts/${victim.draft}`, { cookie: cookieA, method: 'DELETE' })).status).toBe(404);
    expect(await messageRow(victim.draft)).toBeDefined();
    expect((await call(`/api/drafts/${own}`, { cookie: cookieA, method: 'DELETE' })).status).toBe(200);
  });
});

describe("sending does not touch other users' data (AC11, AC17)", () => {
  it("keeps another user's draft when draft_id names it, and does not join their thread", async () => {
    const { a, cookieA, victim } = await twoUsers();
    const { binding } = sendBinding();
    const answer = await call<{ message: { id: string; thread_id: string; user_id: string } }>('/api/messages/send', {
      cookie: cookieA,
      env: { SEND_EMAIL: binding },
      body: {
        to: 'someone@example.org',
        subject: 'Re: hi',
        text: 'hello',
        draft_id: victim.draft,
        in_reply_to: '<BOBSECRET-1@example.org>'
      }
    });
    expect(answer.status).toBe(200);
    expect(answer.json.message.user_id).toBe(a.id);
    expect(answer.json.message.thread_id).not.toBe('<BOBSECRET-thread@example.org>');
    expect(await messageRow(victim.draft)).toBeDefined();
  });
});

describe('push subscriptions are per user (AC11)', () => {
  it("keeps unsubscribe, status and test on the caller's own devices", async () => {
    const { a, b, cookieA } = await twoUsers();
    const cookieB = await signIn(b);
    const bobEndpoint = 'https://fcm.googleapis.com/fcm/send/bob-device';
    expect((await call('/api/push/subscribe', { cookie: cookieB, body: await subscription(bobEndpoint) })).status).toBe(200);
    expect((await rowsOf(bobEndpoint))[0]?.user_id).toBe(b.id);

    expect((await call('/api/push/status', { cookie: cookieA, body: { endpoint: bobEndpoint } })).json).toMatchObject({
      subscribed: false
    });
    expect((await call('/api/push/status', { cookie: cookieB, body: { endpoint: bobEndpoint } })).json).toMatchObject({ subscribed: true });
    await call('/api/push/unsubscribe', { cookie: cookieA, body: { endpoint: bobEndpoint } });
    expect(await rowsOf(bobEndpoint)).toHaveLength(1);

    // /test notifies only the caller's devices: Alice has none, so nothing is sent (and Bob's device is not contacted).
    const test = await call('/api/push/test', { cookie: cookieA, method: 'POST', body: {} });
    expect(test.json).toMatchObject({ sent: 0, failed: 0, removed: 0 });
    expect(a.id).not.toBe(b.id);
  });

  it('moves a device to the person who subscribes from the same browser next', async () => {
    const { a, b, cookieA } = await twoUsers();
    const cookieB = await signIn(b);
    const shared = 'https://fcm.googleapis.com/fcm/send/shared-browser';
    await call('/api/push/subscribe', { cookie: cookieB, body: await subscription(shared) });
    expect((await call('/api/push/subscribe', { cookie: cookieA, body: await subscription(shared) })).status).toBe(200);
    const rows = await rowsOf(shared);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.user_id).toBe(a.id);
    expect((await call('/api/push/status', { cookie: cookieB, body: { endpoint: shared } })).json).toMatchObject({ subscribed: false });
  });

  it("keeps at most 20 devices per user without touching other users' devices", async () => {
    const { a, b, cookieA } = await twoUsers();
    const cookieB = await signIn(b);
    await call('/api/push/subscribe', { cookie: cookieB, body: await subscription('https://fcm.googleapis.com/fcm/send/bob-only') });
    for (let n = 0; n < 22; n += 1) {
      expect(
        (await call('/api/push/subscribe', { cookie: cookieA, body: await subscription(`https://fcm.googleapis.com/fcm/send/alice-${n}`) }))
          .status
      ).toBe(200);
    }
    expect(await db().select().from(pushSubscriptions).where(eq(pushSubscriptions.user_id, a.id))).toHaveLength(20);
    expect(
      await db()
        .select()
        .from(pushSubscriptions)
        .where(and(eq(pushSubscriptions.user_id, b.id)))
    ).toHaveLength(1);
  }, 30_000);
});

describe('settings are per user (AC11, AC18)', () => {
  it("reads and writes only the caller's display name and signature; the address is read-only", async () => {
    const { a, b, cookieA } = await twoUsers();
    const saved = await call('/api/settings', { cookie: cookieA, body: { display_name: ' Alice A ', signature: '-- \nAlice' } });
    expect(saved.json).toMatchObject({ settings: { display_name: 'Alice A', signature: '-- \nAlice', email: a.email } });
    const cookieB = await signIn(b);
    expect((await call('/api/settings', { cookie: cookieB })).json).toMatchObject({
      settings: { display_name: '', signature: '', email: b.email }
    });
    for (const body of [
      { default_from: 'x@example.org' },
      { email: 'x@example.org' },
      { display_name: 1 },
      { display_name: 'a\nb' },
      { signature: 'x'.repeat(2001) }
    ]) {
      expect((await call('/api/settings', { cookie: cookieA, body })).status, JSON.stringify(body).slice(0, 40)).toBe(400);
    }
    expect((await call('/api/settings', { cookie: cookieA })).json).toMatchObject({
      settings: { display_name: 'Alice A', email: a.email }
    });
  });
});

describe('the admin role gives no access to mail (AC15, AC19)', () => {
  it("an admin gets 404 on another user's mail, attachments and raw, and sees none in lists", async () => {
    const admin = await createUser('boss@example.com', { role: 'admin' });
    const bob = await createUser('bob@example.com');
    const victim = await seedVictim(bob, 'BOBSECRET');
    const cookie = await signIn(admin);
    for (const path of [
      `/api/messages/${victim.inbox}`,
      `/api/raw/${victim.inbox}`,
      `/api/attachments/${victim.attachmentId}`,
      `/api/drafts/${victim.draft}`
    ]) {
      expect((await call(path, { cookie })).status, path).toBe(404);
    }
    expect(((await call('/api/messages?folder=inbox&q=BOBSECRET', { cookie })).json as { messages: unknown[] }).messages).toHaveLength(0);
    expect(((await call('/api/stats', { cookie })).json as { stats: { inbox: { total: number } } }).stats.inbox.total).toBe(0);
  });
});
