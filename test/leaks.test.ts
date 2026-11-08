import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { attachments, messages } from '../src/worker/db/schema';
import { addMessage, call, createUser, db, deliverMail, rawMail, signIn } from './helpers';

// CR-15 / M8: nothing about a mail's content is written where it is not needed. R2 keys are UUIDs, objects carry no custom metadata and
// a generic content type, logs carry ids and error classes only, and a 500 never echoes an error message.

const FILE_NAME = 'secret-plan-ACME.pdf';
// em1/<user>/<row>/raw or em1/<user>/<row>/att/<attachment>: UUIDs only (legacy keys are only ever read, never written)
const KEY_PATTERN = /^em1\/[\da-f-]{36}\/[\da-f-]{36}\/(?:raw|att\/[\da-f-]{36})$/;

const mailWithAttachment = (to: string): string =>
  [
    'From: Sender <sender@example.org>',
    `To: ${to}`,
    'Subject: Quarterly numbers',
    'Message-ID: <leak-1@example.org>',
    'MIME-Version: 1.0',
    'Content-Type: multipart/mixed; boundary="b"',
    '',
    '--b',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'See the file.',
    '--b',
    `Content-Type: application/pdf; name="${FILE_NAME}"`,
    `Content-Disposition: attachment; filename="${FILE_NAME}"`,
    'Content-Transfer-Encoding: base64',
    '',
    btoa('pdf bytes'),
    '--b--',
    ''
  ].join('\r\n');

