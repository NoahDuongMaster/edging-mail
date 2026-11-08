import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fromBase64Url, generateUserKeyPair, toBase64Url, unwrapCek, utf8 } from '../../src/shared/crypto/client';
import type { PublicKey } from '../../src/shared/crypto/client';
import * as workerLimits from '../../src/worker/mail/internal-limits';
import { parseInternal } from '../../src/worker/mail/internal-request';
import { ApiError, UnauthorizedError } from '../../src/client/lib/api';
import { keepKey, setKeyBackend, wipeKeys } from '../../src/client/lib/crypto/keyStore';
import { clearCeks } from '../../src/client/lib/mailcrypto/cek';
import { openAttachmentBytes } from '../../src/client/lib/mailcrypto/files';
import { openDetail, openListRow } from '../../src/client/lib/mailcrypto/rows';
import type { OpenKey } from '../../src/client/lib/mailcrypto/types';
import {
  acceptChange,
  acceptChanges,
  checkLimits,
  compareWithPins,
  externalReplyWarning,
  fingerprintGroups,
  fingerprintOf,
  LIMITS,
  lookupKeys,
  pin,
  pinsStorageKey,
  plainCopy,
  planSend,
  sealCopy,
  SealedMailError,
  sendInternal
} from '../../src/client/lib/sealedmail';
import type { Fetcher, KeyAnswer, LookupMap, MailContent, OutgoingAttachment, SendPlan } from '../../src/client/lib/sealedmail';
import { snippetOf } from '../../src/client/lib/sealedmail/helpers';
import { setPinStorage } from '../../src/client/lib/sealedmail/pins';
import type { PinStorage } from '../../src/client/lib/sealedmail/pins';
import type { Attachment, Message } from '../../src/client/types';

// Sealed send in the browser: what it seals opens with the reader (lib/mailcrypto), what it posts has the shape the Worker's own parser accepts
// (src/worker/mail/internal-request.ts) and carries no plaintext, and the key rules (lookup, pins, confirmations, key_changed) hold. No DOM, no network.

interface Person {
  address: string;
  pair: CryptoKeyPair;
  publicKey: PublicKey;
  key: OpenKey;
  spki: string;
}

async function person(address: string): Promise<Person> {
  const { privateKey, publicKey } = await generateUserKeyPair();
  const pair = { privateKey, publicKey: publicKey.key };
  return { address, pair, publicKey, key: { pair, keyId: publicKey.keyId }, spki: toBase64Url(publicKey.spki) };
}

const CONTENT: MailContent = {
  subject: 'Quarterly numbers Q3-secret',
  text: 'The totals are confidential 4711',
  html: '<p>html confidential <b>4711</b></p>'
};
const NOTE_BYTES = utf8('attachment payload bytes 9f3a-secret');
const BIN_BYTES = crypto.getRandomValues(new Uint8Array(24));
const NOTE: OutgoingAttachment = {
  filename: 'budget-secret.xlsx',
  mimeType: 'application/vnd.ms-excel',
  contentId: null,
  bytes: NOTE_BYTES
};
const BIN: OutgoingAttachment = { filename: 'logo.png', mimeType: 'image/png', contentId: '<logo@x>', bytes: BIN_BYTES };

const json = (status: number, body: unknown, headers: Record<string, string> = {}): Response => Response.json(body, { status, headers });

interface Call {
  url: string;
  body: string;
}

/** A fetch stand-in that records every call and answers with `handler`. */
function stub(handler: (call: Call, index: number) => Response): { fetcher: Fetcher; calls: Call[] } {
  const calls: Call[] = [];
  const fetcher: Fetcher = (url, init) => {
    const call = { url, body: typeof init.body === 'string' ? init.body : '' };
    calls.push(call);
    return Promise.resolve(handler(call, calls.length - 1));
  };
  return { fetcher, calls };
}

const entryOf = (address: string, owner: Person | null | 'nokeys') => {
  if (owner === null) {
    return { address, internal: false };
  }
  return owner === 'nokeys'
    ? { address, internal: true }
    : { address, internal: true, public_key: owner.spki, key_id: owner.publicKey.keyId };
};

/** The key lookup of the Worker over a small directory: who owns which address (an alias is just another address of the same owner). */
function lookupServer(directory: Map<string, Person | 'nokeys'>) {
  return stub((call) => {
    const { addresses } = JSON.parse(call.body) as { addresses: string[] };
    return json(200, { success: true, keys: addresses.map((address) => entryOf(address, directory.get(address) ?? null)) });
  });
}

/** A lookup that answers `keys` whatever was asked. */
const keysAnswer = (keys: unknown): Fetcher => stub(() => json(200, { success: true, keys })).fetcher;

/** `POST /api/messages/internal`: checks the body with the Worker's own parser, then answers as it does. */
const accepted = (call: Call): Response => {
  const request = JSON.parse(call.body) as { sent: { id: string }; copies: { address: string; plain?: unknown }[] };
  expect(parseInternal(request)).toMatchObject({ ok: true });
  return json(200, {
    success: true,
    e2e: request.copies.every((copy) => copy.plain === undefined),
    message: { id: request.sent.id, folder: 'sent' },
    copies: request.copies.map((copy, index) => ({ address: copy.address, id: `row-${index}`, sealed: copy.plain === undefined }))
  });
};

let me: Person;
let alice: Person;
let bob: Person;
const stored = new Map<string, string>();
const storage: PinStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => {
    stored.set(key, value);
  }
};

const noBackend = { read: () => Promise.resolve(null), write: () => Promise.resolve(), remove: () => Promise.resolve(), users: () => [] };
const USER = 'user-1';

beforeAll(async () => {
  [me, alice, bob] = await Promise.all([person('me@example.com'), person('alice@example.com'), person('bob@example.com')]);
  setKeyBackend(noBackend);
});

beforeEach(async () => {
  stored.clear();
  setPinStorage(storage);
  await keepKey(USER, me.pair, me.publicKey, { persist: false });
});

