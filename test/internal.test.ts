import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { decodeCanonical } from '../src/shared/crypto/server';
import { attachments, messages } from '../src/worker/db/schema';
import { rewrapPending } from '../src/worker/mail/pending';
import {
  call,
  createUser,
  db,
  decryptPush,
  draftBody,
  fakePushService,
  must,
  openObject,
  openRow,
  signIn,
  subscribeDevice,
  testEnv,
  waitUntil
} from './helpers';
import { internalBody, rotateKeys, sealedFor } from './internal-helpers';

// POST /api/messages/internal (reports/e2e-contract.md): one independent sealed copy per person plus the sender's Sent copy.

const SUBJECT = 'ACME acquisition: the number is 41 million';
const TEXT = 'Please do not forward the offer letter.';
const FILE = new TextEncoder().encode('offer letter, strictly confidential');

interface Sent {
  success: boolean;
  e2e: boolean;
  message: {
    id: string;
    folder: string;
    from_address: string;
    from_name: string;
    to_address: string;
    cc: string | null;
    bcc: string | null;
    is_e2e: number;
  };
  copies: { address: string; id: string; sealed: boolean }[];
  code?: string;
  keys?: { address: string; internal: boolean; public_key?: string; key_id?: string }[];
  own_key?: { key_id: string };
}

const send = (cookie: string, body: unknown, env_: Parameters<typeof call>[1] = {}) =>
  call<Sent>('/api/messages/internal', { cookie, body, ...env_ });
const allRows = () => db().select().from(messages);
const rowOf = async (userId: string) =>
  must(
    (await allRows()).find((row) => row.user_id === userId),
    'row'
  );
const bytesOf = async (key: string): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(await must(await env.BUCKET.get(key), key).arrayBuffer());
const latin1 = (bytes: Uint8Array): string => Array.from(bytes, (byte) => String.fromCodePoint(byte)).join('');
const bucketCount = async (): Promise<number> => (await env.BUCKET.list()).objects.length;

afterEach(() => {
  vi.restoreAllMocks();
});

async function trio() {
  const alice = await createUser('alice@example.com', { display_name: 'Alice A' });
  const bob = await createUser('bob@example.com');
  const carol = await createUser('carol@example.com');
  return { alice, bob, carol, cookie: await signIn(alice) };
}

