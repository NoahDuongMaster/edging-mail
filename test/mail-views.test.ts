import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { attachments, messages } from '../src/worker/db/schema';
import { addMessage, call, createUser, db, messageRow, signIn } from './helpers';

// The `all` folder view (search across folders: every folder except Trash and Spam) and Empty Trash / Empty Spam.

interface Row {
  id: string;
  folder: string;
  is_read: number;
}

const list = async (cookie: string, query: string): Promise<Row[]> => {
  const answer = await call<{ messages: Row[] }>(`/api/messages?${query}`, { cookie });
  expect(answer.status, query).toBe(200);
  return answer.json.messages;
};

async function seed() {
  const alice = await createUser('alice@example.com');
  const bob = await createUser('bob@example.com');
  const cookie = await signIn(alice);
  const at = Date.now() - 60_000;
  const ids = {
    inbox: await addMessage(alice.id, { from_address: 'maya@example.org', created_at: at + 6 }),
    archive: await addMessage(alice.id, { folder: 'archive', from_address: 'maya@example.org', created_at: at + 5 }),
    sent: await addMessage(alice.id, { folder: 'sent', to_address: 'maya@example.org', is_read: 1, created_at: at + 4 }),
    snoozed: await addMessage(alice.id, { folder: 'snoozed', snoozed_until: Date.now() + 3_600_000, created_at: at + 3 }),
    drafts: await addMessage(alice.id, { folder: 'drafts', is_read: 1, created_at: at + 2 }),
    trash: await addMessage(alice.id, { folder: 'trash', from_address: 'maya@example.org', created_at: at + 1 }),
    spam: await addMessage(alice.id, { folder: 'spam', from_address: 'maya@example.org', created_at: at })
  };
  const bobs = {
    inbox: await addMessage(bob.id, { from_address: 'maya@example.org' }),
    trash: await addMessage(bob.id, { folder: 'trash' })
  };
  return { alice, bob, cookie, ids, bobs };
}

describe('GET /api/messages?folder=all', () => {
  it('lists every folder of the caller except Trash and Spam, newest first, each row with its own folder', async () => {
    const { cookie, ids } = await seed();
    const rows = await list(cookie, 'folder=all');
    expect(rows.map((row) => row.id)).toEqual([ids.inbox, ids.archive, ids.sent, ids.snoozed, ids.drafts]);
    expect(rows.map((row) => row.folder)).toEqual(['inbox', 'archive', 'sent', 'snoozed', 'drafts']);
  });

  it('searches across those folders and never returns Trash, Spam or another person', async () => {
    const { cookie, ids } = await seed();
    const rows = await list(cookie, 'folder=all&q=MAYA');
    expect(rows.map((row) => row.id)).toEqual([ids.inbox, ids.archive, ids.sent]);
    // The single folder views stay as they were.
    expect((await list(cookie, 'folder=inbox&q=maya')).map((row) => row.id)).toEqual([ids.inbox]);
    expect((await list(cookie, 'folder=trash&q=maya')).map((row) => row.id)).toEqual([ids.trash]);
  });

  it('pages like any other view', async () => {
    const { cookie, ids } = await seed();
    expect((await list(cookie, 'folder=all&limit=2&page=2')).map((row) => row.id)).toEqual([ids.sent, ids.snoozed]);
  });
});

describe('POST /api/messages/read-all with folder all', () => {
  it('marks the matching unread mail of every folder but Trash and Spam as read', async () => {
    const { cookie, ids, bobs } = await seed();
    const answer = await call<{ count: number }>('/api/messages/read-all', { cookie, body: { folder: 'all', q: 'maya' } });
    expect(answer.status).toBe(200);
    // inbox + archive (sent was already read)
    expect(answer.json.count).toBe(2);
    expect((await messageRow(ids.inbox))?.is_read).toBe(1);
    expect((await messageRow(ids.archive))?.is_read).toBe(1);
    expect((await messageRow(ids.trash))?.is_read).toBe(0);
    expect((await messageRow(ids.spam))?.is_read).toBe(0);
    expect((await messageRow(bobs.inbox))?.is_read).toBe(0);
    const rest = await call<{ count: number }>('/api/messages/read-all', { cookie, body: { folder: 'all' } });
    expect(rest.json.count).toBe(1);
    expect((await messageRow(ids.snoozed))?.is_read).toBe(1);
  });
});