afterEach(async () => {
  clearCeks();
  await wipeKeys();
  setPinStorage(undefined);
});

/** Plans a send to `to` the way the compose screen will: lookup through the stub, pins compared, plan made. */
async function planTo(directory: Map<string, Person | 'nokeys'>, to: string[], cc: string[] = [], bcc: string[] = []): Promise<SendPlan> {
  const lookup = await lookupKeys([...to, ...cc, ...bcc], lookupServer(directory).fetcher);
  return planSend({ to, cc, bcc }, lookup, compareWithPins(USER, lookup));
}

const headersFor = (to: string[], cc: string[] = [], bcc: string[] = []) => ({
  to,
  cc,
  bcc,
  in_reply_to: '<abc@example.com>',
  draft_id: crypto.randomUUID()
});

const directoryOf = (...rows: [string, Person | 'nokeys'][]) => new Map(rows);
const NO_CONFIRMATION = { noKeys: [], changedKeys: [] };

describe('sealCopy opens with the reader', () => {
  it('round-trips subject, snippet, text, html and attachments', async () => {
    const sealed = await sealCopy(CONTENT, [NOTE, BIN], alice.publicKey);
    expect(sealed.id).toMatch(/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/);
    expect(sealed.key_id).toBe(alice.publicKey.keyId);
    const row = {
      id: sealed.id,
      enc_fmt: 1,
      key_id: sealed.key_id,
      wrap_kind: 'user',
      wrapped_cek: sealed.wrapped_cek,
      summary_blob: sealed.summary_blob,
      folder: 'inbox',
      from_address: me.address,
      to_address: alice.address
    } as unknown as Message;
    const listed = await openListRow(row, alice.key);
    expect(listed.mail_state).toBe('ready');
    expect(listed.subject).toBe(CONTENT.subject);
    expect(listed.snippet).toBe(CONTENT.text);

    const files = sealed.attachments ?? [];
    expect(files).toHaveLength(2);
    const rows = files.map(
      (file) =>
        ({ id: file.id, message_id: sealed.id, filename: '', mime_type: '', size: 1, meta_blob: file.meta_blob }) as unknown as Attachment
    );
    const opened = await openDetail({ ...row, body_blob: sealed.body_blob }, rows, alice.key);
    expect(opened.message.body_text).toBe(CONTENT.text);
    expect(opened.message.body_html).toBe(CONTENT.html);
    expect(opened.attachments.map((file) => [file.filename, file.mime_type, file.content_id])).toEqual([
      ['budget-secret.xlsx', 'application/vnd.ms-excel', null],
      ['logo.png', 'image/png', '<logo@x>']
    ]);
    const blobs = new Map(files.map((file) => [`/api/attachments/${file.id}`, fromBase64Url(file.blob)]));
    const fetcher = (url: string) => Promise.resolve(new Response(blobs.get(url)));
    expect(await openAttachmentBytes(row, { id: files[0].id }, alice.key, fetcher)).toEqual(NOTE_BYTES);
    expect(await openAttachmentBytes(row, { id: files[1].id }, alice.key, fetcher)).toEqual(BIN_BYTES);
  });

  it('has no attachments key without files, and keeps an absent part null', async () => {
    const sealed = await sealCopy({ subject: 'Hi', text: null, html: '<p>only html</p>' }, [], bob.publicKey);
    expect('attachments' in sealed).toBe(false);
    const row = { ...sealed, enc_fmt: 1, wrap_kind: 'user', folder: 'inbox' } as unknown as Message;
    const opened = await openDetail({ ...row, body_blob: sealed.body_blob }, [], bob.key);
    expect(opened.message.body_text).toBe('');
    expect(opened.message.body_html).toBe('<p>only html</p>');
    expect(opened.message.snippet).toBe('only html');
  });

  it('makes the snippet like the Worker: white space collapsed, tags dropped, 180 characters', () => {
    expect(snippetOf('  Hello   world\n\nnext\tline ', null)).toBe('Hello world next line');
    expect(snippetOf(null, '<p>One</p><p>Two <b>three</b></p>')).toBe('One Two three');
    expect(snippetOf('', '<p>html</p>')).toBe('html');
    expect(snippetOf('x'.repeat(500), null)).toHaveLength(180);
    expect(snippetOf(`${'x'.repeat(179)}😀`, null)).toBe('x'.repeat(179));
  });

  it('gives every person its own row id, content key and wrapped key, and a copy opens only with its own key', async () => {
    const [forAlice, forBob] = await Promise.all([sealCopy(CONTENT, [NOTE], alice.publicKey), sealCopy(CONTENT, [NOTE], bob.publicKey)]);
    expect(forAlice.id).not.toBe(forBob.id);
    expect(forAlice.wrapped_cek).not.toBe(forBob.wrapped_cek);
    expect(forAlice.summary_blob).not.toBe(forBob.summary_blob);
    expect(forAlice.attachments?.[0].id).not.toBe(forBob.attachments?.[0].id);
    expect(forAlice.attachments?.[0].blob).not.toBe(forBob.attachments?.[0].blob);

    const rowOf = (copy: typeof forBob) => ({ ...copy, enc_fmt: 1, wrap_kind: 'user', folder: 'inbox' }) as unknown as Message;
    expect((await openListRow(rowOf(forBob), alice.key)).mail_state).toBe('other_key');
    // Even with the key id of the other person claimed, Alice's private key does not open Bob's content key.
    expect((await openListRow(rowOf(forBob), { pair: alice.pair, keyId: bob.publicKey.keyId })).mail_state).toBe('failed');
    await expect(unwrapCek(fromBase64Url(forBob.wrapped_cek), forAlice.id, bob.publicKey.keyId, alice.pair)).rejects.toThrow();
    expect((await openListRow(rowOf(forBob), bob.key)).subject).toBe(CONTENT.subject);
  });
});