describe('an end-to-end message: one sealed copy per person, one for the sender', () => {
  it('stores each copy sealed to its person, lists Bcc only in the Sent row, never calls SEND_EMAIL and tells recipients only the sender and ids', async () => {
    const { alice, bob, carol, cookie } = await trio();
    const dave = await createUser('dave@example.com');
    const push = fakePushService();
    const device = await subscribeDevice(await signIn(bob), 'bob-phone');
    const sendSpy = vi.fn();
    const binding = { send: sendSpy } as unknown as SendEmail;

    const answer = await send(
      cookie,
      await internalBody(alice, { to: [bob], cc: [carol], bcc: [dave] }, { subject: SUBJECT, text: TEXT }),
      { env: { SEND_EMAIL: binding } }
    );
    expect(answer.status).toBe(200);
    expect(answer.json).toMatchObject({
      success: true,
      e2e: true,
      message: {
        folder: 'sent',
        from_address: 'alice@example.com',
        from_name: 'Alice A',
        is_e2e: 1,
        to_address: 'bob@example.com',
        cc: 'carol@example.com',
        bcc: 'dave@example.com'
      }
    });
    expect(answer.json.copies.map((copy) => [copy.address, copy.sealed])).toEqual([
      ['bob@example.com', true],
      ['carol@example.com', true],
      ['dave@example.com', true]
    ]);
    expect(sendSpy).not.toHaveBeenCalled();

    const rows = await allRows();
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((row) => row.message_id)).size).toBe(1);
    expect(new Set(rows.map((row) => row.wrapped_cek)).size).toBe(4);
    for (const row of rows) {
      expect(row).toMatchObject({
        enc_fmt: 1,
        wrap_kind: 'user',
        is_e2e: 1,
        r2_key: null,
        subject: null,
        snippet: null,
        body_text: null,
        body_html: null
      });
      expect(row.from_address).toBe('alice@example.com');
    }
    const mine = await rowOf(alice.id);
    expect([mine.folder, mine.is_read, mine.bcc]).toEqual(['sent', 1, 'dave@example.com']);
    for (const person of [bob, carol, dave]) {
      const row = await rowOf(person.id);
      expect([row.folder, row.is_read, row.bcc, row.to_address, row.cc]).toEqual([
        'inbox',
        0,
        null,
        'bob@example.com',
        'carol@example.com'
      ]);
      expect(row.id).toBe(answer.json.copies.find((copy) => copy.address === person.email)?.id);
    }
    // each person opens their own copy with their own key, and nobody else's key opens it
    for (const person of [alice, bob, carol, dave]) {
      expect(await openRow(await rowOf(person.id), person)).toMatchObject({ subject: SUBJECT, text: TEXT });
    }
    await expect(openRow(await rowOf(carol.id), bob)).rejects.toThrow();

    // the notification carries the sender's name and nothing about the content
    await waitUntil(() => push.posted.length === 1);
    const payload = await decryptPush(must(push.bodies[0]), device);
    expect(payload).toMatchObject({ title: 'Alice A', body: '' });
    expect(JSON.stringify(payload)).not.toContain('ACME');
  });

  it('stores sealed attachments as R2 objects of their own copy, openable only by that person, with the description sealed too', async () => {
    const { alice, bob, cookie } = await trio();
    const files = [
      { name: 'offer.pdf', mime: 'application/pdf', bytes: FILE },
      { name: 'plan.txt', bytes: new TextEncoder().encode('second file') }
    ];
    const answer = await send(cookie, await internalBody(alice, { to: [bob] }, { subject: SUBJECT, text: TEXT, files }));
    expect(answer.status).toBe(200);

    const rows = await db().select().from(attachments);
    expect(rows).toHaveLength(4);
    const bobRow = await rowOf(bob.id);
    expect(bobRow.has_attachments).toBe(1);
    const bobFiles = rows.filter((row) => row.message_id === bobRow.id);
    for (const row of bobFiles) {
      expect(row).toMatchObject({
        filename: '',
        mime_type: '',
        content_id: null,
        is_inline: 0
      });
      expect(row.r2_key).toMatch(new RegExp(String.raw`^em1/${bob.id}/${bobRow.id}/att/${row.id}/[\da-f-]{36}$`));
    }
    expect(bobFiles.map((row) => row.size).toSorted((a, b) => a - b)).toEqual(
      files.map((file) => file.bytes.length).toSorted((a, b) => a - b)
    );
    expect((await env.BUCKET.list()).objects.map((object) => object.key).toSorted()).toEqual(rows.map((row) => row.r2_key).toSorted());

    const first = must(bobFiles.find((row) => row.size === FILE.length));
    const download = await call(`/api/attachments/${first.id}`, { cookie: await signIn(bob) });
    expect(download.status).toBe(200);
    const sealed = new Uint8Array(await download.response.clone().arrayBuffer());
    expect(await openObject(bobRow, bob, `att/${first.id}`, sealed)).toEqual(FILE);
    const meta = JSON.parse(
      new TextDecoder().decode(await openObject(bobRow, bob, `att-meta/${first.id}`, must(decodeCanonical(first.meta_blob))))
    ) as Record<string, unknown>;
    expect(meta).toEqual({ filename: 'offer.pdf', mime_type: 'application/pdf', content_id: null });
    // somebody else's attachment id is "not found", exactly like one that does not exist
    expect((await call(`/api/attachments/${first.id}`, { cookie })).status).toBe(404);
  });

  it('writes no plaintext anywhere: not in D1 columns, not in R2 objects, not in the log', async () => {
    const { alice, bob, carol, cookie } = await trio();
    const logs = [vi.spyOn(console, 'log'), vi.spyOn(console, 'error'), vi.spyOn(console, 'warn')];
    const answer = await send(
      cookie,
      await internalBody(
        alice,
        { to: [bob], cc: [carol] },
        { subject: SUBJECT, text: TEXT, html: '<p>CONFIDENTIAL-HTML</p>', files: [{ name: 'offer-ACME.pdf', bytes: FILE }] }
      )
    );
    expect(answer.status).toBe(200);
    const stored = JSON.stringify([await allRows(), await db().select().from(attachments)]);
    const objects = await Promise.all((await env.BUCKET.list()).objects.map(async (object) => latin1(await bytesOf(object.key))));
    const logged = JSON.stringify(logs.map((spy) => spy.mock.calls));
    for (const marker of ['ACME', 'forward the offer', 'CONFIDENTIAL-HTML', 'offer letter', 'offer-ACME']) {
      expect(stored, marker).not.toContain(marker);
      expect(objects.join('\n'), marker).not.toContain(marker);
      expect(logged, marker).not.toContain(marker);
    }
    expect(objects).toHaveLength(3);
  });
});

