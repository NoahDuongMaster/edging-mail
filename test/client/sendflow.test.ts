import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { generateUserKeyPair, toBase64Url, utf8 } from '../../src/shared/crypto/client';
import type { PublicKey } from '../../src/shared/crypto/client';
import { parseInternal } from '../../src/worker/mail/internal-request';
import { keepKey, setKeyBackend, wipeKeys } from '../../src/client/lib/crypto/keyStore';
import { openDraft, sealDraft } from '../../src/client/lib/drafts';
import { pinsStorageKey, runSend } from '../../src/client/lib/sealedmail';
import type { FlowInput, Fetcher, Question } from '../../src/client/lib/sealedmail';
import { setPinStorage } from '../../src/client/lib/sealedmail/pins';
import type { PinStorage } from '../../src/client/lib/sealedmail/pins';

// The decision of a send (lib/sealedmail/flow.ts): which route, which questions, what is never sent. No DOM, no network: one stand-in
// answers the key lookup and the internal send, and every call is recorded.

interface Person {
  spki: string;
  publicKey: PublicKey;
  pair: CryptoKeyPair;
}

async function person(): Promise<Person> {
  const { privateKey, publicKey } = await generateUserKeyPair();
  return { spki: toBase64Url(publicKey.spki), publicKey, pair: { privateKey, publicKey: publicKey.key } };
}

type Owner = Person | 'nokeys' | null;
const json = (status: number, body: unknown): Response => Response.json(body, { status });
const entryOf = (address: string, owner: Owner) =>
  owner === null
    ? { address, internal: false }
    : owner === 'nokeys'
      ? { address, internal: true }
      : { address, internal: true, public_key: owner.spki, key_id: owner.publicKey.keyId };

interface Call {
  url: string;
  body: string;
}

/** Answers `/api/keys/lookup` from `directory` and hands `/api/messages/internal` to `internal` (its own call counter starts at 0). */
function server(directory: Map<string, Owner>, internal: (call: Call, index: number) => Response = accepted) {
  const calls: Call[] = [];
  let sends = 0;
  const fetcher: Fetcher = (url, init) => {
    const call = { url, body: typeof init.body === 'string' ? init.body : '' };
    calls.push(call);
    if (url === '/api/keys/lookup') {
      const { addresses } = JSON.parse(call.body) as { addresses: string[] };
      return Promise.resolve(
        json(200, { success: true, keys: addresses.map((address) => entryOf(address, directory.get(address) ?? null)) })
      );
    }
    return Promise.resolve(internal(call, sends++));
  };
  return { fetcher, calls, internalCalls: () => calls.filter((call) => call.url === '/api/messages/internal') };
}

function accepted(call: Call): Response {
  const request = JSON.parse(call.body) as { sent: { id: string }; copies: { address: string; plain?: unknown }[] };
  expect(parseInternal(request)).toMatchObject({ ok: true });
  return json(200, {
    success: true,
    e2e: request.copies.every((copy) => copy.plain === undefined),
    message: { id: request.sent.id, folder: 'sent' },
    copies: request.copies.map((copy, index) => ({ address: copy.address, id: `row-${index}`, sealed: copy.plain === undefined }))
  });
}

const USER = 'user-1';
const noBackend = { read: () => Promise.resolve(null), write: () => Promise.resolve(), remove: () => Promise.resolve(), users: () => [] };
const stored = new Map<string, string>();
const storage: PinStorage = {
  getItem: (key) => stored.get(key) ?? null,
  setItem: (key, value) => {
    stored.set(key, value);
  }
};
let me: Person;
let alice: Person;
let bob: Person;

beforeAll(async () => {
  [me, alice, bob] = await Promise.all([person(), person(), person()]);
  setKeyBackend(noBackend);
});

beforeEach(async () => {
  stored.clear();
  setPinStorage(storage);
  await keepKey(USER, me.pair, me.publicKey, { persist: true });
});

afterEach(async () => {
  await wipeKeys();
  setPinStorage(undefined);
});

const SECRET = 'confidential 4711';
const inputFor = (to: string[], more: Partial<FlowInput> = {}): FlowInput => ({
  sender: 'me@example.com',
  primary: 'me@example.com',
  headers: { to, cc: [], bcc: [] },
  content: { subject: `subject ${SECRET}`, text: `text ${SECRET}`, html: `<p>${SECRET}</p>` },
  attachments: [],
  sourceIsE2E: false,
  ...more
});