describe('lookupKeys', () => {
  it('keys the answer by the address as typed, lower-cased, and keeps a +tag the way the server answers', async () => {
    const server = lookupServer(
      directoryOf(['alice@example.com', alice], ['alice+news@example.com', alice], ['dave@example.com', 'nokeys'])
    );
    const answers = await lookupKeys(
      [' Alice@Example.com ', 'alice@example.com', 'alice+news@example.com', 'DAVE@example.com', 'x@elsewhere.org'],
      server.fetcher
    );
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0].url).toBe('/api/keys/lookup');
    expect(JSON.parse(server.calls[0].body)).toEqual({
      addresses: ['alice@example.com', 'alice+news@example.com', 'dave@example.com', 'x@elsewhere.org']
    });
    expect([...answers.keys()]).toEqual(['alice@example.com', 'alice+news@example.com', 'dave@example.com', 'x@elsewhere.org']);
    expect(answers.get('alice+news@example.com')).toEqual({ internal: true, publicKey: alice.spki, keyId: alice.publicKey.keyId });
    expect(answers.get('dave@example.com')).toEqual({ internal: true });
    expect(answers.get('x@elsewhere.org')).toEqual({ internal: false });
  });

  it('answers an address no account can have without asking, and asks nothing for an empty list', async () => {
    const server = lookupServer(directoryOf());
    expect([...(await lookupKeys(['not an address', 'ünï@example.com'], server.fetcher)).values()]).toEqual([
      { internal: false },
      { internal: false }
    ]);
    expect(await lookupKeys([], server.fetcher)).toEqual(new Map());
    expect(server.calls).toHaveLength(0);
  });

  it('refuses more than 50 distinct addresses before any request', async () => {
    const server = lookupServer(directoryOf());
    const many = Array.from({ length: 51 }, (_, index) => `p${index}@example.com`);
    await expect(lookupKeys(many, server.fetcher)).rejects.toMatchObject({ name: 'SealedMailError', reason: 'too_many_addresses' });
    expect(server.calls).toHaveLength(0);
    expect(await lookupKeys([...many.slice(0, 50), many[0].toUpperCase()], lookupServer(directoryOf()).fetcher)).toHaveProperty('size', 50);
  });

  it('lets a throttle through as an ApiError with retryAfter, and a lost session as UnauthorizedError', async () => {
    const throttled = stub(() => json(429, { success: false, code: 'too_many_lookups' }, { 'Retry-After': '42' }));
    const error: unknown = await lookupKeys(['a@example.com'], throttled.fetcher).catch((error_: unknown) => error_);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: 'too_many_lookups', retryAfter: 42 });

    const gone = stub(() => json(401, { success: false, code: 'unauthorized' }));
    await expect(lookupKeys(['a@example.com'], gone.fetcher)).rejects.toBeInstanceOf(UnauthorizedError);
    const other = stub(() => json(401, { success: false, code: 'step_up_required' }));
    await expect(lookupKeys(['a@example.com'], other.fetcher)).rejects.toBeInstanceOf(ApiError);
    const page = stub(() => new Response('<html>bad gateway</html>', { status: 502 }));
    await expect(lookupKeys(['a@example.com'], page.fetcher)).rejects.toMatchObject({ name: 'ApiError', status: 502, code: undefined });
  });

  it('validates the answer strictly', async () => {
    const good = entryOf('a@example.com', alice);
    const bad: unknown[] = [
      'nope',
      [],
      [{ ...good, address: 'b@example.com' }],
      [{ ...good, key_id: bob.publicKey.keyId }],
      [{ ...good, public_key: `${alice.spki}=` }],
      [{ ...good, public_key: bob.spki.slice(0, 40) }],
      [{ address: 'a@example.com', internal: false, key_id: alice.publicKey.keyId }],
      [{ address: 'a@example.com', internal: 'yes' }],
      [{ address: 'a@example.com', internal: true, public_key: alice.spki }],
      [good, good]
    ];
    for (const keys of bad) {
      await expect(lookupKeys(['a@example.com'], keysAnswer(keys))).rejects.toMatchObject({ reason: 'bad_answer' });
    }
    await expect(lookupKeys(['a@example.com'], keysAnswer([good]))).resolves.toHaveProperty('size', 1);
  });
});

