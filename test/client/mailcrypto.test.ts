import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { fromBase64Url, generateUserKeyPair, toBase64Url, utf8 } from '../../src/shared/crypto/client';
import type { Bytes, PublicKey } from '../../src/shared/crypto/client';
import { sealMessage } from '../../src/worker/mail/seal';
import type { AttachmentContent, MessageContent } from '../../src/worker/mail/seal';
import { UnauthorizedError } from '../../src/client/lib/api';
import { setKeyBackend, wipeKeys } from '../../src/client/lib/crypto/keyStore';
import { cachedCekCount, clearCeks, keyEpoch, sealState } from '../../src/client/lib/mailcrypto/cek';
import { openAttachmentBytes, openRawBytes, safeFileName } from '../../src/client/lib/mailcrypto/files';
import { loadEmbeddedImages, normalizeCid } from '../../src/client/lib/mailcrypto/inline';
import { openDetail, openListRow } from '../../src/client/lib/mailcrypto/rows';
import { matchesQuery, withLoadedMatches } from '../../src/client/lib/mailcrypto/search';
import { MailOpenError } from '../../src/client/lib/mailcrypto/types';
import type { Fetcher, OpenKey } from '../../src/client/lib/mailcrypto/types';
import type { Attachment, Message } from '../../src/client/types';

// The reader opens what the Worker's own sealing code writes (src/worker/mail/seal.ts), with real keys and real blobs. No DOM, no network.

const OWNER = '11111111-1111-4111-8111-111111111111';
const ROW = '22222222-2222-4222-8222-222222222222';
const LOGO = '33333333-3333-4333-8333-333333333333';
const REPORT = '44444444-4444-4444-8444-444444444444';

interface Keys {
  key: OpenKey;
  publicKey: PublicKey;
}

async function newKeys(): Promise<Keys> {
  const { privateKey, publicKey } = await generateUserKeyPair();
  return { key: { pair: { privateKey, publicKey: publicKey.key }, keyId: publicKey.keyId }, publicKey };
}

const CONTENT: MessageContent = {
  subject: 'Quarterly numbers',
  snippet: 'The totals are in',
  text: 'Plain body',
  html: '<p>HTML body <img src="cid:logo@x"></p>'
};
const LOGO_BYTES: Bytes = Uint8Array.from([137, 80, 78, 71, 1, 2, 3, 4]);
const REPORT_BYTES: Bytes = utf8('report bytes');
const RAW: Bytes = utf8('From: a@example.com\r\n\r\nraw mail');
const FILES: AttachmentContent[] = [
  { id: LOGO, filename: 'logo.png', mime_type: 'image/png', content_id: '<logo@x>', bytes: LOGO_BYTES },
  { id: REPORT, filename: 'Báo cáo.pdf', mime_type: 'application/pdf', content_id: null, bytes: REPORT_BYTES }
];

interface Fixture {
  list: Message;
  detail: Message & { body_blob: string };
  attachments: Attachment[];
  fetcher: Fetcher;
}

/** One message sealed by the Worker's code to `owner`, as the routes would return it. */
async function fixture(owner: PublicKey, content: MessageContent = CONTENT): Promise<Fixture> {
  const sealed = await sealMessage({ kind: 'user', key: owner }, OWNER, ROW, content, RAW, FILES);
  const { body_blob: bodyBlob, ...columns } = sealed.columns;
  const list = {
    ...columns,
    id: ROW,
    from_address: 'a@example.com',
    to_address: 'me@example.com',
    folder: 'inbox',
    is_read: 0,
    is_starred: 0,
    has_attachments: 1,
    size: 100,
    created_at: 1000,
    updated_at: 1000
  } as unknown as Message;
  const stored = new Map(sealed.objects.map((object) => [object.key, object.body]));
  const attachments: Attachment[] = sealed.attachments.map((item) => ({
    id: item.id,
    message_id: ROW,
    filename: '',
    mime_type: '',
    size: item.id === LOGO ? LOGO_BYTES.length : REPORT_BYTES.length,
    r2_key: item.r2_key,
    content_id: null,
    is_inline: 0,
    created_at: 1,
    meta_blob: item.meta_blob
  }));
  const fetcher: Fetcher = (url) => {
    const raw = stored.get(`em1/${OWNER}/${ROW}/raw`);
    const bytes = url === `/api/raw/${ROW}` ? raw : stored.get(attachments.find((a) => url === `/api/attachments/${a.id}`)?.r2_key ?? '');
    return Promise.resolve(bytes === undefined ? new Response('missing', { status: 404 }) : new Response(bytes));
  };
  return { list, detail: { ...list, body_blob: bodyBlob }, attachments, fetcher };
}