/** An `ask` that records the questions and answers them all with `answer`. */
const asker = (answer: boolean) => {
  const asked: Question[] = [];
  return {
    asked,
    ask: (question: Question) => {
      asked.push(question);
      return Promise.resolve(answer);
    }
  };
};

const draftOf = (fromE2e: boolean) => ({
  from: 'me@example.com',
  to: ['out@example.org'],
  cc: [],
  bcc: [],
  subject: 'Re: plan',
  text: 'quoted text',
  html: '',
  ...(fromE2e ? { from_e2e: true } : {})
});

describe('runSend', () => {
  it('seals for everyone with keys without asking anything, and pins their keys afterwards', async () => {
    const stub = server(new Map<string, Owner>([['alice@example.com', alice]]));
    const { ask, asked } = asker(true);
    const result = await runSend(inputFor(['alice@example.com']), ask, stub.fetcher);
    expect(result).toMatchObject({ status: 'sent', e2e: true });
    expect(asked).toEqual([]);
    const sent = stub.internalCalls();
    expect(sent).toHaveLength(1);
    expect(sent[0].body).not.toContain(SECRET);
    // The next send to Alice finds her key pinned: same key, nothing to confirm.
    const again = await runSend(inputFor(['alice@example.com']), ask, stub.fetcher);
    expect(again).toMatchObject({ status: 'sent', e2e: true });
    expect(asked).toEqual([]);
  });

  it('asks about a person without keys, sends nothing when the answer is no, and a plain copy (not e2e) when it is yes', async () => {
    const directory = new Map<string, Owner>([
      ['alice@example.com', alice],
      ['carol@example.com', 'nokeys']
    ]);
    const no = asker(false);
    const refused = server(directory);
    expect(await runSend(inputFor(['alice@example.com', 'carol@example.com']), no.ask, refused.fetcher)).toEqual({ status: 'cancelled' });
    expect(no.asked).toEqual([{ kind: 'no_keys', addresses: ['carol@example.com'], inline: false }]);
    expect(refused.internalCalls()).toHaveLength(0);

    const yes = asker(true);
    const stub = server(directory);
    const result = await runSend(inputFor(['alice@example.com', 'carol@example.com']), yes.ask, stub.fetcher);
    expect(result).toMatchObject({ status: 'sent', e2e: false });
    const copies = (JSON.parse(stub.internalCalls()[0].body) as { copies: { address: string; plain?: unknown }[] }).copies;
    expect(copies.map((copy) => [copy.address, copy.plain !== undefined])).toEqual([
      ['alice@example.com', false],
      ['carol@example.com', true]
    ]);
  });

  it('uses the usual route as soon as one address is outside, and warns only for an end-to-end source (N6)', async () => {
    const directory = new Map<string, Owner>([
      ['alice@example.com', alice],
      ['out@example.org', null]
    ]);
    const to = ['alice@example.com', 'out@example.org'];

    const plainSource = asker(true);
    const first = server(directory);
    expect(await runSend(inputFor(to), plainSource.ask, first.fetcher)).toEqual({ status: 'normal' });
    expect(plainSource.asked).toEqual([]);
    expect(first.internalCalls()).toHaveLength(0);

    const no = asker(false);
    expect(await runSend(inputFor(to, { sourceIsE2E: true }), no.ask, server(directory).fetcher)).toEqual({ status: 'cancelled' });
    expect(no.asked).toEqual([{ kind: 'external', addresses: ['out@example.org'] }]);

    const yes = asker(true);
    expect(await runSend(inputFor(to, { sourceIsE2E: true }), yes.ask, server(directory).fetcher)).toEqual({ status: 'normal' });
  });

  it('EC-3: warns before an outside address for a reply that was saved as a draft and opened again, and not for an ordinary draft', async () => {
    const key = { publicKey: me.publicKey, keyId: me.publicKey.keyId };
    const open = { pair: me.pair, keyId: me.publicKey.keyId };
    const id = '44444444-4444-4444-8444-444444444444';
    const reopened = async (fromE2e: boolean) => openDraft(id, { id, ...(await sealDraft(draftOf(fromE2e), id, key)), enc_fmt: 1 }, open);

    const e2eDraft = await reopened(true);
    const no = asker(false);
    const stub = server(new Map<string, Owner>());
    expect(await runSend(inputFor(['out@example.org'], { sourceIsE2E: e2eDraft.from_e2e === true }), no.ask, stub.fetcher)).toEqual({
      status: 'cancelled'
    });
    expect(no.asked).toEqual([{ kind: 'external', addresses: ['out@example.org'] }]);

    const plainDraft = await reopened(false);
    const quiet = asker(false);
    expect(await runSend(inputFor(['out@example.org'], { sourceIsE2E: plainDraft.from_e2e === true }), quiet.ask, stub.fetcher)).toEqual({
      status: 'normal'
    });
    expect(quiet.asked).toEqual([]);
  });

  it('does not warn when an end-to-end message is answered inside this deployment', async () => {
    const { ask, asked } = asker(false);
    const result = await runSend(
      inputFor(['bob@example.com'], { sourceIsE2E: true }),
      ask,
      server(new Map([['bob@example.com', bob]])).fetcher
    );
    expect(result).toMatchObject({ status: 'sent', e2e: true });
    expect(asked).toEqual([]);
  });

  it('sends from another address the usual way: the end-to-end route sends from the account address only', async () => {
    const stub = server(new Map<string, Owner>([['alice@example.com', alice]]));
    const { ask } = asker(true);
    expect(await runSend(inputFor(['alice@example.com'], { sender: 'ALIAS@example.com' }), ask, stub.fetcher)).toEqual({
      status: 'normal'
    });
    expect(stub.internalCalls()).toHaveLength(0);
    // The same address in another case is the account address.
    const same = await runSend(inputFor(['alice@example.com'], { sender: ' Me@Example.com ' }), ask, stub.fetcher);
    expect(same).toMatchObject({ status: 'sent' });
  });

  it('asks before taking the usual route for a message over a cap of the end-to-end route', async () => {
    const big = { subject: 'big', text: 'x'.repeat(1_100_000), html: null };
    const directory = new Map<string, Owner>([['alice@example.com', alice]]);
    const no = asker(false);
    const stub = server(directory);
    expect(await runSend(inputFor(['alice@example.com'], { content: big }), no.ask, stub.fetcher)).toEqual({ status: 'cancelled' });
    expect(no.asked).toEqual([{ kind: 'too_big' }]);
    const yes = asker(true);
    expect(await runSend(inputFor(['alice@example.com'], { content: big }), yes.ask, stub.fetcher)).toEqual({ status: 'normal' });
    expect(stub.internalCalls()).toHaveLength(0);
  });

  it('asks with both fingerprints when a pinned key changed, and sends nothing on no', async () => {
    const before = server(new Map<string, Owner>([['alice@example.com', alice]]));
    await runSend(inputFor(['alice@example.com']), asker(true).ask, before.fetcher);

    const newAlice = await person();
    const directory = new Map<string, Owner>([['alice@example.com', newAlice]]);
    const no = asker(false);
    const stub = server(directory);
    expect(await runSend(inputFor(['alice@example.com']), no.ask, stub.fetcher)).toEqual({ status: 'cancelled' });
    expect(stub.internalCalls()).toHaveLength(0);
    const [question] = no.asked;
    expect(question.kind).toBe('changed');
    if (question.kind !== 'changed') {
      return;
    }
    expect(question.recipients).toHaveLength(1);
    expect(question.recipients[0].fingerprint).toMatch(/^(\d{5} ){5}\d{5}$/);
    expect(question.recipients[0].previousFingerprint).toMatch(/^(\d{5} ){5}\d{5}$/);
    expect(question.recipients[0].fingerprint).not.toBe(question.recipients[0].previousFingerprint);

    // Yes: the send goes to the new key and the new key is the pinned one from then on.
    const yes = asker(true);
    expect(await runSend(inputFor(['alice@example.com']), yes.ask, stub.fetcher)).toMatchObject({ status: 'sent', e2e: true });
    const after = asker(false);
    expect(await runSend(inputFor(['alice@example.com']), after.ask, stub.fetcher)).toMatchObject({ status: 'sent' });
    expect(after.asked).toEqual([]);
  });

  it('EC-2: asks a different question for a person whose pinned key is gone from the answer, and sends nothing on no', async () => {
    const known = server(new Map<string, Owner>([['alice@example.com', alice]]));
    await runSend(inputFor(['alice@example.com']), asker(true).ask, known.fetcher);

    // The server now says Alice is on this deployment but has no keys: not the routine "not set up yet" question.
    const keyless = server(new Map<string, Owner>([['alice@example.com', 'nokeys']]));
    const no = asker(false);
    expect(await runSend(inputFor(['alice@example.com']), no.ask, keyless.fetcher)).toEqual({ status: 'cancelled' });
    expect(no.asked).toEqual([{ kind: 'was_keyed', addresses: ['alice@example.com'] }]);
    expect(keyless.internalCalls()).toHaveLength(0);

    // Yes: one question only (the "no keys" one is covered by it), and the copy for her is in the clear.
    const yes = asker(true);
    const sent = await runSend(inputFor(['alice@example.com']), yes.ask, keyless.fetcher);
    expect(sent).toMatchObject({ status: 'sent', e2e: false });
    expect(yes.asked.map((question) => question.kind)).toEqual(['was_keyed']);
  });

  it('EC-2: the same question when the pinned person is now outside this deployment, before the usual route, and not for a stranger', async () => {
    const known = server(new Map<string, Owner>([['alice@example.com', alice]]));
    await runSend(inputFor(['alice@example.com']), asker(true).ask, known.fetcher);

    const outside = server(new Map<string, Owner>());
    const no = asker(false);
    expect(await runSend(inputFor(['alice@example.com']), no.ask, outside.fetcher)).toEqual({ status: 'cancelled' });
    expect(no.asked).toEqual([{ kind: 'was_keyed', addresses: ['alice@example.com'] }]);
    expect(await runSend(inputFor(['alice@example.com']), asker(true).ask, outside.fetcher)).toEqual({ status: 'normal' });

    // Somebody never pinned is an ordinary outside address: no question.
    const stranger = asker(false);
    expect(await runSend(inputFor(['zed@example.org']), stranger.ask, outside.fetcher)).toEqual({ status: 'normal' });
    expect(stranger.asked).toEqual([]);
  });

  it('CAT-11: an address deleted and created again is asked about twice: it lost its keys, then it has other keys', async () => {
    const before = server(new Map<string, Owner>([['alice@example.com', alice]]));
    await runSend(inputFor(['alice@example.com']), asker(true).ask, before.fetcher);

    // Deleted: gone from the server.
    const deleted = asker(true);
    expect(await runSend(inputFor(['alice@example.com']), deleted.ask, server(new Map<string, Owner>()).fetcher)).toEqual({
      status: 'normal'
    });
    expect(deleted.asked.map((question) => question.kind)).toEqual(['was_keyed']);

    // Created again and set up: other keys, so the person is asked to confirm the new key, with both fingerprints.
    const again = await person();
    const recreated = server(new Map<string, Owner>([['alice@example.com', again]]));
    const no = asker(false);
    expect(await runSend(inputFor(['alice@example.com']), no.ask, recreated.fetcher)).toEqual({ status: 'cancelled' });
    expect(no.asked.map((question) => question.kind)).toEqual(['changed']);
    expect(recreated.internalCalls()).toHaveLength(0);
    const yes = asker(true);
    expect(await runSend(inputFor(['alice@example.com']), yes.ask, recreated.fetcher)).toMatchObject({ status: 'sent', e2e: true });
    expect(yes.asked.map((question) => question.kind)).toEqual(['changed']);
  });

  it('EC-9: once the person confirmed that an address left, the question is not asked again, but a key that shows up later is still a change to confirm', async () => {
    await runSend(inputFor(['alice@example.com']), asker(true).ask, server(new Map<string, Owner>([['alice@example.com', alice]])).fetcher);
    const outside = server(new Map<string, Owner>());

    const first = asker(true);
    expect(await runSend(inputFor(['alice@example.com']), first.ask, outside.fetcher)).toEqual({ status: 'normal' });
    expect(first.asked.map((question) => question.kind)).toEqual(['was_keyed']);
    // Kept with the pin on a personal device (a public yes/no and a time, not a secret).
    expect(stored.get(pinsStorageKey(USER)) ?? '').toContain('"gone":');

    // The next sends to an address that is plainly outside now are no longer interrupted.
    const second = asker(false);
    expect(await runSend(inputFor(['alice@example.com']), second.ask, outside.fetcher)).toEqual({ status: 'normal' });
    expect(second.asked).toEqual([]);

    // The pin stayed: the address comes back (deleted and created again, S3) with other keys, and that is a change to confirm.
    const again = await person();
    const recreated = server(new Map<string, Owner>([['alice@example.com', again]]));
    const no = asker(false);
    expect(await runSend(inputFor(['alice@example.com']), no.ask, recreated.fetcher)).toEqual({ status: 'cancelled' });
    expect(no.asked.map((question) => question.kind)).toEqual(['changed']);
    expect(recreated.internalCalls()).toHaveLength(0);
  });

  it('EC-9: the pinned key coming back ends that state, so a later disappearance is asked about afresh', async () => {
    const known = server(new Map<string, Owner>([['alice@example.com', alice]]));
    const outside = server(new Map<string, Owner>());
    await runSend(inputFor(['alice@example.com']), asker(true).ask, known.fetcher);
    await runSend(inputFor(['alice@example.com']), asker(true).ask, outside.fetcher);

    const back = asker(false);
    expect(await runSend(inputFor(['alice@example.com']), back.ask, known.fetcher)).toMatchObject({ status: 'sent', e2e: true });
    expect(back.asked).toEqual([]);
    expect(stored.get(pinsStorageKey(USER)) ?? '').not.toContain('"gone":');

    const gone = asker(true);
    expect(await runSend(inputFor(['alice@example.com']), gone.ask, outside.fetcher)).toEqual({ status: 'normal' });
    expect(gone.asked.map((question) => question.kind)).toEqual(['was_keyed']);
  });

  it('EC-9: a "no" is not a confirmation, and an address that is on this server but has no keys is asked about every time', async () => {
    await runSend(inputFor(['alice@example.com']), asker(true).ask, server(new Map<string, Owner>([['alice@example.com', alice]])).fetcher);
    const outside = server(new Map<string, Owner>());
    expect(await runSend(inputFor(['alice@example.com']), asker(false).ask, outside.fetcher)).toEqual({ status: 'cancelled' });
    const again = asker(false);
    expect(await runSend(inputFor(['alice@example.com']), again.ask, outside.fetcher)).toEqual({ status: 'cancelled' });
    expect(again.asked.map((question) => question.kind)).toEqual(['was_keyed']);

    // Not outside, only without keys yet (deleted and created again, not set up): not "gone", asked on every send until the person has keys.
    const keyless = server(new Map<string, Owner>([['alice@example.com', 'nokeys']]));
    await runSend(inputFor(['alice@example.com']), asker(true).ask, keyless.fetcher);
    const next = asker(true);
    await runSend(inputFor(['alice@example.com']), next.ask, keyless.fetcher);
    expect(next.asked.map((question) => question.kind)).toEqual(['was_keyed']);
  });

  it('plans again with the fresh keys of a 409 key_changed, asks about them, and asks nothing twice', async () => {
    const newBob = await person();
    const directory = new Map<string, Owner>([
      ['bob@example.com', bob],
      ['carol@example.com', 'nokeys']
    ]);
    // Bob had been pinned before.
    await runSend(inputFor(['bob@example.com']), asker(true).ask, server(directory).fetcher);

    const stub = server(directory, (call, index) =>
      index === 0
        ? json(409, {
            success: false,
            code: 'key_changed',
            keys: [entryOf('bob@example.com', newBob), entryOf('carol@example.com', 'nokeys')],
            own_key: { public_key: me.spki, key_id: me.publicKey.keyId }
          })
        : accepted(call)
    );
    const { ask, asked } = asker(true);
    const result = await runSend(inputFor(['bob@example.com', 'carol@example.com']), ask, stub.fetcher);
    expect(result).toMatchObject({ status: 'sent', e2e: false });
    // Carol once (before the first post); Bob's changed key once (after the answer): the first post found nothing changed, as Bob was the pinned key.
    expect(asked.map((question) => question.kind)).toEqual(['no_keys', 'changed']);
    const sent = stub.internalCalls();
    expect(sent).toHaveLength(2);
    const last = JSON.parse(sent[1].body) as { copies: { address: string; key_id?: string }[] };
    expect(last.copies.find((copy) => copy.address === 'bob@example.com')?.key_id).toBe(newBob.publicKey.keyId);
  });

  it('fails with the typed error while the key is locked, and sends nothing; the usual route needs no key', async () => {
    const stub = server(
      new Map<string, Owner>([
        ['alice@example.com', alice],
        ['out@example.org', null]
      ])
    );
    const { ask } = asker(true);
    expect(await runSend(inputFor(['out@example.org']), ask, stub.fetcher)).toEqual({ status: 'normal' });
    await wipeKeys();
    await expect(runSend(inputFor(['alice@example.com']), ask, stub.fetcher)).rejects.toMatchObject({ reason: 'locked' });
    expect(stub.internalCalls()).toHaveLength(0);
    expect(await runSend(inputFor(['out@example.org']), ask, stub.fetcher)).toEqual({ status: 'normal' });
  });

  it('takes more addresses than the end-to-end route allows the usual way, asking about all of them for an end-to-end source', async () => {
    const to = Array.from({ length: 51 }, (_, index) => `person${String(index)}@example.com`);
    const stub = server(new Map());
    const plain = asker(true);
    expect(await runSend(inputFor(to), plain.ask, stub.fetcher)).toEqual({ status: 'normal' });
    expect(plain.asked).toEqual([]);
    const source = asker(false);
    expect(await runSend(inputFor(to, { sourceIsE2E: true }), source.ask, stub.fetcher)).toEqual({ status: 'cancelled' });
    expect(source.asked).toEqual([{ kind: 'external', addresses: to }]);
    expect(stub.calls).toHaveLength(0);
  });

  it('tells the person with the question when an inline image will lose its place in a copy in the clear', async () => {
    const directory = new Map<string, Owner>([['carol@example.com', 'nokeys']]);
    const inlineImage = { filename: 'logo.png', mimeType: 'image/png', contentId: '<logo@x>', bytes: utf8('png') };
    const withImage = asker(false);
    await runSend(inputFor(['carol@example.com'], { attachments: [inlineImage] }), withImage.ask, server(directory).fetcher);
    expect(withImage.asked).toEqual([{ kind: 'no_keys', addresses: ['carol@example.com'], inline: true }]);
    const plainFile = asker(false);
    await runSend(
      inputFor(['carol@example.com'], { attachments: [{ ...inlineImage, contentId: null }] }),
      plainFile.ask,
      server(directory).fetcher
    );
    expect(plainFile.asked).toEqual([{ kind: 'no_keys', addresses: ['carol@example.com'], inline: false }]);
  });

  it('treats a cap the server enforces (413, or a 400 about the request or the recipients) as the too-big question, nothing stored', async () => {
    const directory = new Map<string, Owner>([['alice@example.com', alice]]);
    const refusals = [
      json(413, { success: false, error: 'The request is too large', code: 'payload_too_large' }),
      json(400, { success: false, error: 'The request is not valid', code: 'invalid_request' }),
      json(400, { success: false, error: 'A message can have at most 50 different recipients', code: 'too_many_recipients' })
    ];
    for (const refusal of refusals) {
      const no = asker(false);
      expect(await runSend(inputFor(['alice@example.com']), no.ask, server(directory, () => refusal.clone()).fetcher)).toEqual({
        status: 'cancelled'
      });
      expect(no.asked).toEqual([{ kind: 'too_big' }]);
      const yes = asker(true);
      expect(await runSend(inputFor(['alice@example.com']), yes.ask, server(directory, () => refusal.clone()).fetcher)).toEqual({
        status: 'normal'
      });
    }
  });

  it('does not take any other refusal of the server for a cap: it is shown as it is', async () => {
    const directory = new Map<string, Owner>([['alice@example.com', alice]]);
    const other = json(400, { success: false, error: 'Some recipients are not on this Edging Mail', code: 'recipient_not_internal' });
    const { ask, asked } = asker(true);
    await expect(runSend(inputFor(['alice@example.com']), ask, server(directory, () => other.clone()).fetcher)).rejects.toMatchObject({
      status: 400,
      code: 'recipient_not_internal'
    });
    expect(asked).toEqual([]);
  });

  it('never puts the plaintext of a sealed send in a request, and sends the attachment sealed', async () => {
    const stub = server(new Map<string, Owner>([['alice@example.com', alice]]));
    const bytes = utf8(`attachment ${SECRET}`);
    const input = inputFor(['alice@example.com'], {
      attachments: [{ filename: `file-${SECRET}.txt`, mimeType: 'text/plain', contentId: null, bytes }]
    });
    await runSend(input, asker(true).ask, stub.fetcher);
    const body = stub.internalCalls()[0].body;
    expect(body).not.toContain(SECRET);
    expect(body).not.toContain(btoa(`attachment ${SECRET}`));
  });
});