describe('planSend', () => {
  it('is internal and end-to-end only when every recipient has keys', async () => {
    const plan = await planTo(
      directoryOf(['alice@example.com', alice], ['bob@example.com', bob]),
      ['alice@example.com'],
      ['bob@example.com']
    );
    expect(plan.route).toBe('internal');
    expect(plan.e2e).toBe(true);
    expect(plan.needsConfirm).toEqual({ noKeys: [], changedKeys: [], wasKeyed: [] });
    expect(plan.recipients.map((r) => [r.address, r.state, r.pin])).toEqual([
      ['alice@example.com', 'ready', 'new'],
      ['bob@example.com', 'ready', 'new']
    ]);
    expect(plan.recipients[0].fingerprint).toBe(await fingerprintOf(alice.publicKey.spki));
    expect(plan.recipients[0].keyId).toBe(alice.publicKey.keyId);
  });

  it('is external as soon as one address is outside, with nothing to confirm', async () => {
    const plan = await planTo(directoryOf(['alice@example.com', alice], ['dave@example.com', 'nokeys']), [
      'alice@example.com',
      'x@elsewhere.org',
      'dave@example.com'
    ]);
    expect(plan.route).toBe('external');
    expect(plan.e2e).toBe(false);
    expect(plan.recipients.map((r) => r.state)).toEqual(['ready', 'external', 'no_keys']);
    expect(plan.needsConfirm).toEqual({ noKeys: [], changedKeys: [], wasKeyed: [] });
    expect(plan.copies).toEqual([]);
    await expect(
      sendInternal({
        content: CONTENT,
        attachments: [],
        headers: { to: ['alice@example.com', 'x@elsewhere.org', 'dave@example.com'], cc: [], bcc: [] },
        plan,
        confirmed: NO_CONFIRMATION
      })
    ).rejects.toMatchObject({ reason: 'not_internal' });
  });

  it('lists the people without keys, and plans one copy per key id (aliases of one person are one copy)', async () => {
    const directory = directoryOf(
      ['alice@example.com', alice],
      ['alice.work@example.com', alice],
      ['bob@example.com', bob],
      ['dave@example.com', 'nokeys'],
      ['erin@example.com', 'nokeys']
    );
    const plan = await planTo(
      directory,
      ['alice@example.com', 'bob@example.com'],
      ['Alice.Work@example.com'],
      ['dave@example.com', 'erin@example.com']
    );
    expect(plan.route).toBe('internal');
    expect(plan.e2e).toBe(false);
    expect(plan.needsConfirm.noKeys).toEqual(['dave@example.com', 'erin@example.com']);
    expect(plan.copies).toEqual([
      {
        kind: 'sealed',
        address: 'alice@example.com',
        addresses: ['alice@example.com', 'alice.work@example.com'],
        keyId: alice.publicKey.keyId,
        publicKey: alice.spki
      },
      { kind: 'sealed', address: 'bob@example.com', addresses: ['bob@example.com'], keyId: bob.publicKey.keyId, publicKey: bob.spki },
      { kind: 'plain', address: 'dave@example.com' },
      { kind: 'plain', address: 'erin@example.com' }
    ]);
  });

  it('flags a changed key with the fingerprint of the key it replaces', async () => {
    const before = await person('alice@example.com');
    pin(USER, 'alice@example.com', { keyId: before.publicKey.keyId, spki: before.spki, firstSeen: 1 });
    const plan = await planTo(directoryOf(['alice@example.com', alice]), ['alice@example.com']);
    expect(plan.recipients[0]).toMatchObject({
      state: 'ready',
      pin: 'changed',
      keyId: alice.publicKey.keyId,
      previousKeyId: before.publicKey.keyId,
      previousFingerprint: await fingerprintOf(before.publicKey.spki)
    });
    expect(plan.needsConfirm.changedKeys).toEqual(['alice@example.com']);
  });
});