describe('a recipient whose key changed (key_changed)', () => {
  it('answers 409 with the fresh keys, stores nothing, and works with a copy sealed to the new key', async () => {
    const { alice, bob, cookie } = await trio();
    const stale = await internalBody(alice, { to: [bob] }, { subject: SUBJECT, text: TEXT, files: [{ name: 'f', bytes: FILE }] });
    const fresh = await rotateKeys(bob);

    const refused = await send(cookie, stale);
    expect(refused.status).toBe(409);
    expect(refused.json.code).toBe('key_changed');
    expect(refused.json.keys).toEqual([
      { address: 'bob@example.com', internal: true, public_key: fresh.keys?.spki, key_id: fresh.keys?.keyId }
    ]);
    expect(refused.json.own_key?.key_id).toBe(alice.keys?.keyId);
    expect(await allRows()).toEqual([]);
    expect(await bucketCount()).toBe(0);

    expect((await send(cookie, await internalBody(alice, { to: [fresh] }, { subject: SUBJECT, text: TEXT }))).status).toBe(200);
  });

  it("refuses the sender's own copy sealed to a key that is not current, and a sealed copy for a person who has no keys", async () => {
    const { alice, bob, cookie } = await trio();
    const keyless = await createUser('late@example.com', { keys: false });
    const body = await internalBody(alice, { to: [bob] }, { subject: SUBJECT, text: TEXT });
    expect((await send(cookie, { ...body, sent: await sealedFor(must(bob.keys).spki, { subject: SUBJECT }) })).json.code).toBe(
      'key_changed'
    );
    const copy = { address: 'late@example.com', ...(await sealedFor(must(bob.keys).spki, { subject: SUBJECT })) };
    expect((await send(cookie, { ...body, to: ['late@example.com'], copies: [copy] })).json).toMatchObject({
      code: 'key_changed',
      keys: [{ address: 'late@example.com', internal: true }]
    });
    expect(keyless.keys).toBeNull();
    expect(await allRows()).toEqual([]);
  });

  it('takes everything back when a key changes between the check and the write', async () => {
    const { alice, bob, cookie } = await trio();
    const body = await internalBody(alice, { to: [bob] }, { subject: SUBJECT, text: TEXT, files: [{ name: 'f', bytes: FILE }] });
    let changed = false;
    const bucket = new Proxy(env.BUCKET, {
      get(target, property) {
        if (property === 'put') {
          return async (...args: Parameters<R2Bucket['put']>) => {
            if (!changed) {
              changed = true;
              await rotateKeys(bob);
            }
            return target.put(...args);
          };
        }
        const value: unknown = Reflect.get(target, property);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      }
    });
    const answer = await send(cookie, body, { env: { BUCKET: bucket } });
    expect(changed).toBe(true);
    expect(answer.json.code).toBe('key_changed');
    expect(answer.status).toBe(409);
    expect(await allRows()).toEqual([]);
    expect(await db().select().from(attachments)).toEqual([]);
    expect(await bucketCount()).toBe(0);
  });
});

