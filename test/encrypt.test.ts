import { env } from 'cloudflare:workers';
import { createExecutionContext, createScheduledController, waitOnExecutionContext } from 'cloudflare:test';
import { and, eq, inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { encryptLegacyMail, legacyRowsLeft } from '../src/worker/encrypt-job';
import type { Env } from '../src/worker/types';
import { fromBase64Url } from '../src/shared/crypto/server';
import { attachments, messages, settings, users } from '../src/worker/db/schema';
import worker from '../src/worker/index';
import { rewrapPending } from '../src/worker/mail/pending';
import {
  addMessage,
  call,
  createUser,
  db,
  deliverMail,
  openObject,
  openRow,
  rawMail,
  must,
  setupKeysWithPair,
  signIn,
  testEnv
} from './helpers';
import type { TestUser } from './helpers';

// Pending mail (an owner without a key yet) and the encryption job for mail that existed before encryption: both end with every row sealed to
// its owner's key, objects under em1/, nothing in plaintext, and neither can lose or duplicate a message.

const rows = () => db().select().from(messages);
const listKeys = async (): Promise<string[]> => (await env.BUCKET.list()).objects.map((object) => object.key).toSorted();

async function runCron(overrides: Partial<Env> = {}): Promise<void> {
  const ctx = createExecutionContext();
  worker.scheduled(createScheduledController({ scheduledTime: Date.now(), cron: '* * * * *' }), testEnv(overrides), ctx);
  await waitOnExecutionContext(ctx);
}

/** A user who has not set up keys yet: the way a member created by an admin starts. */
const keyless = (email: string, extra: Record<string, unknown> = {}) => createUser(email, { keys: false, ...extra });

/** Gives a keyless user a fresh key pair the way a key setup would, directly in D1 (the endpoint is tested in keys.test.ts). */
async function grantKeys(user: TestUser): Promise<TestUser> {
  const { request, keys } = await setupKeysWithPair(user.email);
  await db()
    .update(users)
    .set({
      public_key: request.public_key,
      key_id: request.key_id,
      wrapped_private_key_pw: request.wrapped_private_key_pw,
      wrapped_private_key_recovery: request.wrapped_private_key_recovery,
      recovery_verifier: 'x',
      recovery_salt: 'x',
      recovery_iterations: 1,
      keys_version: 1
    })
    .where(eq(users.id, user.id));
  return { ...user, keys };
}

async function legacyMail(
  user: TestUser,
  subject: string,
  options: { attachment?: boolean; folder?: 'inbox' | 'drafts' | 'sent' } = {}
): Promise<string> {
  const id = crypto.randomUUID();
  const rawKey = `raw/${id}.eml`;
  await env.BUCKET.put(rawKey, `raw mail of ${subject}`);
  await db()
    .insert(messages)
    .values({
      id,
      user_id: user.id,
      from_address: 'sender@example.org',
      to_address: user.email,
      subject,
      snippet: `snippet of ${subject}`,
      body_text: `text of ${subject}`,
      body_html: `<p>html of ${subject}</p>`,
      r2_key: rawKey,
      folder: options.folder ?? 'inbox',
      has_attachments: options.attachment === true ? 1 : 0,
      created_at: Date.now(),
      updated_at: Date.now()
    });
  if (options.attachment === true) {
    const attachmentId = crypto.randomUUID();
    await env.BUCKET.put(`attachments/${id}/${attachmentId}`, `file of ${subject}`);
    await db()
      .insert(attachments)
      .values({
        id: attachmentId,
        message_id: id,
        filename: `${subject}.txt`,
        mime_type: 'text/plain',
        size: 5,
        r2_key: `attachments/${id}/${attachmentId}`,
        content_id: '<cid-1>',
        created_at: Date.now()
      });
  }
  return id;
}

describe('pending mail', () => {
  it('is sealed under the server key for an owner without keys, in the owner part of the bucket, and never as plaintext', async () => {
    const user = await keyless('alex@example.com');
    expect((await deliverMail(user.email, rawMail({ to: user.email, subject: 'Hello pending' }))).rejected).toBeUndefined();
    const [row] = await rows();
    expect(row).toMatchObject({
      user_id: user.id,
      enc_fmt: 1,
      wrap_kind: 'server',
      key_id: null,
      subject: null,
      snippet: null,
      body_text: null,
      body_html: null
    });
    expect(row.r2_key).toBe(`em1/${user.id}/${row.id}/raw`);
    expect(JSON.stringify(row)).not.toContain('Hello pending');
    expect(await listKeys()).toEqual([`em1/${user.id}/${row.id}/raw`]);
  });

  it('is refused, not stored in plaintext, when there is no usable DATA_KEY: for a keyless owner and for mail before Setup', async () => {
    const user = await keyless('alex@example.com');
    for (const DATA_KEY of [undefined, 'not a key']) {
      const refused = await deliverMail(user.email, rawMail({ to: user.email }), { DATA_KEY });
      expect(refused.rejected, String(DATA_KEY)).toBe('Message could not be processed');
    }
    expect(await rows()).toHaveLength(0);
    expect(await listKeys()).toEqual([]);
    await db().delete(users);
    expect((await deliverMail('anyone@example.com', rawMail({ to: 'anyone@example.com' }), { DATA_KEY: undefined })).rejected).toBe(
      'Message could not be processed'
    );
    expect(await rows()).toHaveLength(0);
  });

  it('does not need DATA_KEY for an owner who has keys (zero-access mail never touches it)', async () => {
    const user = await createUser('alex@example.com');
    expect(
      (await deliverMail(user.email, rawMail({ to: user.email, subject: 'Zero access' }), { DATA_KEY: undefined })).rejected
    ).toBeUndefined();
    const [row] = await rows();
    expect(row).toMatchObject({ wrap_kind: 'user', key_id: user.keys?.keyId });
    expect(await openRow(row, user)).toMatchObject({ subject: 'Zero access' });
  });

  it('is sealed to the owner the moment they have a key: right after the key setup, idempotently, and openable only with that key', async () => {
    const user = await keyless('alex@example.com');
    for (const subject of ['one', 'two', 'three']) {
      await deliverMail(user.email, rawMail({ to: user.email, subject }));
    }
    const withKeys = await grantKeys(user);
    // the same call the key-setup route runs after its response
    expect(await rewrapPending(testEnv(), user.id)).toBe(3);
    expect(await rewrapPending(testEnv(), user.id)).toBe(0);
    const sealed = await rows();
    expect(sealed.map((row) => [row.wrap_kind, row.key_id])).toEqual([1, 2, 3].map(() => ['user', withKeys.keys?.keyId]));
    expect(await Promise.all(sealed.map(async (row) => (await openRow(row, withKeys)).subject))).toEqual(['one', 'two', 'three']);
  });

  it('is handled in chunks by the cron for a backlog, and not at all without DATA_KEY', async () => {
    const user = await keyless('alex@example.com');
    for (let index = 0; index < 5; index += 1) {
      await deliverMail(user.email, rawMail({ to: user.email, subject: `mail ${index}` }));
    }
    await grantKeys(user);
    await runCron({ DATA_KEY: undefined });
    expect((await rows()).filter((row) => row.wrap_kind === 'server')).toHaveLength(5);
    expect(await rewrapPending(testEnv(), undefined, 2)).toBe(2);
    await runCron();
    expect((await rows()).filter((row) => row.wrap_kind === 'server')).toHaveLength(0);
  });

  it('keeps pending mail readable through a DATA_KEY rotation', async () => {
    const user = await keyless('alex@example.com');
    await deliverMail(user.email, rawMail({ to: user.email, subject: 'rotating' }));
    const withKeys = await grantKeys(user);
    const rotated = { DATA_KEY: env.TEST_PREVIOUS_DATA_KEY, DATA_KEY_PREVIOUS: env.DATA_KEY };
    expect(await rewrapPending(testEnv(rotated), user.id)).toBe(1);
    expect(await openRow((await rows())[0], withKeys)).toMatchObject({ subject: 'rotating' });
    // with the old key dropped, a value that was still sealed under it would be lost: nothing is left to lose here
    const lost = await keyless('lost@example.com');
    await deliverMail(lost.email, rawMail({ to: lost.email }));
    await grantKeys(lost);
    expect(await rewrapPending(testEnv({ DATA_KEY: env.TEST_PREVIOUS_DATA_KEY }), lost.id)).toBe(0);
  });
});

describe('the encryption job for mail from before encryption (D10)', () => {
  it('converts rows with their raw copy and attachments, nulls the plaintext, moves the objects under em1/ and deletes the old ones', async () => {
    const user = await createUser('alex@example.com');
    const inbox = await legacyMail(user, 'Quarterly', { attachment: true });
    const draft = await legacyMail(user, 'Draft one', { folder: 'drafts' });
    expect(await legacyRowsLeft(db())).toBe(2);
    const result = await encryptLegacyMail(testEnv());
    expect(result).toEqual({ converted: 2, remaining: 0 });

    const converted = must((await rows()).find((row) => row.id === inbox));
    expect(converted).toMatchObject({
      enc_fmt: 1,
      wrap_kind: 'user',
      key_id: user.keys?.keyId,
      subject: null,
      snippet: null,
      body_text: null,
      body_html: null
    });
    expect(converted.r2_key).toBe(`em1/${user.id}/${inbox}/raw`);
    expect(await openRow(converted, user)).toEqual({
      subject: 'Quarterly',
      snippet: 'snippet of Quarterly',
      text: 'text of Quarterly',
      html: '<p>html of Quarterly</p>'
    });
    expect(
      new TextDecoder().decode(
        await openObject(converted, user, 'raw', new Uint8Array(await must(await env.BUCKET.get(must(converted.r2_key))).arrayBuffer()))
      )
    ).toBe('raw mail of Quarterly');
    const [file] = await db().select().from(attachments).where(eq(attachments.message_id, inbox));
    expect(file).toMatchObject({ filename: '', mime_type: '', content_id: null, r2_key: `em1/${user.id}/${inbox}/att/${file.id}` });
    const meta = JSON.parse(
      new TextDecoder().decode(await openObject(converted, user, `att-meta/${file.id}`, fromBase64Url(must(file.meta_blob))))
    ) as Record<string, unknown>;
    expect(meta).toEqual({ filename: 'Quarterly.txt', mime_type: 'text/plain', content_id: '<cid-1>' });
    // nothing of the old layout is left: the done criterion lists the legacy prefixes (expected empty) and the plaintext rows (expected 0)
    expect((await listKeys()).every((key) => key.startsWith('em1/'))).toBe(true);
    expect(await legacyRowsLeft(db())).toBe(0);
    expect((await rows()).find((row) => row.id === draft)?.enc_fmt).toBe(1);
    // the download of the converted mail works through the normal routes
    const raw = await call(`/api/raw/${inbox}`, { cookie: await signIn(user) });
    expect(raw.status).toBe(200);
    expect(raw.headers.get('Content-Type')).toBe('application/octet-stream');
  });

  it('is idempotent and resumable: a chunk of one row per run converts one row at a time, a second pass finds nothing', async () => {
    const user = await createUser('alex@example.com');
    const ids = [await legacyMail(user, 'a'), await legacyMail(user, 'b'), await legacyMail(user, 'c')];
    const tune = testEnv({ ENCRYPT_CHUNK_ROWS: '1' });
    expect(await encryptLegacyMail(tune)).toEqual({ converted: 1, remaining: 2 });
    // killed between runs: what is left is still plaintext and readable, never half-converted
    const remaining = (await rows()).filter((row) => row.enc_fmt === 0);
    expect(remaining).toHaveLength(2);
    expect(remaining.every((row) => row.subject !== null && row.wrapped_cek === null)).toBe(true);
    expect(await encryptLegacyMail(tune)).toEqual({ converted: 1, remaining: 1 });
    expect(await encryptLegacyMail(tune)).toEqual({ converted: 1, remaining: 0 });
    expect(await encryptLegacyMail(tune)).toEqual({ converted: 0, remaining: 0 });
    expect(await db().select({ id: messages.id }).from(messages).where(inArray(messages.id, ids))).toHaveLength(3);
    expect((await listKeys()).length).toBe(3);
  });

  it('runs from the cron, and leaves an owner without a key alone until they have one', async () => {
    const waiting = await keyless('waiting@example.com');
    const ready = await createUser('ready@example.com');
    await legacyMail(waiting, 'waiting');
    await legacyMail(ready, 'ready');
    await runCron();
    expect(
      (await rows())
        .map((row) => [row.user_id === ready.id, row.enc_fmt] as [boolean, number])
        .toSorted((a, b) => Number(a[0]) - Number(b[0]))
    ).toEqual([
      [false, 0],
      [true, 1]
    ]);
    expect(await legacyRowsLeft(db())).toBe(1);
    const woken = await grantKeys(waiting);
    await runCron();
    expect(await legacyRowsLeft(db())).toBe(0);
    const now = must((await rows()).find((row) => row.user_id === waiting.id));
    expect(await openRow(now, woken)).toMatchObject({ subject: 'waiting' });
  });

  it('is single-flight: a live lease stops a second run, an expired one does not', async () => {
    const user = await createUser('alex@example.com');
    await legacyMail(user, 'locked');
    await db()
      .insert(settings)
      .values({ key: 'encrypt_lease', value: String(Date.now() + 120_000), updated_at: Date.now() });
    expect(await encryptLegacyMail(testEnv())).toEqual({ converted: 0, remaining: 1 });
    await db()
      .update(settings)
      .set({ value: String(Date.now() - 1) })
      .where(eq(settings.key, 'encrypt_lease'));
    expect(await encryptLegacyMail(testEnv())).toEqual({ converted: 1, remaining: 0 });
    // the lease is released when the run ends
    expect(Number((await db().select().from(settings).where(eq(settings.key, 'encrypt_lease')).get())?.value)).toBe(0);
  });

  it('changes nothing for a row it cannot convert (a failing bucket) and converts it on the next run', async () => {
    const user = await createUser('alex@example.com');
    const id = await legacyMail(user, 'flaky');
    const failing = new Proxy(env.BUCKET, {
      get(target, property) {
        if (property === 'put') {
          return () => Promise.reject(new Error('boom flaky'));
        }
        const value: unknown = Reflect.get(target, property);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      }
    });
    expect((await encryptLegacyMail(testEnv({ BUCKET: failing }))).converted).toBe(0);
    const [row] = await rows();
    expect(row).toMatchObject({ id, enc_fmt: 0, subject: 'flaky', wrapped_cek: null });
    expect(await listKeys()).toEqual([`raw/${id}.eml`]);
    expect((await encryptLegacyMail(testEnv())).converted).toBe(1);
  });

  it('does not touch a row that was converted by somebody else while it worked (guarded by enc_fmt = 0)', async () => {
    const user = await createUser('alex@example.com');
    const id = await legacyMail(user, 'raced');
    // another writer converts the row between the read and the batch: the Proxy does it right after the first object is written
    let raced = false;
    const racing = new Proxy(env.BUCKET, {
      get(target, property) {
        if (property === 'put') {
          return async (...args: Parameters<R2Bucket['put']>) => {
            const written = await target.put(...args);
            if (!raced) {
              raced = true;
              await db()
                .update(messages)
                .set({ enc_fmt: 1, subject: null, wrapped_cek: 'winner', wrap_kind: 'user', key_id: user.keys?.keyId ?? null })
                .where(and(eq(messages.id, id), eq(messages.enc_fmt, 0)));
            }
            return written;
          };
        }
        const value: unknown = Reflect.get(target, property);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      }
    });
    expect((await encryptLegacyMail(testEnv({ BUCKET: racing }))).converted).toBe(0);
    expect((await rows())[0]).toMatchObject({ enc_fmt: 1, wrapped_cek: 'winner' });
    // the legacy object is kept (the winner owns the cleanup), nothing of the loser changed the row
    expect(await listKeys()).toContain(`raw/${id}.eml`);
  });

  it('removes the plaintext objects a conversion left behind once no plaintext row is left, never one a row points at, and then stops looking', async () => {
    const user = await createUser('alex@example.com');
    await legacyMail(user, 'converted');
    // a crash between "row flipped" and "old objects deleted" leaves copies nothing points at; one old-layout key is still in use by a row
    await addMessage(user.id, { enc_fmt: 1, wrap_kind: 'user', key_id: user.keys?.keyId, r2_key: 'raw/kept.eml' });
    await env.BUCKET.put('raw/kept.eml', 'still referenced');
    for (const key of ['raw/orphan.eml', 'sent/orphan.eml', 'attachments/orphan/file']) {
      await env.BUCKET.put(key, 'plaintext copy');
    }
    let lists = 0;
    const counting = new Proxy(env.BUCKET, {
      get(target, property) {
        if (property === 'list') {
          return (...args: Parameters<R2Bucket['list']>) => {
            lists += 1;
            return target.list(...args);
          };
        }
        const value: unknown = Reflect.get(target, property);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      }
    });
    expect((await encryptLegacyMail(testEnv({ BUCKET: counting }))).remaining).toBe(0);
    expect((await listKeys()).filter((key) => !key.startsWith('em1/'))).toEqual(['raw/kept.eml']);
    // that pass found something, so the next one looks again, finds nothing and records that; after it the job no longer lists the bucket
    expect(lists).toBe(3);
    await encryptLegacyMail(testEnv({ BUCKET: counting }));
    expect(lists).toBe(6);
    await encryptLegacyMail(testEnv({ BUCKET: counting }));
    expect(lists).toBe(6);
    expect((await listKeys()).filter((key) => !key.startsWith('em1/'))).toEqual(['raw/kept.eml']);
  });

  it('keeps an old-layout object that only an attachment row points at, and still removes the one nothing points at', async () => {
    const user = await createUser('alex@example.com');
    // A converted message whose raw copy is under em1/, so nothing waits for conversion, and whose attachment row still carries an old-layout key:
    // attachments.r2_key is the only reference to that object (the sweep must read it as well as messages.r2_key).
    const id = await addMessage(user.id, { enc_fmt: 1, wrap_kind: 'user', key_id: user.keys?.keyId, r2_key: 'em1/kept/message/raw' });
    await db().insert(attachments).values({
      id: crypto.randomUUID(),
      message_id: id,
      filename: '',
      mime_type: '',
      size: 5,
      r2_key: 'attachments/kept/file',
      created_at: Date.now()
    });
    await env.BUCKET.put('attachments/kept/file', 'still referenced by an attachment row');
    await env.BUCKET.put('attachments/orphan/file', 'plaintext copy');
    expect(await legacyRowsLeft(db())).toBe(0);
    await encryptLegacyMail(testEnv());
    // the sweep ran (the orphan is gone) and left the referenced object alone
    expect((await listKeys()).filter((key) => !key.startsWith('em1/'))).toEqual(['attachments/kept/file']);
    expect(await (await env.BUCKET.get('attachments/kept/file'))?.text()).toBe('still referenced by an attachment row');
  });

  it('keeps the old objects while a plaintext row is still waiting (an owner without a key)', async () => {
    const waiting = await keyless('waiting@example.com');
    const id = await legacyMail(waiting, 'waiting');
    await env.BUCKET.put('raw/orphan.eml', 'plaintext copy');
    await encryptLegacyMail(testEnv());
    expect(await listKeys()).toEqual([`raw/${id}.eml`, 'raw/orphan.eml']);
  });

  it('answers a tuning value outside 1..500 with the default or the nearest bound', async () => {
    const user = await createUser('alex@example.com');
    for (let index = 0; index < 30; index += 1) {
      await legacyMail(user, `m${index}`);
    }
    expect((await encryptLegacyMail(testEnv({ ENCRYPT_CHUNK_ROWS: 'many' }))).converted).toBe(25);
    expect((await encryptLegacyMail(testEnv({ ENCRYPT_CHUNK_ROWS: '0' }))).converted).toBe(1);
    expect((await encryptLegacyMail(testEnv({ ENCRYPT_CHUNK_ROWS: '9999' }))).converted).toBe(4);
  }, 60_000);
});