describe('sendInternal', () => {
  it('posts a body in which no plaintext appears, and the copies are the ones the Worker accepts', async () => {
    const plan = await planTo(
      directoryOf(['alice@example.com', alice], ['bob@example.com', bob]),
      ['alice@example.com'],
      [],
      ['bob@example.com']
    );
    const server = stub(accepted);
    const result = await sendInternal({
      content: CONTENT,
      attachments: [NOTE, BIN],
      headers: headersFor(['alice@example.com'], [], ['bob@example.com']),
      plan,
      confirmed: NO_CONFIRMATION,
      fetcher: server.fetcher
    });
    expect(result).toMatchObject({ status: 'sent', e2e: true });
    expect(server.calls).toHaveLength(1);
    expect(server.calls[0].url).toBe('/api/messages/internal');
    const body = server.calls[0].body;
    for (const secret of [
      CONTENT.subject,
      CONTENT.text ?? '',
      CONTENT.html ?? '',
      'budget-secret',
      'logo.png',
      'application/vnd.ms-excel',
      new TextDecoder().decode(NOTE_BYTES),
      btoa(String.fromCodePoint(...NOTE_BYTES)),
      toBase64Url(NOTE_BYTES),
      btoa(String.fromCodePoint(...BIN_BYTES)),
      toBase64Url(BIN_BYTES)
    ]) {
      expect(body).not.toContain(secret);
    }
    const request = JSON.parse(body) as {
      to: string[];
      bcc: string[];
      sent: { key_id: string };
      copies: { address: string; key_id: string; attachments: unknown[] }[];
    };
    expect(request.sent.key_id).toBe(me.publicKey.keyId);
    expect(request.copies.map((copy) => [copy.address, copy.key_id])).toEqual([
      ['alice@example.com', alice.publicKey.keyId],
      ['bob@example.com', bob.publicKey.keyId]
    ]);
    expect(request.copies.every((copy) => copy.attachments.length === 2)).toBe(true);
    // Three copies, three row ids, and every attachment id different too.
    const ids = [
      (JSON.parse(body) as { sent: { id: string } }).sent.id,
      ...request.copies.map((copy) => (copy as unknown as { id: string }).id)
    ];
    expect(new Set(ids).size).toBe(3);
  });

  it('seals the Sent copy to the sender so the sender can read it', async () => {
    const plan = await planTo(directoryOf(['alice@example.com', alice]), ['alice@example.com']);
    const server = stub(accepted);
    await sendInternal({
      content: CONTENT,
      attachments: [],
      headers: headersFor(['alice@example.com']),
      plan,
      confirmed: NO_CONFIRMATION,
      fetcher: server.fetcher
    });
    const { sent } = JSON.parse(server.calls[0].body) as { sent: Record<string, string> };
    const row = { ...sent, enc_fmt: 1, wrap_kind: 'user', folder: 'sent' } as unknown as Message;
    expect((await openListRow(row, me.key)).subject).toBe(CONTENT.subject);
    expect((await openListRow(row, alice.key)).mail_state).toBe('other_key');
  });

  it('makes one copy per recipient person: two addresses of one keyed person are one copy', async () => {
    const directory = directoryOf(['alice@example.com', alice], ['alice.work@example.com', alice], ['bob@example.com', bob]);
    const plan = await planTo(directory, ['alice@example.com', 'bob@example.com'], ['alice.work@example.com']);
    const server = stub(accepted);
    await sendInternal({
      content: CONTENT,
      attachments: [],
      headers: headersFor(['alice@example.com', 'bob@example.com'], ['alice.work@example.com']),
      plan,
      confirmed: NO_CONFIRMATION,
      fetcher: server.fetcher
    });
    const request = JSON.parse(server.calls[0].body) as { copies: { address: string }[] };
    expect(request.copies.map((copy) => copy.address)).toEqual(['alice@example.com', 'bob@example.com']);
  });

  it('sends a copy in the clear to a person without keys only after the person confirmed, and says it is not end-to-end', async () => {
    const plan = await planTo(directoryOf(['alice@example.com', alice], ['dave@example.com', 'nokeys']), [
      'alice@example.com',
      'dave@example.com'
    ]);
    const input = { content: CONTENT, attachments: [NOTE], headers: headersFor(['alice@example.com', 'dave@example.com']), plan };
    const refused = stub(accepted);
    await expect(sendInternal({ ...input, confirmed: NO_CONFIRMATION, fetcher: refused.fetcher })).rejects.toMatchObject({
      reason: 'confirm_needed',
      addresses: ['dave@example.com']
    });
    await expect(
      sendInternal({ ...input, confirmed: { noKeys: ['someone@else.org'], changedKeys: [] }, fetcher: refused.fetcher })
    ).rejects.toBeInstanceOf(SealedMailError);
    expect(refused.calls).toHaveLength(0);

    const server = stub(accepted);
    const result = await sendInternal({ ...input, confirmed: { noKeys: ['Dave@example.com'], changedKeys: [] }, fetcher: server.fetcher });
    expect(result).toMatchObject({ status: 'sent', e2e: false });
    const request = JSON.parse(server.calls[0].body) as {
      copies: { address: string; plain?: { subject: string; text: string; attachments: { filename: string; content_base64: string }[] } }[];
    };
    const plainOne = request.copies.find((copy) => copy.address === 'dave@example.com');
    expect(plainOne?.plain).toMatchObject({ subject: CONTENT.subject, text: CONTENT.text });
    expect(plainOne?.plain?.attachments).toEqual([
      { filename: 'budget-secret.xlsx', mime_type: 'application/vnd.ms-excel', content_base64: btoa(String.fromCodePoint(...NOTE_BYTES)) }
    ]);
    expect(request.copies.find((copy) => copy.address === 'alice@example.com')?.plain).toBeUndefined();
  });

  it('retries once with the keyless addresses merged when the server finds two aliases of one person', async () => {
    const directory = directoryOf(['dave@example.com', 'nokeys'], ['dave.alias@example.com', 'nokeys']);
    const plan = await planTo(directory, ['dave@example.com', 'dave.alias@example.com']);
    const confirmed = { noKeys: ['dave@example.com', 'dave.alias@example.com'], changedKeys: [] };
    const input = {
      content: CONTENT,
      attachments: [],
      headers: headersFor(['dave@example.com', 'dave.alias@example.com']),
      plan,
      confirmed
    };

    const server = stub((call, index) => (index === 0 ? json(400, { success: false, code: 'copies_mismatch' }) : accepted(call)));
    expect(await sendInternal({ ...input, fetcher: server.fetcher })).toMatchObject({ status: 'sent', e2e: false });
    expect(server.calls.map((call) => (JSON.parse(call.body) as { copies: unknown[] }).copies.length)).toEqual([2, 1]);
    expect((JSON.parse(server.calls[1].body) as { copies: { address: string }[] }).copies[0].address).toBe('dave@example.com');

    const stubborn = stub(() => json(400, { success: false, code: 'copies_mismatch' }));
    await expect(sendInternal({ ...input, fetcher: stubborn.fetcher })).rejects.toMatchObject({
      name: 'ApiError',
      code: 'copies_mismatch'
    });
    expect(stubborn.calls).toHaveLength(2);
  });

  it('returns key_changed with the parsed keys, sends nothing more and pins nothing', async () => {
    const newAlice = await person('alice@example.com');
    const plan = await planTo(directoryOf(['alice@example.com', alice], ['bob@example.com', bob]), [
      'alice@example.com',
      'bob@example.com'
    ]);
    const server = stub(() =>
      json(409, {
        success: false,
        code: 'key_changed',
        keys: [entryOf('alice@example.com', newAlice), entryOf('bob@example.com', bob)],
        own_key: { public_key: me.spki, key_id: me.publicKey.keyId }
      })
    );
    const result = await sendInternal({
      content: CONTENT,
      attachments: [],
      headers: headersFor(['alice@example.com', 'bob@example.com']),
      plan,
      confirmed: NO_CONFIRMATION,
      fetcher: server.fetcher
    });
    expect(server.calls).toHaveLength(1);
    expect(result.status).toBe('key_changed');
    if (result.status !== 'key_changed') {
      return;
    }
    expect(result.ownKeyChanged).toBe(false);
    expect(result.keys.get('alice@example.com')).toEqual({ internal: true, publicKey: newAlice.spki, keyId: newAlice.publicKey.keyId });
    expect(result.keys.get('bob@example.com')?.keyId).toBe(bob.publicKey.keyId);
    // Nothing was pinned: both are still first-time addresses.
    expect([...compareWithPins(USER, result.keys).values()].map((check) => check.state)).toEqual(['new', 'new']);
  });

  it('walks the whole key_changed flow: changed key, confirmation, accept, send', async () => {
    const newAlice = await person('alice@example.com');
    // The first send pins Alice's key (after it succeeded).
    const first = await planTo(directoryOf(['alice@example.com', alice]), ['alice@example.com']);
    await sendInternal({
      content: CONTENT,
      attachments: [],
      headers: headersFor(['alice@example.com']),
      plan: first,
      confirmed: NO_CONFIRMATION,
      fetcher: stub(accepted).fetcher
    });
    expect(
      [
        ...compareWithPins(
          USER,
          new Map([['alice@example.com', { internal: true, publicKey: alice.spki, keyId: alice.publicKey.keyId }]])
        ).values()
      ][0].state
    ).toBe('same');

    // Alice changed her key since the lookup: the server says so.
    const stale = stub(() => json(409, { success: false, code: 'key_changed', keys: [entryOf('alice@example.com', newAlice)] }));
    const result = await sendInternal({
      content: CONTENT,
      attachments: [],
      headers: headersFor(['alice@example.com']),
      plan: first,
      confirmed: NO_CONFIRMATION,
      fetcher: stale.fetcher
    });
    expect(result.status).toBe('key_changed');
    if (result.status !== 'key_changed') {
      return;
    }
    const plan = await planSend({ to: ['alice@example.com'], cc: [], bcc: [] }, result.keys, compareWithPins(USER, result.keys));
    expect(plan.recipients[0].pin).toBe('changed');
    const input = { content: CONTENT, attachments: [], headers: headersFor(['alice@example.com']), plan, confirmed: NO_CONFIRMATION };
    await expect(sendInternal({ ...input, fetcher: stub(accepted).fetcher })).rejects.toMatchObject({
      reason: 'confirm_needed',
      addresses: ['alice@example.com']
    });

    acceptChanges(plan, ['alice@example.com']);
    const again = await planSend({ to: ['alice@example.com'], cc: [], bcc: [] }, result.keys, compareWithPins(USER, result.keys));
    expect(again.recipients[0].pin).toBe('same');
    const server = stub(accepted);
    expect(await sendInternal({ ...input, plan: again, fetcher: server.fetcher })).toMatchObject({ status: 'sent', e2e: true });
    expect((JSON.parse(server.calls[0].body) as { copies: { key_id: string }[] }).copies[0].key_id).toBe(newAlice.publicKey.keyId);
  });

  it('pins the new keys only after a successful send, and accepts a confirmed change with it', async () => {
    const plan = await planTo(directoryOf(['alice@example.com', alice], ['bob@example.com', bob]), [
      'alice@example.com',
      'bob@example.com'
    ]);
    const headers = headersFor(['alice@example.com', 'bob@example.com']);
    const failing = stub(() => json(500, { success: false, code: 'server_error' }));
    await expect(
      sendInternal({ content: CONTENT, attachments: [], headers, plan, confirmed: NO_CONFIRMATION, fetcher: failing.fetcher })
    ).rejects.toBeInstanceOf(ApiError);
    const lookup: LookupMap = new Map<string, KeyAnswer>([
      ['alice@example.com', { internal: true, publicKey: alice.spki, keyId: alice.publicKey.keyId }],
      ['bob@example.com', { internal: true, publicKey: bob.spki, keyId: bob.publicKey.keyId }]
    ]);
    expect([...compareWithPins(USER, lookup).values()].map((check) => check.state)).toEqual(['new', 'new']);

    await sendInternal({ content: CONTENT, attachments: [], headers, plan, confirmed: NO_CONFIRMATION, fetcher: stub(accepted).fetcher });
    expect([...compareWithPins(USER, lookup).values()].map((check) => check.state)).toEqual(['same', 'same']);

    // Alice's new key, confirmed in the same step as the send.
    const newAlice = await person('alice@example.com');
    const changed = await planTo(directoryOf(['alice@example.com', newAlice]), ['alice@example.com']);
    const confirmed = { noKeys: [], changedKeys: ['alice@example.com'] };
    await sendInternal({
      content: CONTENT,
      attachments: [],
      headers: headersFor(['alice@example.com']),
      plan: changed,
      confirmed,
      fetcher: stub(accepted).fetcher
    });
    expect(
      compareWithPins(
        USER,
        new Map([['alice@example.com', { internal: true, publicKey: newAlice.spki, keyId: newAlice.publicKey.keyId }]])
      ).get('alice@example.com')?.state
    ).toBe('same');
  });

  it('refuses a plan that is not what the headers say, and a message over a cap, before any request', async () => {
    const plan = await planTo(directoryOf(['alice@example.com', alice], ['bob@example.com', bob]), [
      'alice@example.com',
      'bob@example.com'
    ]);
    const server = stub(accepted);
    await expect(
      sendInternal({
        content: CONTENT,
        attachments: [],
        headers: headersFor(['alice@example.com']),
        plan,
        confirmed: NO_CONFIRMATION,
        fetcher: server.fetcher
      })
    ).rejects.toMatchObject({
      reason: 'plan_mismatch'
    });
    const huge: MailContent = { subject: 'big', text: 'x'.repeat(1_100_000), html: null };
    await expect(
      sendInternal({
        content: huge,
        attachments: [],
        headers: headersFor(['alice@example.com', 'bob@example.com']),
        plan,
        confirmed: NO_CONFIRMATION,
        fetcher: server.fetcher
      })
    ).rejects.toMatchObject({ reason: 'too_big', problems: [{ kind: 'body_too_big' }] });
    expect(server.calls).toHaveLength(0);
  });

  it('maps a lost session to UnauthorizedError and any other answer to an ApiError', async () => {
    const plan = await planTo(directoryOf(['alice@example.com', alice]), ['alice@example.com']);
    const input = { content: CONTENT, attachments: [], headers: headersFor(['alice@example.com']), plan, confirmed: NO_CONFIRMATION };
    await expect(
      sendInternal({ ...input, fetcher: stub(() => json(401, { success: false, code: 'unauthorized' })).fetcher })
    ).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(
      sendInternal({
        ...input,
        fetcher: stub(() => json(429, { success: false, code: 'too_many_requests' }, { 'Retry-After': '9' })).fetcher
      })
    ).rejects.toMatchObject({
      status: 429,
      retryAfter: 9
    });
    await expect(
      sendInternal({
        ...input,
        fetcher: stub(() => json(400, { success: false, code: 'recipient_not_internal', addresses: ['a@b.c'] })).fetcher
      })
    ).rejects.toMatchObject({
      code: 'recipient_not_internal'
    });
  });

  it('fails with the typed error while the key is locked, and sends nothing', async () => {
    const plan = await planTo(directoryOf(['alice@example.com', alice]), ['alice@example.com']);
    await wipeKeys();
    const server = stub(accepted);
    const input = {
      content: CONTENT,
      attachments: [],
      headers: headersFor(['alice@example.com']),
      plan,
      confirmed: NO_CONFIRMATION,
      fetcher: server.fetcher
    };
    await expect(sendInternal(input)).rejects.toMatchObject({ name: 'SealedMailError', reason: 'locked' });
    expect(() => acceptChanges(plan, ['alice@example.com'])).toThrow(SealedMailError);
    expect(server.calls).toHaveLength(0);
  });
});