describe('POST /api/messages/empty', () => {
  it('deletes every mail of the caller in Trash for good, with attachment rows and R2 objects, and nothing else', async () => {
    const { alice, cookie, ids, bobs } = await seed();
    const rawKey = `raw/${ids.trash}.eml`;
    await env.BUCKET.put(rawKey, 'raw');
    await db().update(messages).set({ r2_key: rawKey }).where(eq(messages.id, ids.trash));
    const attachmentId = crypto.randomUUID();
    const attachmentKey = `attachments/${ids.trash}/${attachmentId}_a.txt`;
    await env.BUCKET.put(attachmentKey, 'file');
    await db().insert(attachments).values({
      id: attachmentId,
      message_id: ids.trash,
      filename: 'a.txt',
      mime_type: 'text/plain',
      size: 4,
      r2_key: attachmentKey,
      created_at: Date.now()
    });
    const second = await addMessage(alice.id, { folder: 'trash' });

    const answer = await call<{ deleted: number; more: boolean }>('/api/messages/empty', { cookie, body: { folder: 'trash' } });
    expect(answer.status).toBe(200);
    expect(answer.json).toEqual({ success: true, deleted: 2, more: false });
    expect(await messageRow(ids.trash)).toBeUndefined();
    expect(await messageRow(second)).toBeUndefined();
    expect(await db().select().from(attachments).where(eq(attachments.id, attachmentId))).toHaveLength(0);
    expect(await env.BUCKET.head(rawKey)).toBeNull();
    expect(await env.BUCKET.head(attachmentKey)).toBeNull();
    // Spam, the other folders and the other person's Trash are untouched.
    for (const id of [ids.spam, ids.inbox, ids.archive, ids.sent, ids.snoozed, ids.drafts, bobs.trash]) {
      expect(await messageRow(id), id).toBeDefined();
    }
    // Again: nothing left.
    expect((await call('/api/messages/empty', { cookie, body: { folder: 'trash' } })).json).toEqual({
      success: true,
      deleted: 0,
      more: false
    });
  });

  it('empties Spam the same way', async () => {
    const { cookie, ids } = await seed();
    const answer = await call<{ deleted: number }>('/api/messages/empty', { cookie, body: { folder: 'spam' } });
    expect(answer.json.deleted).toBe(1);
    expect(await messageRow(ids.spam)).toBeUndefined();
    expect(await messageRow(ids.trash)).toBeDefined();
  });

  it('works through more mail than one D1 statement can bind', async () => {
    const { alice, cookie } = await seed();
    await Promise.all(Array.from({ length: 170 }, () => addMessage(alice.id, { folder: 'trash' })));
    const answer = await call<{ deleted: number; more: boolean }>('/api/messages/empty', { cookie, body: { folder: 'trash' } });
    expect(answer.json).toEqual({ success: true, deleted: 171, more: false });
  });

  it('refuses any other folder and a malformed body', async () => {
    const { cookie, ids } = await seed();
    for (const folder of ['inbox', 'archive', 'all', 'drafts', 'TRASH', '', 1, null]) {
      const answer = await call('/api/messages/empty', { cookie, body: { folder } });
      expect(answer.status, String(folder)).toBe(400);
      expect(answer.json, String(folder)).toMatchObject({ code: 'invalid_request', error: 'folder must be trash or spam' });
    }
    expect((await call('/api/messages/empty', { cookie, body: '[]' })).status).toBe(400);
    expect(await messageRow(ids.inbox)).toBeDefined();
  });

  it('is refused signed out', async () => {
    expect((await call('/api/messages/empty', { body: { folder: 'trash' } })).status).toBe(401);
  });
});
