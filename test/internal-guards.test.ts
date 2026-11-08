import { env } from 'cloudflare:workers';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { toBase64Url } from '../src/shared/crypto/server';
import { attachments, messages } from '../src/worker/db/schema';
import { call, createUser, db, must, signIn } from './helpers';
import { internalBody, sealedFor } from './internal-helpers';

// The guards of POST /api/messages/internal (reports/e2e-contract.md section 3): shape, caps, throttle, fail-closed, and what a failure
// may log or answer. Every refusal must leave nothing behind: no row and no R2 object.

const MARKER = 'ACME-SECRET-41-MILLION';
const BIG_BODY = 16 * 1024 * 1024;

interface Reply {
  success: boolean;
  code?: string;
  error?: string;
}

const send = (cookie: string, body: unknown, options: Parameters<typeof call>[1] = {}) =>
  call<Reply>('/api/messages/internal', { cookie, body, ...options });
const stored = async (): Promise<{ rows: number; attachments: number; objects: number }> => ({
  rows: (await db().select().from(messages)).length,
  attachments: (await db().select().from(attachments)).length,
  objects: (await env.BUCKET.list()).objects.length
});
const NOTHING = { rows: 0, attachments: 0, objects: 0 };

/** A blob of the right shape (version byte, then `size` bytes in all) that is not a real sealed value: the server only checks shape. */
const blobOf = (size: number, version = 1): string => {
  const bytes = new Uint8Array(size);
  bytes[0] = version;
  return toBase64Url(bytes);
};

/** The attachments of a copy: `count` sealed-looking blobs of `size` bytes, each with a description. */
const files = (count: number, size: number) =>
  Array.from({ length: count }, () => ({ id: crypto.randomUUID(), blob: blobOf(size), meta_blob: blobOf(40) }));

/** A bucket whose writes fail with `error`. */
const failingBucket = (error: Error): R2Bucket =>
  new Proxy(env.BUCKET, {
    get(target, property) {
      if (property === 'put') {
        return () => Promise.reject(error);
      }
      const value: unknown = Reflect.get(target, property);
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
    }
  });

afterEach(() => {
  vi.restoreAllMocks();
});

async function fixture() {
  const alice = await createUser('alice@example.com');
  const bob = await createUser('bob@example.com');
  const carol = await createUser('carol@example.com');
  const good = await internalBody(alice, { to: [bob] }, { subject: 'Hi', text: 'there' });
  return { alice, bob, carol, good, cookie: await signIn(alice) };
}