describe('plain copies', () => {
  it('turns line breaks of the subject and file names into spaces and fills in empty names', () => {
    const copy = plainCopy('dave@example.com', { subject: 'two\r\nlines', text: 'x', html: null }, [
      { filename: '', mimeType: '', contentId: null, bytes: BIN_BYTES }
    ]);
    expect(copy.plain.subject).toBe('two lines');
    expect(copy.plain.attachments).toEqual([
      { filename: 'attachment', mime_type: 'application/octet-stream', content_base64: btoa(String.fromCodePoint(...BIN_BYTES)) }
    ]);
  });
});

/** What a lookup says about `alice@example.com` when she holds the key `keyId`. */
const answer = (keyId: string): ReadonlyMap<string, KeyAnswer> =>
  new Map([['alice@example.com', { internal: true, publicKey: alice.spki, keyId }]]);
const entry = (owner: Person) => ({ keyId: owner.publicKey.keyId, spki: owner.spki, firstSeen: 5 });

describe('pins', () => {
  it('is new the first time, same afterwards, changed when the key id differs; nothing is pinned by comparing', () => {
    expect(compareWithPins(USER, answer(alice.publicKey.keyId)).get('alice@example.com')).toEqual({ state: 'new', pinned: null });
    expect(compareWithPins(USER, answer(alice.publicKey.keyId)).get('alice@example.com')?.state).toBe('new');
    expect(pin(USER, 'Alice@Example.com', entry(alice))).toBe(true);
    expect(compareWithPins(USER, answer(alice.publicKey.keyId)).get('alice@example.com')).toEqual({ state: 'same', pinned: entry(alice) });
    expect(compareWithPins(USER, answer(bob.publicKey.keyId)).get('alice@example.com')).toEqual({ state: 'changed', pinned: entry(alice) });
    // No key (a person who never signed in, an outside address) has no pin state.
    expect(compareWithPins(USER, new Map([['dave@example.com', { internal: true }]])).size).toBe(0);
  });

  it('never replaces a pinned key silently: only acceptChange does', () => {
    pin(USER, 'alice@example.com', entry(alice));
    expect(pin(USER, 'alice@example.com', entry(bob))).toBe(false);
    expect(compareWithPins(USER, answer(alice.publicKey.keyId)).get('alice@example.com')?.state).toBe('same');
    acceptChange(USER, 'alice@example.com', entry(bob));
    expect(compareWithPins(USER, answer(bob.publicKey.keyId)).get('alice@example.com')?.state).toBe('same');
  });

  it('is memory only on a shared device, and gone after a wipe', async () => {
    pin(USER, 'alice@example.com', entry(alice));
    expect(stored.size).toBe(0);
    expect(compareWithPins(USER, answer(alice.publicKey.keyId)).get('alice@example.com')?.state).toBe('same');
    await wipeKeys();
    await keepKey(USER, me.pair, me.publicKey, { persist: false });
    expect(compareWithPins(USER, answer(alice.publicKey.keyId)).get('alice@example.com')?.state).toBe('new');
  });

  it('is written on a personal device (public data only), cleared from memory on a wipe, and read back from storage afterwards', async () => {
    await keepKey(USER, me.pair, me.publicKey, { persist: true });
    pin(USER, 'alice@example.com', entry(alice));
    const text = stored.get(pinsStorageKey(USER)) ?? '';
    expect(pinsStorageKey(USER)).toBe('edging-mail-pins:user-1');
    expect(JSON.parse(text)).toEqual({ v: 1, pins: { 'alice@example.com': entry(alice) } });

    await wipeKeys();
    // The stored record survives the wipe (it is not a secret) ...
    expect(stored.get(pinsStorageKey(USER))).toBe(text);
    // ... and a shared-device session of the same person does not read it.
    await keepKey(USER, me.pair, me.publicKey, { persist: false });
    expect(compareWithPins(USER, answer(alice.publicKey.keyId)).get('alice@example.com')?.state).toBe('new');
    await wipeKeys();
    await keepKey(USER, me.pair, me.publicKey, { persist: true });
    expect(compareWithPins(USER, answer(alice.publicKey.keyId)).get('alice@example.com')?.state).toBe('same');
    expect(compareWithPins(USER, answer(bob.publicKey.keyId)).get('alice@example.com')?.state).toBe('changed');
  });

  it('treats corrupt storage as no pins, never as an exception', async () => {
    await keepKey(USER, me.pair, me.publicKey, { persist: true });
    for (const text of [
      '{not json',
      'null',
      '[]',
      '{"pins":5}',
      '{"v":1,"pins":{"alice@example.com":{"keyId":"short","spki":"x","firstSeen":"now"}}}'
    ]) {
      stored.set(pinsStorageKey(USER), text);
      await wipeKeys();
      await keepKey(USER, me.pair, me.publicKey, { persist: true });
      expect(compareWithPins(USER, answer(alice.publicKey.keyId)).get('alice@example.com')?.state).toBe('new');
    }
    // A broken storage object (it throws) is the same.
    setPinStorage({
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      }
    });
    expect(compareWithPins(USER, answer(alice.publicKey.keyId)).get('alice@example.com')?.state).toBe('new');
    expect(pin(USER, 'alice@example.com', entry(alice))).toBe(true);
  });

  it('keeps the pins of one person apart from another', () => {
    pin('user-2', 'alice@example.com', entry(bob));
    expect(compareWithPins(USER, answer(alice.publicKey.keyId)).get('alice@example.com')?.state).toBe('new');
  });
});