const garbled: Fetcher = () => Promise.resolve(new Response(utf8('not a sealed blob at all, just text that is long enough')));
const gone: Fetcher = () => Promise.resolve(new Response('', { status: 404 }));
const signedOut: Fetcher = () => Promise.resolve(new Response('', { status: 401 }));

/** The same text with one byte of the sealed blob changed. */
const tamper = (blob: string): string => {
  const bytes = fromBase64Url(blob);
  bytes[bytes.length - 20] ^= 1;
  return toBase64Url(bytes);
};

let mine: Keys;
let other: Keys;
let sealed: Fixture;

beforeAll(async () => {
  mine = await newKeys();
  other = await newKeys();
  sealed = await fixture(mine.publicKey);
  setKeyBackend({ read: () => Promise.resolve(null), write: () => Promise.resolve(), remove: () => Promise.resolve(), users: () => [] });
});

afterEach(() => clearCeks());

/** The embedded pictures of the fixture message; `overrides` changes the logo attachment first. */
async function pictures(cids: string[], overrides: Partial<Attachment> = {}) {
  const { message, attachments } = await openDetail(sealed.detail, sealed.attachments, mine.key);
  const changed = attachments.map((a) => (a.id === LOGO ? { ...a, ...overrides } : a));
  return loadEmbeddedImages(message, changed, cids, mine.key, sealed.fetcher);
}

describe('opening a message sealed to the unlocked key', () => {
  it('fills in the subject and snippet of a list row', async () => {
    const row = await openListRow(sealed.list, mine.key);
    expect(row).toMatchObject({ subject: 'Quarterly numbers', snippet: 'The totals are in', mail_state: 'ready' });
    expect(row.body_text).toBeNull();
  });

  it('fills in the bodies and the attachment names of the reader, and drops the body blob', async () => {
    const { message, attachments } = await openDetail(sealed.detail, sealed.attachments, mine.key);
    expect(message).toMatchObject({ subject: 'Quarterly numbers', body_text: 'Plain body', body_html: CONTENT.html, mail_state: 'ready' });
    expect('body_blob' in message).toBe(false);
    expect(attachments.map((a) => [a.filename, a.mime_type, a.content_id])).toEqual([
      ['logo.png', 'image/png', '<logo@x>'],
      ['Báo cáo.pdf', 'application/pdf', null]
    ]);
  });

  it('opens the attachment bytes and the raw message', async () => {
    const { message, attachments } = await openDetail(sealed.detail, sealed.attachments, mine.key);
    expect(await openAttachmentBytes(message, attachments[1], mine.key, sealed.fetcher)).toEqual(REPORT_BYTES);
    expect(await openRawBytes(message, mine.key, sealed.fetcher)).toEqual(RAW);
  });

  it('opens the content key once per row and reuses it', async () => {
    await openListRow(sealed.list, mine.key);
    await openDetail(sealed.detail, sealed.attachments, mine.key);
    expect(cachedCekCount()).toBe(1);
    // A key that could not unwrap anything still opens the row: the content key comes from the cache.
    const reused: OpenKey = { pair: {} as CryptoKeyPair, keyId: mine.key.keyId };
    expect((await openListRow(sealed.list, reused)).subject).toBe('Quarterly numbers');
  });

  it('shows a legacy plaintext row as it is', async () => {
    const legacy = {
      ...sealed.list,
      enc_fmt: 0,
      subject: 'Old subject',
      snippet: 'Old snippet',
      wrapped_cek: null,
      summary_blob: null
    } as Message;
    expect(await openListRow(legacy, null)).toMatchObject({ subject: 'Old subject', snippet: 'Old snippet', mail_state: 'ready' });
    const plain = { ...legacy, body_text: 'Old body', body_html: '' };
    const old = await openDetail(plain, [{ ...sealed.attachments[1], filename: 'old.pdf' }], null);
    expect(old.message).toMatchObject({ body_text: 'Old body', mail_state: 'ready' });
    expect(old.attachments[0].filename).toBe('old.pdf');
    expect(await openRawBytes(plain, null, () => Promise.resolve(new Response(RAW)))).toEqual(RAW);
  });
});

