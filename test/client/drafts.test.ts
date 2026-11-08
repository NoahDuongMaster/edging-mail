import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { fromBase64Url, generateUserKeyPair, toBase64Url } from '../../src/shared/crypto/client';
import type { PublicKey } from '../../src/shared/crypto/client';
import { keepKey, setKeyBackend, wipeKeys } from '../../src/client/lib/crypto/keyStore';
import { DraftOpenError, DraftSaver, draftSnippet, fetchDraft, openDraft, sealDraft } from '../../src/client/lib/drafts';
import type { DraftFields, DraftRow, DraftStatus, SealedDraftBody } from '../../src/client/lib/drafts';
import { tr } from '../../src/client/lib/i18n';
import { clearCeks } from '../../src/client/lib/mailcrypto/cek';
import { openListRow } from '../../src/client/lib/mailcrypto/rows';
import type { OpenKey } from '../../src/client/lib/mailcrypto/types';
import type { Message } from '../../src/client/types';

// Drafts are sealed in the browser on every save and opened when a draft is reopened (EM1, crypto-design.md section 5; the Worker side
// is src/worker/drafts.ts). Real keys and real blobs, no DOM and no network: `window` is a minimal stub with timers the test fires by hand.

const USER = '11111111-1111-4111-8111-111111111111';
const ID = '22222222-2222-4222-8222-222222222222';
const OTHER_ID = '33333333-3333-4333-8333-333333333333';

const noop = (): void => {
  // Nothing: a stand-in for a callback or a console method.
};

interface Keys {
  pair: CryptoKeyPair;
  publicKey: PublicKey;
  keyId: string;
}

async function newKeys(): Promise<Keys> {
  const { privateKey, publicKey } = await generateUserKeyPair();
  return { pair: { privateKey, publicKey: publicKey.key }, publicKey, keyId: publicKey.keyId };
}

const FIELDS: DraftFields = {
  from: 'me@example.com',
  to: ['ann@example.com', 'bob@example.com'],
  cc: ['cat@example.com'],
  bcc: [],
  subject: 'Zebra quarterly plan',
  text: 'Meet at the harbour\n\n  on   Friday',
  html: '<p>Meet at the <b>harbour</b></p>',
  in_reply_to: '<abc@example.com>'
};

let mine: Keys;
let other: Keys;

const openKeyOf = (keys: Keys): OpenKey => ({ pair: keys.pair, keyId: keys.keyId });
const rowOf = (body: SealedDraftBody, id = ID): DraftRow => ({ id, ...body, enc_fmt: 1 });

/** The sealed draft as the Drafts folder list returns it: an ordinary encrypted message row. */
const listRowOf = (body: SealedDraftBody): Message =>
  ({
    ...body,
    id: ID,
    enc_fmt: 1,
    wrap_kind: 'user',
    folder: 'drafts',
    from_address: body.from,
    to_address: body.to.join(', '),
    is_read: 1,
    is_starred: 0,
    has_attachments: 0,
    size: 100,
    created_at: 1,
    updated_at: 1
  }) as unknown as Message;

/** The same text with one byte of the sealed blob changed. */
const tamper = (blob: string): string => {
  const bytes = fromBase64Url(blob);
  bytes[bytes.length - 20] ^= 1;
  return toBase64Url(bytes);
};

beforeAll(async () => {
  mine = await newKeys();
  other = await newKeys();
  setKeyBackend({ read: () => Promise.resolve(null), write: () => Promise.resolve(), remove: () => Promise.resolve(), users: () => [] });
});

beforeEach(async () => {
  await keepKey(USER, mine.pair, mine.publicKey, { persist: false });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await wipeKeys();
  clearCeks();
});