describe('fingerprints', () => {
  it('matches vectors computed outside this code (SHA-256, first 120 bits, 20-bit groups mod 100000)', async () => {
    expect(await fingerprintOf(new Uint8Array(0))).toBe('32620 79192 32641 01819 02633 18425');
    expect(await fingerprintOf(utf8('abc'))).toBe('63777 42255 07422 72065 65701 96546');
    expect(await fingerprintOf(Uint8Array.from({ length: 91 }, (_, index) => index))).toBe('63817 85106 77986 22898 39264 71742');
  });

  it('groups a digest: the bit layout, the modulus and the padding', () => {
    expect(fingerprintGroups(Uint8Array.from({ length: 32 }, (_, index) => index)).join(' ')).toBe('00016 31844 20576 60809 41136 89774');
    expect(fingerprintGroups(new Uint8Array(32).fill(255))).toEqual(Array.from({ length: 6 }, () => '48575'));
    expect(fingerprintGroups(new Uint8Array(32))).toEqual(Array.from({ length: 6 }, () => '00000'));
    expect(() => fingerprintGroups(new Uint8Array(14))).toThrow(RangeError);
  });

  it('is deterministic and differs between keys', async () => {
    const first = await fingerprintOf(alice.publicKey.spki);
    expect(await fingerprintOf(alice.publicKey.spki)).toBe(first);
    expect(await fingerprintOf(bob.publicKey.spki)).not.toBe(first);
    expect(first).toMatch(/^(\d{5} ){5}\d{5}$/);
  });
});