describe('a message that cannot be opened is a state, not an exception', () => {
  it('is other_key when it was sealed to another key', async () => {
    const theirs = await fixture(other.publicKey);
    expect(sealState(theirs.list, mine.key)).toBe('other_key');
    const row = await openListRow(theirs.list, mine.key);
    expect(row).toMatchObject({ mail_state: 'other_key', subject: '', snippet: null });
    const detail = await openDetail(theirs.detail, theirs.attachments, mine.key);
    expect(detail.message).toMatchObject({ mail_state: 'other_key', body_text: null, body_html: null });
    expect(detail.attachments).toEqual([]);
  });

  it('is pending when the server has not sealed it to a key yet', async () => {
    const pending = { ...sealed.list, wrap_kind: 'server', key_id: null } as Message;
    expect((await openListRow(pending, mine.key)).mail_state).toBe('pending');
  });

  it('is locked while no key is unlocked', async () => {
    expect((await openListRow(sealed.list, null)).mail_state).toBe('locked');
    expect((await openDetail(sealed.detail, sealed.attachments, null)).message.mail_state).toBe('locked');
    await expect(openRawBytes(sealed.list, null, sealed.fetcher)).rejects.toBeInstanceOf(MailOpenError);
  });

  it('is failed when a blob was changed, and for an unknown format', async () => {
    const row = await openListRow({ ...sealed.list, summary_blob: tamper(sealed.list.summary_blob ?? '') }, mine.key);
    expect(row).toMatchObject({ mail_state: 'failed', subject: '' });
    const body = await openDetail({ ...sealed.detail, body_blob: tamper(sealed.detail.body_blob) }, sealed.attachments, mine.key);
    expect(body.message.mail_state).toBe('failed');
    expect((await openListRow({ ...sealed.list, enc_fmt: 2 }, mine.key)).mail_state).toBe('failed');
    expect((await openListRow({ ...sealed.list, wrapped_cek: tamper(sealed.list.wrapped_cek ?? '') }, mine.key)).mail_state).toBe('failed');
  });

  it('is failed when a blob is moved to another row', async () => {
    const moved = { ...sealed.list, id: '55555555-5555-4555-8555-555555555555' };
    expect((await openListRow(moved, mine.key)).mail_state).toBe('failed');
  });

  it('keeps the message and marks one attachment whose name cannot be opened', async () => {
    const broken = sealed.attachments.map((a, index) => (index === 0 ? { ...a, meta_blob: tamper(a.meta_blob ?? '') } : a));
    const { message, attachments } = await openDetail(sealed.detail, broken, mine.key);
    expect(message.mail_state).toBe('ready');
    expect(attachments[0]).toMatchObject({ filename: '', meta_failed: true });
    expect(attachments[1].filename).toBe('Báo cáo.pdf');
  });

  it('refuses a damaged download with a fixed error, and tells a signed-out session apart', async () => {
    const { message, attachments } = await openDetail(sealed.detail, sealed.attachments, mine.key);
    await expect(openAttachmentBytes(message, attachments[1], mine.key, garbled)).rejects.toThrow();
    await expect(openRawBytes(message, mine.key, gone)).rejects.toBeInstanceOf(MailOpenError);
    await expect(openRawBytes(message, mine.key, signedOut)).rejects.toBeInstanceOf(UnauthorizedError);
  });
});

describe('the keys being wiped', () => {
  it('clears the content keys held for the session', async () => {
    await openListRow(sealed.list, mine.key);
    expect(cachedCekCount()).toBe(1);
    const epoch = keyEpoch();
    await wipeKeys();
    expect(cachedCekCount()).toBe(0);
    expect(keyEpoch()).toBeGreaterThan(epoch);
  });

  it('drops what was being opened while the wipe happened', async () => {
    const pending = openListRow(sealed.list, mine.key);
    clearCeks();
    expect(await pending).toMatchObject({ mail_state: 'locked', subject: '' });
    expect(cachedCekCount()).toBe(0);
  });
});