describe('sealing a draft', () => {
  it('gives the body the Worker wants: recipients in clear, four sealed values, and nothing else', async () => {
    const body = await sealDraft(FIELDS, ID, mine);
    expect(Object.keys(body).toSorted()).toEqual(
      ['bcc', 'body_blob', 'cc', 'from', 'in_reply_to', 'key_id', 'summary_blob', 'to', 'wrapped_cek'].toSorted()
    );
    expect(body).toMatchObject({ from: FIELDS.from, to: FIELDS.to, cc: FIELDS.cc, bcc: FIELDS.bcc, in_reply_to: FIELDS.in_reply_to });
    expect(body.key_id).toBe(mine.keyId);
    // The Worker's own shape check: canonical base64url, a one-byte version, the 131-byte sealed key.
    expect(fromBase64Url(body.wrapped_cek)).toHaveLength(131);
    expect(fromBase64Url(body.summary_blob)[0]).toBe(1);
    expect(fromBase64Url(body.body_blob)[0]).toBe(1);
  });

  it('leaves in_reply_to out when the draft answers nothing', async () => {
    const { in_reply_to: _unused, ...plain } = FIELDS;
    const body = await sealDraft(plain, ID, mine);
    expect('in_reply_to' in body).toBe(false);
  });

  it('puts no part of the subject, the text or the html in the body in clear', async () => {
    const json = JSON.stringify(await sealDraft(FIELDS, ID, mine));
    for (const fragment of ['Zebra', 'quarterly', 'plan', 'harbour', 'Friday', '<p>', '<b>', 'Meet']) {
      expect(json).not.toContain(fragment);
    }
  });

  it('EC-3: carries the end-to-end flag of the source inside the sealed body only, never as a field or a column', async () => {
    const body = await sealDraft({ ...FIELDS, from_e2e: true }, ID, mine);
    // The request has exactly the keys it had before, and the flag is not readable in it.
    expect(Object.keys(body).toSorted()).toEqual(
      ['bcc', 'body_blob', 'cc', 'from', 'in_reply_to', 'key_id', 'summary_blob', 'to', 'wrapped_cek'].toSorted()
    );
    expect(JSON.stringify(body)).not.toContain('from_e2e');
    expect(await openDraft(ID, rowOf(body), openKeyOf(mine))).toEqual({ id: ID, ...FIELDS, from_e2e: true });
  });

  it('EC-3: a draft of a source that was not end-to-end opens with no flag, whether it was false or absent', async () => {
    for (const fields of [FIELDS, { ...FIELDS, from_e2e: false }]) {
      const opened = await openDraft(ID, rowOf(await sealDraft(fields, ID, mine)), openKeyOf(mine));
      expect('from_e2e' in opened).toBe(false);
    }
  });

  it('makes a new content key on every save: the same fields never give the same blobs or sealed key', async () => {
    const first = await sealDraft(FIELDS, ID, mine);
    const second = await sealDraft(FIELDS, ID, mine);
    expect(second.wrapped_cek).not.toBe(first.wrapped_cek);
    expect(second.summary_blob).not.toBe(first.summary_blob);
    expect(second.body_blob).not.toBe(first.body_blob);
    // Both open, to the same text.
    expect(await openDraft(ID, rowOf(first), openKeyOf(mine))).toEqual(await openDraft(ID, rowOf(second), openKeyOf(mine)));
  });

  it('keeps a preview of 140 characters with the whitespace collapsed', () => {
    expect(draftSnippet('  Meet at the harbour\n\n  on   Friday ')).toBe('Meet at the harbour on Friday');
    expect(draftSnippet('a'.repeat(500))).toBe('a'.repeat(140));
    expect(draftSnippet('')).toBe('');
    // Not cut in the middle of an emoji.
    expect(draftSnippet(`${'a'.repeat(139)}😀 and more`)).toBe('a'.repeat(139));
  });
});