describe('the shape of the request', () => {
  it('refuses a body that is not what the contract says, with the registry code, and stores nothing', async () => {
    const { bob, good, cookie } = await fixture();
    const sent = good.sent as Record<string, unknown>;
    const copy = (good.copies as Record<string, unknown>[])[0] ?? {};
    const many = Array.from({ length: 51 }, (_, index) => `u${index}@example.com`);
    const cases: [string, unknown, number, string][] = [
      ['an unknown key', { ...good, extra: 1 }, 400, 'invalid_body'],
      ['an array instead of an object', [], 400, 'invalid_body'],
      ['no recipient', { ...good, to: [] }, 400, 'invalid_request'],
      ['an address that is not one', { ...good, to: ['not an address'] }, 400, 'invalid_request'],
      ['more than 50 addresses in one list', { ...good, to: many }, 400, 'too_many_recipients'],
      ['more than 50 addresses over all lists', { ...good, to: many.slice(0, 30), cc: many.slice(30) }, 400, 'too_many_recipients'],
      ['more than 50 copies', { ...good, copies: Array.from({ length: 51 }, () => copy) }, 400, 'too_many_recipients'],
      ['no sent copy', { ...good, sent: undefined }, 400, 'invalid_request'],
      ['no copies', { ...good, copies: [] }, 400, 'invalid_request'],
      ['a draft id that is not a uuid', { ...good, draft_id: 'x' }, 400, 'invalid_request'],
      ['an in_reply_to without angle brackets', { ...good, in_reply_to: 'abc@example.com' }, 400, 'invalid_request'],
      ['an id in capitals', { ...good, sent: { ...sent, id: crypto.randomUUID().toUpperCase() } }, 400, 'invalid_request'],
      ['one id used twice', { ...good, sent: { ...sent, id: copy.id } }, 400, 'invalid_request'],
      ['a blob that is not base64url', { ...good, sent: { ...sent, body_blob: '***' } }, 400, 'invalid_request'],
      [
        'a blob with padding (not canonical)',
        { ...good, sent: { ...sent, body_blob: `${String(sent.body_blob)}=` } },
        400,
        'invalid_request'
      ],
      ['a blob with another version byte', { ...good, sent: { ...sent, body_blob: blobOf(100, 2) } }, 400, 'invalid_request'],
      ['a blob shorter than a sealed value', { ...good, sent: { ...sent, body_blob: blobOf(20) } }, 400, 'invalid_request'],
      ['a wrapped key that names another key', { ...good, sent: { ...sent, key_id: 'B'.repeat(22) } }, 400, 'invalid_request'],
      ['a key id that is not one', { ...good, sent: { ...sent, key_id: 'short' } }, 400, 'invalid_request'],
      ['a summary over 8 KiB', { ...good, sent: { ...sent, summary_blob: blobOf(8 * 1024 + 1) } }, 413, 'payload_too_large'],
      ['a body over 1 MiB', { ...good, sent: { ...sent, body_blob: blobOf(1024 * 1024 + 1) } }, 413, 'payload_too_large'],
      [
        'an attachment description over 4 KiB',
        { ...good, sent: { ...sent, attachments: [{ id: crypto.randomUUID(), blob: blobOf(100), meta_blob: blobOf(4 * 1024 + 1) }] } },
        413,
        'payload_too_large'
      ],
      [
        'more than 32 attachments in one copy',
        {
          ...good,
          sent: {
            ...sent,
            attachments: Array.from({ length: 33 }, () => ({ id: crypto.randomUUID(), blob: blobOf(40), meta_blob: blobOf(40) }))
          }
        },
        400,
        'invalid_request'
      ],
      [
        'an attachment with an unknown key',
        { ...good, sent: { ...sent, attachments: [{ id: crypto.randomUUID(), blob: blobOf(40), meta_blob: blobOf(40), name: 'x.pdf' }] } },
        400,
        'invalid_body'
      ],
      [
        'a plain copy with a line break in the subject',
        { ...good, copies: [{ address: bob.email, plain: { subject: 'a\r\nBcc: x' } }] },
        400,
        'invalid_request'
      ],
      [
        'a plain copy with an unknown key',
        { ...good, copies: [{ address: bob.email, plain: { subject: 'a', from: 'x@y.z' } }] },
        400,
        'invalid_body'
      ],
      [
        'a plain attachment that is not base64',
        {
          ...good,
          copies: [
            { address: bob.email, plain: { subject: 'a', attachments: [{ filename: 'f', mime_type: 'a/b', content_base64: '!!' }] } }
          ]
        },
        400,
        'invalid_request'
      ],
      // Count and length caps are 400 (the reason is named); only SIZE caps are 413 (see the cases above and the caps test).
      [
        'a plain subject over 998 characters',
        { ...good, copies: [{ address: bob.email, plain: { subject: 'x'.repeat(999) } }] },
        400,
        'invalid_request'
      ],
      [
        'a plain attachment file name over 255 characters',
        {
          ...good,
          copies: [
            {
              address: bob.email,
              plain: { subject: 'a', attachments: [{ filename: 'f'.repeat(256), mime_type: 'a/b', content_base64: '' }] }
            }
          ]
        },
        400,
        'invalid_request'
      ],
      [
        'a plain attachment type over 255 characters',
        {
          ...good,
          copies: [
            {
              address: bob.email,
              plain: { subject: 'a', attachments: [{ filename: 'f', mime_type: 'a'.repeat(256), content_base64: '' }] }
            }
          ]
        },
        400,
        'invalid_request'
      ],
      [
        'more than 32 plain attachments in one copy',
        {
          ...good,
          copies: [
            {
              address: bob.email,
              plain: {
                subject: 'a',
                attachments: Array.from({ length: 33 }, () => ({ filename: 'f', mime_type: 'a/b', content_base64: '' }))
              }
            }
          ]
        },
        400,
        'invalid_request'
      ]
    ];
    for (const [name, body, status, code] of cases) {
      const answer = await send(cookie, body);
      expect([answer.status, answer.json.code], name).toEqual([status, code]);
      expect(answer.json.success, name).toBe(false);
    }
    expect(await stored()).toEqual(NOTHING);
    // the length case says "too long", not "one line"
    const longSubject = await send(cookie, { ...good, copies: [{ address: bob.email, plain: { subject: 'x'.repeat(999) } }] });
    expect(longSubject.json.error).toMatch(/subject is too long \(at most 998 characters\)/i);
    const brokenSubject = await send(cookie, { ...good, copies: [{ address: bob.email, plain: { subject: 'a\nb' } }] });
    expect(brokenSubject.json.error).toMatch(/one line/);
    // the same request, unchanged, goes through: the table above refused it for the one thing each case changed
    expect((await send(cookie, good)).status).toBe(200);
  });

  it('caps the attachments over all copies: their number and their bytes', async () => {
    const { bob, good, cookie } = await fixture();
    const sent = good.sent as Record<string, unknown>;
    // 4 x 32 = 128 objects over all copies, each tiny (the extra copies are well-formed: the cap is what refuses them)
    const copies = await Promise.all(
      ['a', 'b', 'c'].map(async (name) => ({
        address: `${name}@example.com`,
        ...(await sealedFor(must(bob.keys).spki, { subject: 'x' })),
        attachments: files(32, 40)
      }))
    );
    const tooMany = await send(cookie, { ...good, sent: { ...sent, attachments: files(32, 40) }, copies });
    expect([tooMany.status, tooMany.json.code]).toEqual([413, 'payload_too_large']);
    // 11 MiB of sealed attachment bytes in one copy (a request body of about 15 MiB, under the body cap)
    const heavy = await send(cookie, { ...good, sent: { ...sent, attachments: files(11, 1024 * 1024) } });
    expect([heavy.status, heavy.json.code]).toEqual([413, 'payload_too_large']);
    expect(await stored()).toEqual(NOTHING);
  }, 60_000);

  it('refuses a request over 16 MiB while reading it, whatever its content', async () => {
    const { cookie } = await fixture();
    const answer = await send(cookie, 'x'.repeat(BIG_BODY + 1));
    expect([answer.status, answer.json.code]).toEqual([413, 'payload_too_large']);
    expect(await stored()).toEqual(NOTHING);
  });

  it('answers 400 for a body that is not JSON, without echoing it', async () => {
    const { cookie } = await fixture();
    const answer = await send(cookie, `{"to": ["${MARKER}"`);
    expect([answer.status, answer.json.code]).toEqual([400, 'invalid_body']);
    expect(answer.text).not.toContain(MARKER);
  });
});

