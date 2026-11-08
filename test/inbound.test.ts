import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { attachments, messages } from '../src/worker/db/schema';
import { fromBase64Url } from '../src/shared/crypto/server';
import {
  authFor,
  call,
  cookieOf,
  createUser,
  DEFAULT_PASSWORD,
  db,
  deliverMail,
  enrollTotp,
  openObject,
  openRow,
  rawMail,
  setupKeysWithPair,
  signIn
} from './helpers';

// AC16: inbound mail is delivered by the envelope recipient; anything nobody owns is rejected and leaves nothing behind.

const allMessages = () => db().select().from(messages);
const objectCount = async (): Promise<number> => (await env.BUCKET.list()).objects.length;

describe('inbound routing by envelope recipient (AC16)', () => {
  it('delivers to the owner of a primary address, an alias, and a +tag / upper-case form of either', async () => {
    const alice = await createUser('alice@example.com', { aliases: ['sales@example.com', 'help@example.org'] });
    const bob = await createUser('bob@example.com');
    const cases: [string, string][] = [
      ['alice@example.com', alice.id],
      ['sales@example.com', alice.id],
      ['help@example.org', alice.id],
      ['Alice+news@Example.COM', alice.id],
      ['  SALES+promo+x@example.com ', alice.id],
      ['bob@example.com', bob.id]
    ];
    for (const [to, owner] of cases) {
      const delivery = await deliverMail(to, rawMail({ to, subject: `for ${to}` }));
      expect(delivery.rejected, to).toBeUndefined();
      const stored = (await allMessages()).at(-1);
      expect(stored?.user_id, to).toBe(owner);
      expect(stored?.folder).toBe('inbox');
      expect(stored?.is_read).toBe(0);
    }
    expect(await allMessages()).toHaveLength(cases.length);
  });

  it('rejects an unknown address on a known domain and an unknown domain, and stores nothing', async () => {
    await createUser('alice@example.com');
    for (const to of ['nobody@example.com', 'alice@elsewhere.example.net', 'alice-twin@example.com', 'a@b', 'not an address', '']) {
      const delivery = await deliverMail(to, rawMail({ to, subject: 'should not be stored' }));
      expect(delivery.rejected, to).toBe('Unknown recipient');
    }
    expect(await allMessages()).toHaveLength(0);
    expect(await objectCount()).toBe(0);
  });

  it('strips the +tag only: a tag cannot make another address out of a different local part', async () => {
    const alice = await createUser('alice@example.com');
    await createUser('alice.smith@example.com');
    await deliverMail('alice+smith@example.com', rawMail({ to: 'x@example.com', subject: 'tagged' }));
    const [row] = await allMessages();
    expect(row.user_id).toBe(alice.id);
  });

  it('still delivers to a disabled user', async () => {
    const off = await createUser('off@example.com', { status: 'disabled' });
    expect((await deliverMail('off@example.com', rawMail({ to: 'off@example.com' }))).rejected).toBeUndefined();
    expect((await allMessages())[0]?.user_id).toBe(off.id);
  });

  it('stores the raw message, the attachments and their rows for the owner only', async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    const raw = [
      'From: Sender <sender@example.org>',
      'To: alice@example.com',
      'Subject: With a file',
      'Message-ID: <att-1@example.org>',
      'MIME-Version: 1.0',
      'Content-Type: multipart/mixed; boundary="b"',
      '',
      '--b',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'See the file.',
      '--b',
      'Content-Type: text/plain; name="note.txt"',
      'Content-Disposition: attachment; filename="note.txt"',
      'Content-Transfer-Encoding: base64',
      '',
      btoa('attachment content'),
      '--b--',
      ''
    ].join('\r\n');
    expect((await deliverMail('alice@example.com', raw)).rejected).toBeUndefined();
    const [row] = await allMessages();
    expect(row).toMatchObject({
      user_id: alice.id,
      has_attachments: 1,
      enc_fmt: 1,
      wrap_kind: 'user',
      r2_key: `em1/${alice.id}/${row.id}/raw`
    });
    expect(await env.BUCKET.get(row.r2_key ?? 'none')).not.toBeNull();
    const [file] = await db().select().from(attachments).where(eq(attachments.message_id, row.id));
    // The file name is inside the encrypted meta blob, not in a column or in the object's key
    expect(file).toMatchObject({ filename: '', mime_type: '', content_id: null, r2_key: `em1/${alice.id}/${row.id}/att/${file.id}` });
    const meta: unknown = JSON.parse(
      new TextDecoder().decode(await openObject(row, alice, `att-meta/${file.id}`, fromBase64Url(file.meta_blob ?? '')))
    );
    expect(meta).toMatchObject({ filename: 'note.txt', mime_type: 'text/plain' });
    const cookieB = await signIn(bob);
    expect((await call(`/api/attachments/${file.id}`, { cookie: cookieB })).status).toBe(404);
    const cookieA = await signIn(alice);
    const download = await call(`/api/attachments/${file.id}`, { cookie: cookieA });
    const sealed = new Uint8Array(await download.response.arrayBuffer());
    expect(new TextDecoder().decode(sealed)).not.toContain('attachment content');
    expect(new TextDecoder().decode(await openObject(row, alice, `att/${file.id}`, sealed))).toBe('attachment content');
  });

  it("threads a reply with the owner's own mail only", async () => {
    const alice = await createUser('alice@example.com');
    const bob = await createUser('bob@example.com');
    await deliverMail('bob@example.com', rawMail({ to: 'bob@example.com', messageId: '<root@example.org>' }));
    const reply = rawMail({ to: 'alice@example.com', messageId: '<reply@example.org>' }).replace(
      'Subject:',
      'In-Reply-To: <root@example.org>\r\nSubject:'
    );
    await deliverMail('alice@example.com', reply);
    const mine = (await allMessages()).find((row) => row.user_id === alice.id);
    expect(mine?.thread_id).toBe('<root@example.org>');
    // Alice has no mail with that id, so the reply starts its own thread rather than joining Bob's: its thread id is the in-reply-to id itself,
    // the same value Bob's root mail carries, but no row of Bob is read to get it.
    expect((await allMessages()).filter((row) => row.user_id === bob.id)).toHaveLength(1);
  });

  it('answers a real failure with the generic rejection, not the unknown-recipient one', async () => {
    await createUser('alice@example.com');
    const broken = {
      prepare: () => {
        throw new Error('database is down');
      }
    } as unknown as D1Database;
    const delivery = await deliverMail('alice@example.com', rawMail({ to: 'alice@example.com' }), { DB: broken });
    expect(delivery.rejected).toBe('Message could not be processed');
  });
});