describe('opening a draft', () => {
  it('opens what was sealed: the same fields come back', async () => {
    const opened = await openDraft(ID, rowOf(await sealDraft(FIELDS, ID, mine)), openKeyOf(mine));
    expect(opened).toEqual({ id: ID, ...FIELDS });
  });

  it('opens a draft without an in_reply_to', async () => {
    const { in_reply_to: _unused, ...plain } = FIELDS;
    const opened = await openDraft(ID, rowOf(await sealDraft(plain, ID, mine)), openKeyOf(mine));
    expect(opened).toEqual({ id: ID, ...plain });
  });

  it('opens as an ordinary list row of the Drafts folder, with the subject and the preview', async () => {
    const row = await openListRow(listRowOf(await sealDraft(FIELDS, ID, mine)), openKeyOf(mine));
    expect(row).toMatchObject({ subject: 'Zebra quarterly plan', snippet: 'Meet at the harbour on Friday', mail_state: 'ready' });
  });

  it('refuses a draft sealed to another key id with the catalogue text', async () => {
    const body = await sealDraft(FIELDS, ID, other);
    const failure = await openDraft(ID, rowOf(body), openKeyOf(mine)).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DraftOpenError);
    expect((failure as DraftOpenError).reason).toBe('other_key');
    expect((failure as DraftOpenError).message).toBe(tr('drafts.other_key'));
    expect((failure as DraftOpenError).message).not.toBe('drafts.other_key');
  });

  it('refuses a draft when the key does not open it, even with the right key id', async () => {
    const body = await sealDraft(FIELDS, ID, other);
    const wrongPair: OpenKey = { pair: mine.pair, keyId: other.keyId };
    const failure = await openDraft(ID, rowOf(body), wrongPair).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DraftOpenError);
    expect((failure as DraftOpenError).reason).toBe('damaged');
    expect((failure as DraftOpenError).message).toBe(tr('fail.drafts_open'));
  });

  it('refuses a damaged blob, and the blob of another draft id', async () => {
    const body = await sealDraft(FIELDS, ID, mine);
    await expect(openDraft(ID, rowOf({ ...body, body_blob: tamper(body.body_blob) }), openKeyOf(mine))).rejects.toMatchObject({
      reason: 'damaged'
    });
    await expect(openDraft(ID, rowOf({ ...body, summary_blob: tamper(body.summary_blob) }), openKeyOf(mine))).rejects.toMatchObject({
      reason: 'damaged'
    });
    // The seal is bound to the draft id: the same row presented as another draft does not open.
    await expect(openDraft(OTHER_ID, rowOf(body, OTHER_ID), openKeyOf(mine))).rejects.toMatchObject({ reason: 'damaged' });
  });

  it('says the draft is locked while no key is unlocked', async () => {
    const body = await sealDraft(FIELDS, ID, mine);
    const failure = await openDraft(ID, rowOf(body), null).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(DraftOpenError);
    expect((failure as DraftOpenError).reason).toBe('locked');
    expect((failure as DraftOpenError).message).toBe(tr('drafts.locked'));
  });

  it('opens a plaintext draft from before encryption as it is, with no key at all', async () => {
    const legacy: DraftRow = {
      id: ID,
      from: 'me@example.com',
      to: ['ann@example.com'],
      cc: [],
      bcc: [],
      enc_fmt: 0,
      key_id: null,
      wrapped_cek: null,
      summary_blob: null,
      body_blob: null,
      subject: 'Old subject',
      text: 'Old text',
      html: '<p>Old text</p>'
    };
    expect(await openDraft(ID, legacy, null)).toEqual({
      id: ID,
      from: 'me@example.com',
      to: ['ann@example.com'],
      cc: [],
      bcc: [],
      subject: 'Old subject',
      text: 'Old text',
      html: '<p>Old text</p>'
    });
  });

  it('does not take an encrypted row without a sealed key for a plaintext draft', async () => {
    const body = await sealDraft(FIELDS, ID, mine);
    await expect(openDraft(ID, { ...rowOf(body), wrapped_cek: null }, openKeyOf(mine))).rejects.toMatchObject({ reason: 'damaged' });
  });
});

interface Call {
  method: string;
  url: string;
  body: unknown;
}

/** `handler` answers each call (any call it returns null for is answered `{ success: true }`). Returns the calls made. */
function stubFetch(handler: (call: Call) => Response | null = () => null): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? 'GET',
        url,
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
      };
      calls.push(call);
      return Promise.resolve(handler(call) ?? Response.json({ success: true }));
    })
  );
  return calls;
}

const conflict = (code = 'conflict'): Response => Response.json({ success: false, error: 'conflict', code }, { status: 409 });
const keysAnswer = (keyId: string): Response => Response.json({ success: true, keys: { key_id: keyId }, retired: [] });
const puts = (calls: Call[]): SealedDraftBody[] =>
  calls.filter((call) => call.method === 'PUT').map((call) => call.body as SealedDraftBody);