describe('a person without keys: the browser sends that copy in the clear and the server seals it (CK-1)', () => {
  it('holds it under DATA_KEY as pending, marks the whole message not end-to-end, and re-seals it to the person after their key setup', async () => {
    const { alice, bob, cookie } = await trio();
    const late = await createUser('late@example.com', { keys: false });
    const answer = await send(
      cookie,
      await internalBody(alice, { to: [bob, late] }, { subject: SUBJECT, text: TEXT, files: [{ name: 'offer-ACME.pdf', bytes: FILE }] })
    );
    expect(answer.status).toBe(200);
    expect(answer.json.e2e).toBe(false);
    expect(answer.json.copies.map((copy) => copy.sealed)).toEqual([true, false]);
    const rows = await allRows();
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.is_e2e)).toEqual([0, 0, 0]);
    const pending = await rowOf(late.id);
    expect(pending).toMatchObject({
      wrap_kind: 'server',
      key_id: null,
      enc_fmt: 1,
      subject: null,
      snippet: null,
      body_text: null,
      body_html: null,
      r2_key: null
    });
    const objects = await Promise.all((await env.BUCKET.list()).objects.map(async (object) => latin1(await bytesOf(object.key))));
    expect(objects.join('\n')).not.toContain('offer letter');
    expect(JSON.stringify(rows)).not.toContain('ACME');

    const granted = await rotateKeys(late);
    expect(await rewrapPending(testEnv(), late.id)).toBe(1);
    const reopened = await rowOf(late.id);
    expect(reopened.wrap_kind).toBe('user');
    expect(await openRow(reopened, granted)).toMatchObject({ subject: SUBJECT, text: TEXT });
  });

  it("seals a plain copy to the person's key when they have one by now, and refuses to store anything without a usable DATA_KEY", async () => {
    const { alice, bob, cookie } = await trio();
    const asKeyless = { ...bob, keys: null };
    const body = await internalBody(alice, { to: [asKeyless] }, { subject: SUBJECT, text: TEXT });
    const answer = await send(cookie, body);
    expect(answer.status).toBe(200);
    const row = await rowOf(bob.id);
    expect(row).toMatchObject({ wrap_kind: 'user', key_id: bob.keys?.keyId, is_e2e: 0 });
    expect(await openRow(row, bob)).toMatchObject({ subject: SUBJECT, text: TEXT });

    const late = await createUser('late@example.com', { keys: false });
    const before = (await allRows()).length;
    const refused = await send(cookie, await internalBody(alice, { to: [late] }, { subject: SUBJECT, text: TEXT }), {
      env: { DATA_KEY: undefined }
    });
    expect(refused.status).toBe(503);
    expect(refused.json.code).toBe('not_configured');
    expect(await allRows()).toHaveLength(before);
  });
});

describe('who gets a copy', () => {
  it('needs exactly one copy per person (two addresses of one person are one person) and only people on this deployment', async () => {
    const { alice, bob, carol, cookie } = await trio();
    const dave = await createUser('dave@example.com', { aliases: ['d@example.com'] });
    const base = await internalBody(alice, { to: [bob, carol] }, { subject: SUBJECT });
    const copiesOf = base.copies as Record<string, unknown>[];
    const dup = copiesOf[0];
    const refusals: [string, unknown, string][] = [
      ['a missing copy', { ...base, copies: copiesOf.slice(0, 1) }, 'copies_mismatch'],
      [
        'a copy for a person who is not a recipient',
        { ...base, copies: [...copiesOf, { address: dave.email, ...(await sealedFor(must(dave.keys).spki, { subject: 'x' })) }] },
        'copies_mismatch'
      ],
      [
        'a copy naming an address that was not typed',
        { ...base, copies: [dup, { ...copiesOf[1], address: dave.email }] },
        'copies_mismatch'
      ],
      ['the same copy twice', { ...base, copies: [...copiesOf, dup] }, 'invalid_request']
    ];
    for (const [name, body, code] of refusals) {
      expect((await send(cookie, body)).json.code, name).toBe(code);
    }
    expect(await allRows()).toEqual([]);

    const external = await send(cookie, { ...base, to: ['bob@example.com', 'someone@elsewhere.example.net'] });
    expect(external.status).toBe(400);
    expect(external.json).toMatchObject({ code: 'recipient_not_internal', addresses: ['someone@elsewhere.example.net'] });

    // an alias and the primary address of one person: one copy is enough, and the alias is kept as typed
    const both = await internalBody(alice, { to: [dave] }, { subject: SUBJECT, text: TEXT }, { to: ['d@example.com', 'dave@example.com'] });
    const answer = await send(cookie, both);
    expect(answer.status).toBe(200);
    expect(answer.json.message.to_address).toBe('d@example.com, dave@example.com');
  });

  it('lets the sender write to themselves and keeps a disabled person as a recipient', async () => {
    const { alice, bob, cookie } = await trio();
    const off = await createUser('off@example.com', { status: 'disabled' });
    const answer = await send(cookie, await internalBody(alice, { to: [alice, bob, off] }, { subject: SUBJECT, text: TEXT }));
    expect(answer.status).toBe(200);
    const mine = (await allRows()).filter((row) => row.user_id === alice.id);
    expect(mine.map((row) => row.folder).toSorted()).toEqual(['inbox', 'sent']);
    expect((await rowOf(off.id)).folder).toBe('inbox');
  });
});