const small: MailContent = { subject: 'Hi', text: 'hello', html: null };
const file = (size: number): OutgoingAttachment => ({
  filename: 'f.bin',
  mimeType: 'application/octet-stream',
  contentId: null,
  bytes: new Uint8Array(size)
});
const kinds = (problems: { kind: string }[]) => problems.map((problem) => problem.kind);

describe('limits', () => {
  it('mirrors the Worker caps', () => {
    expect(LIMITS).toMatchObject({
      requestBytes: workerLimits.MAX_INTERNAL_BODY_BYTES,
      recipients: workerLimits.MAX_INTERNAL_RECIPIENTS,
      summaryBlobBytes: workerLimits.MAX_SUMMARY_BLOB_BYTES,
      bodyBlobBytes: workerLimits.MAX_BODY_BLOB_BYTES,
      attachmentsPerCopy: workerLimits.MAX_ATTACHMENTS_PER_COPY,
      attachmentObjects: workerLimits.MAX_ATTACHMENT_OBJECTS,
      attachmentBytes: workerLimits.MAX_ATTACHMENT_BYTES,
      subjectChars: workerLimits.MAX_SUBJECT_CHARS,
      plainBodyBytes: workerLimits.MAX_PLAIN_BODY_BYTES
    });
  });

  it('accepts an ordinary message', () => {
    expect(checkLimits(small, [file(1000)], 3)).toEqual([]);
    expect(checkLimits(small, [], 50)).toEqual([]);
  });

  it('reports each cap as data', () => {
    expect(checkLimits(small, [], 51)).toEqual([{ kind: 'too_many_recipients', limit: 50, actual: 51 }]);
    expect(kinds(checkLimits({ ...small, subject: 'x'.repeat(999) }, [], 1))).toEqual(['subject_too_long']);
    expect(kinds(checkLimits({ ...small, text: 'x'.repeat(1_100_000) }, [], 1))).toEqual(['body_too_big']);
    expect(kinds(checkLimits({ ...small, text: 'x'.repeat(1_048_000) }, [], 1))).toEqual(['body_too_big']);
    expect(
      checkLimits(
        small,
        Array.from({ length: 33 }, () => file(1)),
        1
      )
    ).toEqual([{ kind: 'too_many_attachments', limit: 32, actual: 33 }]);
    // 40 people + the Sent copy = 41 copies of 3 files = 123 objects.
    expect(checkLimits(small, [file(1), file(1), file(1)], 40)).toEqual([{ kind: 'too_many_attachments', limit: 2, actual: 3 }]);
    // A 4 MiB file for 2 people is sealed 3 times (the Sent copy too): 12 MiB, over the 10 MiB cap; for 1 person it is 8 MiB.
    expect(kinds(checkLimits(small, [file(4 * 1024 * 1024)], 2))).toEqual(['attachments_too_big']);
    expect(checkLimits(small, [file(4 * 1024 * 1024)], 1)).toEqual([]);
    expect(kinds(checkLimits(small, [file(5 * 1024 * 1024)], 1))).toEqual(['attachments_too_big']);
  });

  it('counts copies (people), not addresses, when it is told', () => {
    expect(kinds(checkLimits(small, [file(4 * 1024 * 1024)], 2))).toEqual(['attachments_too_big']);
    expect(checkLimits(small, [file(4 * 1024 * 1024)], 2, 1)).toEqual([]);
  });

  it('sees a request that is over its cap although every part fits: a large body sealed for many people', () => {
    expect(kinds(checkLimits({ ...small, text: 'x'.repeat(900_000) }, [], 20))).toEqual(['request_too_big']);
    expect(checkLimits({ ...small, text: 'x'.repeat(900_000) }, [], 5)).toEqual([]);
  });
});

const planOf = (states: ('ready' | 'no_keys' | 'external')[]) => ({
  recipients: states.map((state, index) => ({ address: `p${index}@example.com`, state, pin: 'new' as const }))
});

describe('N6', () => {
  it('warns when an end-to-end message goes to an outside address', () => {
    expect(externalReplyWarning({ messageIsE2E: true, plan: planOf(['ready', 'external', 'external']) })).toEqual({
      warn: true,
      externalAddresses: ['p1@example.com', 'p2@example.com']
    });
  });

  it('does not warn for a message that was not end-to-end, or when nobody is outside', () => {
    expect(externalReplyWarning({ messageIsE2E: false, plan: planOf(['external']) })).toEqual({
      warn: false,
      externalAddresses: ['p0@example.com']
    });
    expect(externalReplyWarning({ messageIsE2E: true, plan: planOf(['ready', 'no_keys']) })).toEqual({
      warn: false,
      externalAddresses: []
    });
    expect(externalReplyWarning({ messageIsE2E: true, plan: planOf([]) })).toEqual({ warn: false, externalAddresses: [] });
  });
});