describe('who may call it, and how often', () => {
  it('needs a session and no open gate: 401 signed out, the gate code while key setup is open', async () => {
    const { good } = await fixture();
    expect((await send('', good)).status).toBe(401);
    const keyless = await createUser('late@example.com', { keys: false });
    const gated = await send(await signIn(keyless), good);
    expect([gated.status, gated.json.code]).toEqual([403, 'key_setup_required']);
    expect(await stored()).toEqual(NOTHING);
  });

  it('allows 60 sends per 15 minutes per person, then 429 with Retry-After; another person is not locked', async () => {
    const { bob, cookie } = await fixture();
    for (let attempt = 1; attempt <= 60; attempt += 1) {
      expect((await send(cookie, {})).status, `attempt ${attempt}`).toBe(400);
    }
    const locked = await send(cookie, {});
    expect([locked.status, locked.json.code]).toEqual([429, 'too_many_requests']);
    expect(Number(locked.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await send(await signIn(bob), {})).status).toBe(400);
  }, 60_000);

  it('fails closed with a 503 and stores nothing when the throttle store cannot be read', async () => {
    const { good, cookie } = await fixture();
    // Only the throttle table is down: the session check still works, so the 503 comes from the route itself.
    const throttleDown = new Proxy(env.DB, {
      get(target, property) {
        if (property === 'prepare') {
          return (query: string) => {
            if (query.includes('login_attempts')) {
              throw new Error('database is down');
            }
            return target.prepare(query);
          };
        }
        const value: unknown = Reflect.get(target, property);
        return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value;
      }
    });
    const answer = await send(cookie, good, { env: { DB: throttleDown } });
    expect([answer.status, answer.json.code]).toEqual([503, 'unavailable']);
    expect(answer.text).not.toMatch(/database|down|SQL/i);
    expect(await stored()).toEqual(NOTHING);
  });
});

describe('what a failure may answer and log', () => {
  it('answers a failed storage write with fixed text, logs only a class, and leaves no row and no object', async () => {
    const { alice, bob, cookie } = await fixture();
    const body = await internalBody(
      alice,
      { to: [bob] },
      { subject: MARKER, text: MARKER, files: [{ name: `${MARKER}.pdf`, bytes: new TextEncoder().encode(MARKER) }] }
    );
    const logs = [vi.spyOn(console, 'error'), vi.spyOn(console, 'log'), vi.spyOn(console, 'warn')];
    const answer = await send(cookie, body, { env: { BUCKET: failingBucket(new Error(`boom ${MARKER} alice@example.com`)) } });
    expect([answer.status, answer.json.code]).toEqual([500, 'server_error']);
    const logged = JSON.stringify(logs.map((spy) => spy.mock.calls));
    const submitted = JSON.stringify(body);
    for (const secret of [
      MARKER,
      'boom',
      'alice@example.com',
      'bob@example.com',
      String((body.sent as Record<string, unknown>).wrapped_cek)
    ]) {
      expect(answer.text, secret).not.toContain(secret);
      expect(logged, secret).not.toContain(secret);
    }
    expect(submitted).toContain('wrapped_cek');
    expect(await stored()).toEqual(NOTHING);
  });

  it('does not echo what was submitted in a refusal, and a key_changed answer carries public keys only', async () => {
    const { alice, bob, good, cookie } = await fixture();
    const echo = await send(cookie, { ...good, to: [`${MARKER}@@bad`], bcc: [MARKER] });
    expect(echo.status).toBe(400);
    expect(echo.text).not.toContain(MARKER);
    const stranger = await send(cookie, { ...good, to: [`${MARKER.toLowerCase()}@elsewhere.example.net`] });
    expect(stranger.json.code).toBe('recipient_not_internal');
    const stale = await send(cookie, { ...good, sent: await sealedFor(must(bob.keys).spki, { subject: 'Hi' }) });
    expect(stale.json.code).toBe('key_changed');
    expect(stale.text).not.toMatch(/wrapped|private|verifier|salt|totp|pkcs8|"d":/);
    expect(JSON.parse(stale.text)).toMatchObject({ own_key: { key_id: alice.keys?.keyId } });
  });
});