describe('fetchDraft', () => {
  it('reads GET /api/drafts/:id and opens it with the unlocked key', async () => {
    const body = await sealDraft(FIELDS, ID, mine);
    const calls = stubFetch(() => Response.json({ success: true, draft: rowOf(body) }));
    expect(await fetchDraft(ID)).toEqual({ id: ID, ...FIELDS });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([`GET /api/drafts/${ID}`]);
  });

  it('throws the locked error while the key is not unlocked', async () => {
    const body = await sealDraft(FIELDS, ID, mine);
    stubFetch(() => Response.json({ success: true, draft: rowOf(body) }));
    await wipeKeys();
    await expect(fetchDraft(ID)).rejects.toMatchObject({ name: 'DraftOpenError', reason: 'locked', message: tr('drafts.locked') });
  });

  it('opens a plaintext draft the old way', async () => {
    stubFetch(() =>
      Response.json({
        success: true,
        draft: {
          id: ID,
          from: 'me@example.com',
          to: [],
          cc: [],
          bcc: [],
          enc_fmt: 0,
          key_id: null,
          wrapped_cek: null,
          subject: 'S',
          text: 'T',
          html: ''
        }
      })
    );
    await wipeKeys();
    expect(await fetchDraft(ID)).toEqual({ id: ID, from: 'me@example.com', to: [], cc: [], bcc: [], subject: 'S', text: 'T', html: '' });
  });
});

/** The compose's saver with `window` replaced by a stub whose timers only run when the test fires them. */
function saverHarness(fields: DraftFields = FIELDS) {
  const timers = new Map<number, { run: () => void; ms: number }>();
  let next = 1;
  vi.stubGlobal('window', {
    addEventListener: noop,
    removeEventListener: noop,
    setTimeout: (run: () => void, ms: number) => {
      const id = next++;
      timers.set(id, { run, ms });
      return id;
    },
    clearTimeout: (id: number | undefined) => {
      if (id !== undefined) {
        timers.delete(id);
      }
    }
  });
  const statuses: DraftStatus[] = [];
  let settle: ((status: DraftStatus) => void) | undefined;
  const saver = new DraftSaver({
    id: ID,
    onServer: false,
    read: () => ({ fields, empty: false, key: 'edited', baseline: 'opened' }),
    onStatus: (status) => {
      statuses.push(status);
      if (status === 'saved' || status === 'error') {
        settle?.(status);
      }
    },
    onEnded: noop,
    onLost: noop
  });
  /** Runs the pending timer of `ms` and resolves with how the save it starts ends (once the saver has finished its turn, retry timer included). */
  const fire = async (ms: number): Promise<DraftStatus> => {
    const entry = [...timers.entries()].find(([, timer]) => timer.ms === ms);
    if (entry === undefined) {
      throw new Error(`no timer of ${ms} ms is pending`);
    }
    timers.delete(entry[0]);
    const done = new Promise<DraftStatus>((resolve) => {
      settle = resolve;
    });
    entry[1].run();
    const status = await done;
    // The status is announced inside the save; the retry is scheduled a few microtasks later.
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    return status;
  };
  return { saver, statuses, fire, pending: () => [...timers.values()].map((timer) => timer.ms) };
}