describe('threads, drafts and ids', () => {
  it('threads a reply for both people through the shared Message-ID, with References', async () => {
    const { alice, bob, cookie } = await trio();
    const first = await send(cookie, await internalBody(alice, { to: [bob] }, { subject: SUBJECT, text: TEXT }));
    const original = await rowOf(bob.id);
    const reply = await send(
      await signIn(bob),
      await internalBody(bob, { to: [alice] }, { subject: `Re: ${SUBJECT}`, text: 'ok' }, { in_reply_to: original.message_id })
    );
    expect(first.status).toBe(200);
    expect(reply.status).toBe(200);
    const mine = (await allRows()).filter((row) => row.user_id === alice.id);
    const root = must(mine.find((row) => row.folder === 'sent' && row.in_reply_to === null));
    const answered = must(mine.find((row) => row.folder === 'inbox'));
    expect(answered.thread_id).toBe(root.thread_id);
    expect(answered.references_header).toBe(original.message_id);
    const theirs = (await allRows()).filter((row) => row.user_id === bob.id);
    expect(new Set(theirs.map((row) => row.thread_id)).size).toBe(1);
  });

  it("deletes only the sender's own draft that the mail was written in", async () => {
    const { alice, bob, cookie } = await trio();
    const bobCookie = await signIn(bob);
    const draftId = crypto.randomUUID();
    const otherDraft = crypto.randomUUID();
    expect((await call(`/api/drafts/${draftId}`, { method: 'PUT', cookie, body: await draftBody(alice, draftId) })).status).toBe(200);
    expect(
      (await call(`/api/drafts/${otherDraft}`, { method: 'PUT', cookie: bobCookie, body: await draftBody(bob, otherDraft) })).status
    ).toBe(200);
    const body = await internalBody(alice, { to: [bob] }, { subject: SUBJECT, text: TEXT });
    expect((await send(cookie, { ...body, draft_id: otherDraft })).status).toBe(200);
    expect(await db().select().from(messages).where(eq(messages.id, otherDraft))).toHaveLength(1);
    expect(
      (await send(cookie, { ...(await internalBody(alice, { to: [bob] }, { subject: SUBJECT, text: TEXT })), draft_id: draftId })).status
    ).toBe(200);
    expect(await db().select().from(messages).where(eq(messages.id, draftId))).toEqual([]);
  });

  it("never overwrites an id that is in use: not the same request twice, not somebody else's row, not an attachment id", async () => {
    const { alice, bob, cookie } = await trio();
    const body = await internalBody(alice, { to: [bob] }, { subject: SUBJECT, text: TEXT, files: [{ name: 'f', bytes: FILE }] });
    expect((await send(cookie, body)).status).toBe(200);
    const stored = JSON.stringify(await allRows());
    const again = await send(cookie, body);
    expect([again.status, again.json.code]).toEqual([409, 'id_in_use']);
    // a fresh request that borrows bob's row id, and one that borrows an attachment id
    const bobRow = await rowOf(bob.id);
    const borrowed = await internalBody(alice, { to: [bob] }, { subject: SUBJECT, text: TEXT });
    const lent = { ...borrowed, sent: { ...(borrowed.sent as object), id: bobRow.id } };
    expect((await send(cookie, lent)).json.code).toBe('id_in_use');
    const [file] = await db().select().from(attachments);
    const second = await internalBody(alice, { to: [bob] }, { subject: SUBJECT, text: TEXT, files: [{ name: 'g', bytes: FILE }] });
    const sealedSent = second.sent as { attachments: { id: string }[] };
    sealedSent.attachments[0] = { ...must(sealedSent.attachments[0]), id: must(file).id };
    expect((await send(cookie, second)).json.code).toBe('id_in_use');
    expect(JSON.stringify(await allRows())).toBe(stored);
  });
});