describe('mail that arrives before the first-run setup (AC2)', () => {
  it('is accepted without an owner, is invisible to everyone, and belongs to the admin after setup', async () => {
    expect(
      (await deliverMail('anyone@example.com', rawMail({ to: 'anyone@example.com', subject: 'Early mail' }))).rejected
    ).toBeUndefined();
    const [early] = await allMessages();
    // No owner yet: stored encrypted under the server's key (pending), in the pending part of the bucket, never in plaintext
    expect(early).toMatchObject({ user_id: null, enc_fmt: 1, wrap_kind: 'server', key_id: null, subject: null, body_text: null });
    expect(early.r2_key).toBe(`em1/pending/${early.id}/raw`);
    expect(JSON.stringify(early)).not.toContain('Early mail');

    const { request, keys } = await setupKeysWithPair('admin@example.com');
    const setup = await call('/api/auth/setup', {
      body: {
        setup_key: env.APP_PASSWORD,
        email: 'admin@example.com',
        display_name: 'Admin',
        auth: await authFor('admin@example.com', DEFAULT_PASSWORD),
        kdf: 1,
        keys: request
      }
    });
    expect(setup.status).toBe(200);
    const { cookie } = await enrollTotp(cookieOf(setup), { auth: await authFor('admin@example.com', DEFAULT_PASSWORD) });
    // Adopted by the admin and sealed to the admin's key; the object keeps its pending name (the r2_key column is authoritative)
    const adopted = (await allMessages())[0];
    expect(adopted).toMatchObject({ wrap_kind: 'user', key_id: request.key_id, r2_key: `em1/pending/${early.id}/raw` });
    const list = await call<{ messages: (typeof adopted)[] }>('/api/messages?folder=inbox', { cookie });
    expect(list.json.messages.map((m) => m.id)).toEqual([early.id]);
    expect(list.json.messages[0]).not.toHaveProperty('body_blob');
    // The list carries the summary and the wrapped key; the body comes with the message itself
    const opened = await call<{ message: typeof adopted }>(`/api/messages/${early.id}`, { cookie });
    const content = await openRow(opened.json.message, { keys });
    expect(content.subject).toBe('Early mail');
    expect(content.text).toContain('Body text');
    // From now on an address nobody owns is rejected.
    expect((await deliverMail('anyone@example.com', rawMail({ to: 'anyone@example.com' }))).rejected).toBe('Unknown recipient');
  });
});