describe('the draft saver seals every autosave', () => {
  it('sends a sealed body, 1.5 s after the last change, that opens with the key', async () => {
    const calls = stubFetch();
    const { saver, statuses, fire, pending } = saverHarness();
    saver.touch();
    expect(pending()).toEqual([1500]);
    expect(await fire(1500)).toBe('saved');
    expect(statuses).toEqual(['saving', 'saved']);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([`PUT /api/drafts/${ID}`]);
    const [sent] = puts(calls);
    expect(JSON.stringify(sent)).not.toMatch(/Zebra|harbour|<p>/);
    expect(await openDraft(ID, rowOf(sent), openKeyOf(mine))).toEqual({ id: ID, ...FIELDS });
    await saver.discard();
  });

  it('EC-3: an autosave of a reply to an end-to-end message keeps the flag in the sealed body', async () => {
    const calls = stubFetch();
    const { saver, fire } = saverHarness({ ...FIELDS, from_e2e: true });
    saver.touch();
    expect(await fire(1500)).toBe('saved');
    const [sent] = puts(calls);
    expect(JSON.stringify(sent)).not.toContain('from_e2e');
    expect((await openDraft(ID, rowOf(sent), openKeyOf(mine))).from_e2e).toBe(true);
    await saver.discard();
  });

  it('fails the save while locked: nothing is sent, the status is error, and the retry comes 5 s later', async () => {
    const calls = stubFetch();
    const errors = vi.spyOn(console, 'error').mockImplementation(noop);
    await wipeKeys();
    const { saver, statuses, fire, pending } = saverHarness();
    saver.touch();
    expect(await fire(1500)).toBe('error');
    expect(statuses).toEqual(['saving', 'error']);
    expect(calls).toEqual([]);
    expect(pending()).toEqual([5000]);
    // Nothing of the draft reached the log.
    expect(JSON.stringify(errors.mock.calls)).not.toMatch(/Zebra|harbour|ann@example/);

    // The person unlocks; the retry saves it.
    await keepKey(USER, mine.pair, mine.publicKey, { persist: false });
    expect(await fire(5000)).toBe('saved');
    expect(puts(calls)).toHaveLength(1);
    await saver.discard();
  });

  it('fails the save when the key is stale: a 409 and a different key id on the server, one PUT', async () => {
    const calls = stubFetch((call) => (call.method === 'PUT' ? conflict() : call.url === '/api/keys/me' ? keysAnswer(other.keyId) : null));
    vi.spyOn(console, 'error').mockImplementation(noop);
    const { saver, statuses, fire, pending } = saverHarness();
    saver.touch();
    expect(await fire(1500)).toBe('error');
    expect(statuses).toEqual(['saving', 'error']);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([`PUT /api/drafts/${ID}`, 'GET /api/keys/me']);
    expect(pending()).toEqual([5000]);
    await saver.discard();
  });

  it('tries once more when the 409 was a race: the server holds the same key', async () => {
    let putAnswers = 0;
    const calls = stubFetch((call) => {
      if (call.method === 'PUT') {
        putAnswers += 1;
        return putAnswers === 1 ? conflict() : null;
      }
      return call.url === '/api/keys/me' ? keysAnswer(mine.keyId) : null;
    });
    const { saver, statuses, fire } = saverHarness();
    saver.touch();
    expect(await fire(1500)).toBe('saved');
    expect(statuses).toEqual(['saving', 'saved']);
    expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `PUT /api/drafts/${ID}`,
      'GET /api/keys/me',
      `PUT /api/drafts/${ID}`
    ]);
    const [first, second] = puts(calls);
    // The second try is sealed afresh.
    expect(second.wrapped_cek).not.toBe(first.wrapped_cek);
    expect(await openDraft(ID, rowOf(second), openKeyOf(mine))).toEqual({ id: ID, ...FIELDS });
    await saver.discard();
  });

  it('retries only once: a second 409 fails the save', async () => {
    const calls = stubFetch((call) => (call.method === 'PUT' ? conflict() : call.url === '/api/keys/me' ? keysAnswer(mine.keyId) : null));
    vi.spyOn(console, 'error').mockImplementation(noop);
    const { saver, fire } = saverHarness();
    saver.touch();
    expect(await fire(1500)).toBe('error');
    expect(puts(calls)).toHaveLength(2);
    await saver.discard();
  });

  it('does not ask for the keys after any other failure', async () => {
    const calls = stubFetch((call) => (call.method === 'PUT' ? conflict('not_a_draft') : null));
    vi.spyOn(console, 'error').mockImplementation(noop);
    const { saver, fire } = saverHarness();
    saver.touch();
    expect(await fire(1500)).toBe('error');
    expect(calls.filter((call) => call.url === '/api/keys/me')).toEqual([]);
    await saver.discard();
  });
});