describe('searching the subjects the browser has opened', () => {
  const PLAIN = {
    from_address: 'a@example.com',
    to_address: 'me@example.com',
    folder: 'inbox',
    is_read: 1,
    is_starred: 0,
    has_attachments: 0,
    size: 1,
    updated_at: 1
  };
  const row = (id: string, subject: string, snippet: string | null, created: number, state: Message['mail_state'] = 'ready'): Message =>
    ({ ...PLAIN, id, subject, snippet, created_at: created, mail_state: state }) as Message;
  const loaded = [
    row('a', 'Quarterly numbers', 'totals', 3),
    row('b', 'Lunch', 'Invoice attached for the QUARTER', 2),
    row('c', 'Holiday', 'nothing', 1),
    row('d', '', null, 4, 'locked')
  ];

  it('matches the subject or the snippet without regard to case', () => {
    expect(loaded.filter((m) => matchesQuery(m, 'quarter')).map((m) => m.id)).toEqual(['a', 'b']);
    expect(matchesQuery(loaded[0], 'QUARTERLY')).toBe(true);
    expect(matchesQuery(loaded[2], 'quarter')).toBe(false);
  });

  it('never matches an empty search or a message that could not be opened', () => {
    expect(matchesQuery(loaded[0], '  ')).toBe(false);
    expect(matchesQuery(loaded[3], '')).toBe(false);
    expect(matchesQuery({ ...loaded[3], subject: 'quarter' }, 'quarter')).toBe(false);
  });

  it('adds the loaded matches to what the server found, once each and in the folder order', () => {
    const found = [row('c', 'Holiday', 'nothing', 1), row('e', 'Other', 'x', 5)];
    expect(withLoadedMatches(found, loaded, 'quarter', 'inbox').map((m) => m.id)).toEqual(['e', 'a', 'b', 'c']);
    expect(withLoadedMatches(found, loaded, 'holiday', 'inbox').map((m) => m.id)).toEqual(['c', 'e']);
  });
});

describe('pictures inside a message', () => {
  it('names one part in every spelling', () => {
    expect(['cid:Logo%40x', '<logo@x>', 'logo@x', ' CID:<LOGO@X> '].map((value) => normalizeCid(value))).toEqual(
      Array.from({ length: 4 }, () => 'logo@x')
    );
  });

  it('turns a picture into a data: URL', async () => {
    const result = await pictures(['cid:logo@x']);
    expect(result.failed).toBe(0);
    expect(result.urls.get('logo@x')).toBe(`data:image/png;base64,${btoa(String.fromCodePoint(...LOGO_BYTES))}`);
  });

  it('skips a part that is too big or not a picture, and says so', async () => {
    expect((await pictures(['cid:logo@x'], { size: 6 * 1024 * 1024 })).failed).toBe(1);
    expect((await pictures(['cid:logo@x'], { mime_type: 'image/svg+xml' })).urls.size).toBe(0);
    expect((await pictures(['cid:logo@x'], { mime_type: 'text/html' })).failed).toBe(1);
  });

  it('ignores a reference to nothing', async () => {
    expect(await pictures(['cid:nowhere'])).toEqual({ urls: new Map(), failed: 0 });
  });
});

describe('file names chosen by a sender', () => {
  it.each([
    ['report.pdf', 'report.pdf'],
    ['../../etc/passwd', '_.._etc_passwd'],
    [String.raw`a\b:c*d?.txt`, 'a_b_c_d_.txt'],
    ['.hidden', 'hidden'],
    ['photo\u202Egpj.exe', 'photogpj.exe'],
    ['  tab\tname  ', 'tabname'],
    ['', 'fallback'],
    ['...', 'fallback']
  ])('turns %j into %j', (name, expected) => {
    expect(safeFileName(name, 'fallback')).toBe(expected);
  });

  it('keeps a long name short and its extension', () => {
    const name = safeFileName(`${'x'.repeat(300)}.pdf`, 'fallback');
    expect(name.length).toBe(120);
    expect(name.endsWith('.pdf')).toBe(true);
  });
});