/** The real bucket with a write or a read that fails. */
const bucketWith = (failing: 'put' | 'get', error: Error): R2Bucket =>
  new Proxy(env.BUCKET, {
    get(target, property) {
      if (property === failing) {
        return () => Promise.reject(error);
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    }
  });

const loggedText = (spies: { mock: { calls: unknown[][] } }[]): string => JSON.stringify(spies.map((spy) => spy.mock.calls));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('what is stored in R2 for a mail (CR-15)', () => {
  it('uses UUID-only keys, no custom metadata and a generic content type for inbound mail', async () => {
    const alice = await createUser('alice@example.com');
    expect((await deliverMail('alice@example.com', mailWithAttachment('alice@example.com'))).rejected).toBeUndefined();
    const listing = await env.BUCKET.list();
    expect(listing.objects).toHaveLength(2);
    for (const object of listing.objects) {
      expect(object.key, object.key).toMatch(KEY_PATTERN);
      expect(object.key.toLowerCase()).not.toContain('secret');
      const head = await env.BUCKET.head(object.key);
      expect(Object.keys(head?.customMetadata ?? {}), object.key).toEqual([]);
      expect(head?.httpMetadata?.contentType, object.key).toBe('application/octet-stream');
    }
    // The file name is not in a column either (it is inside the encrypted meta blob), so a download cannot name the file.
    const [file] = await db().select().from(attachments);
    expect(file.filename).toBe('');
    expect(JSON.stringify(file)).not.toContain(FILE_NAME);
    const download = await call(`/api/attachments/${file.id}`, { cookie: await signIn(alice) });
    expect(download.status).toBe(200);
    expect(download.headers.get('Content-Type')).toBe('application/octet-stream');
    expect(download.headers.get('Content-Disposition')).not.toContain(FILE_NAME);
  });

  it('does the same for a sent mail with Bcc and an attachment', async () => {
    const alice = await createUser('alice@example.com');
    const binding = { send: () => Promise.resolve({ messageId: '<out-1@example.com>' }) } as unknown as SendEmail;
    const answer = await call('/api/messages/send', {
      cookie: await signIn(alice),
      env: { SEND_EMAIL: binding },
      body: {
        to: 'friend@example.org',
        bcc: ['hidden@example.org'],
        subject: 'Plan',
        text: 'See attached',
        attachments: [{ filename: FILE_NAME, content_type: 'application/pdf', content_base64: btoa('pdf bytes') }]
      }
    });
    expect(answer.status).toBe(200);
    const listing = await env.BUCKET.list();
    expect(listing.objects.map((object) => object.key.split('/', 1)[0]).toSorted()).toEqual(['em1', 'em1']);
    for (const object of listing.objects) {
      expect(object.key, object.key).toMatch(KEY_PATTERN);
      const head = await env.BUCKET.head(object.key);
      expect(Object.keys(head?.customMetadata ?? {}), object.key).toEqual([]);
      expect(head?.httpMetadata?.contentType, object.key).toBe('application/octet-stream');
    }
  });
});

describe('what is logged and answered when storage fails (CR-15, M8)', () => {
  it('logs no file name, address or error text when an R2 write fails; a lost attachment rejects the mail, a lost raw copy does not', async () => {
    await createUser('alice@example.com');
    const logs = [vi.spyOn(console, 'error'), vi.spyOn(console, 'log'), vi.spyOn(console, 'warn')];
    const failing = bucketWith('put', new Error(`boom ${FILE_NAME} sender@example.org`));
    // An attachment that cannot be stored: the sending server is told to retry, and nothing is left behind (no row, no object).
    const refused = await deliverMail('alice@example.com', mailWithAttachment('alice@example.com'), { BUCKET: failing });
    expect(refused.rejected).toBe('Message could not be processed');
    expect(await db().select().from(messages)).toHaveLength(0);
    // Only the raw copy cannot be stored: the mail itself is kept, without its raw copy.
    const delivery = await deliverMail('alice@example.com', rawMail({ to: 'alice@example.com', subject: 'Quarterly numbers' }), {
      BUCKET: failing
    });
    expect(delivery.rejected).toBeUndefined();
    const text = loggedText(logs);
    expect(text).toContain('Could not store');
    for (const secret of [FILE_NAME, 'secret-plan', 'boom', 'sender@example.org', 'Quarterly numbers', 'alice@example.com']) {
      expect(text, secret).not.toContain(secret);
    }
    const [row] = await db().select().from(messages);
    expect(row.r2_key).toBeNull();
  });

  it('answers a failing download with fixed text and logs no error message', async () => {
    const alice = await createUser('alice@example.com');
    const mail = await addMessage(alice.id, { r2_key: 'raw/x.eml' });
    const attachmentId = crypto.randomUUID();
    await db().insert(attachments).values({
      id: attachmentId,
      message_id: mail,
      filename: FILE_NAME,
      mime_type: 'application/pdf',
      size: 1,
      r2_key: 'attachments/x/y',
      created_at: Date.now()
    });
    const logs = [vi.spyOn(console, 'error')];
    const failing = bucketWith('get', new Error(`boom ${FILE_NAME}`));
    const cookie = await signIn(alice);

    const raw = await call(`/api/raw/${mail}`, { cookie, env: { BUCKET: failing } });
    const file = await call(`/api/attachments/${attachmentId}`, { cookie, env: { BUCKET: failing } });
    expect([raw.status, raw.text]).toEqual([500, 'Raw message could not be read']);
    expect([file.status, file.text]).toEqual([500, 'Attachment could not be read']);
    expect(loggedText(logs)).not.toContain('boom');
    expect(loggedText(logs)).not.toContain(FILE_NAME);
    expect(await db().select().from(messages).where(eq(messages.id, mail))).toHaveLength(1);
  });

  it('logs only the error class when a route fails unexpectedly (the shared handler), for a failing D1 read and a failing D1 write', async () => {
    const alice = await createUser('alice@example.com');
    const mail = await addMessage(alice.id);
    const cookie = await signIn(alice);
    const logs = [vi.spyOn(console, 'error'), vi.spyOn(console, 'log'), vi.spyOn(console, 'warn')];
    // D1 whose statements on the mail table fail with a message that holds a marker, an address and a submitted value
    const message = `boom ${FILE_NAME} alice@example.com ${mail}`;
    const failingDb = new Proxy(env.DB, {
      get(target, property) {
        if (property === 'prepare') {
          return (query: string) => {
            if (/(?:from|update) "messages"/i.test(query)) {
              throw new Error(message);
            }
            return target.prepare(query);
          };
        }
        const value: unknown = Reflect.get(target, property);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      }
    });

    const read = await call('/api/messages?folder=inbox', { cookie, env: { DB: failingDb } });
    const write = await call('/api/messages/batch', { cookie, env: { DB: failingDb }, body: { action: 'star', message_ids: [mail] } });
    expect([read.status, read.json.code]).toEqual([500, 'server_error']);
    expect([write.status, write.json.code]).toEqual([500, 'server_error']);
    const text = loggedText(logs);
    expect(text).toContain('failed:');
    for (const secret of ['boom', FILE_NAME, 'alice@example.com', mail]) {
      expect(text, secret).not.toContain(secret);
      expect(read.text + write.text, secret).not.toContain(secret);
    }
  });
});
