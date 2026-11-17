import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../src/worker/db';
import { auditLog, senderPictures, settings, userAvatars } from '../src/worker/db/schema';
import { pruneActivity } from '../src/worker/maintenance';
import { addressHash, lookableAddress } from '../src/worker/picture-lookup';
import { recordLookup, refreshPictures } from '../src/worker/pictures';
import { addMessage, call, createUser, db, deliverMail, must, rawMail, signIn, testEnv } from './helpers';
import type { TestUser } from './helpers';

// Pictures of outside senders (src/worker/pictures.ts): looked up by the Worker on Gravatar and then Libravatar while an admin has the organisation
// setting `outside_pictures` on, kept in `sender_pictures`, shown through `from_avatar` and served by `GET /api/avatars/:id`. No test touches the
// network: `fetch` is stubbed, and `call()` waits for the background work of a request, so a picture is visible on the NEXT call.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const SENDER = 'sender@example.org';
const noop = (): void => {
  // Nothing: a stand-in for a console method.
};

const hex = async (text: string): Promise<string> =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))), (byte) =>
    byte.toString(16).padStart(2, '0')
  ).join('');
const toBase64 = (bytes: Uint8Array): string => btoa(Array.from(bytes, (byte) => String.fromCodePoint(byte)).join(''));
const fromBase64 = (text: string): number[] => Array.from(atob(text), (char) => char.codePointAt(0) ?? 0);

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0];
const WEBP_HEAD = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50];
const imageBytes = (head: number[], length: number, seed: number): Uint8Array<ArrayBuffer> =>
  Uint8Array.from({ length }, (_, index) => head[index] ?? (index * 31 + seed) % 256);
const png = (length = 400, seed = 1) => imageBytes(PNG_HEAD, length, seed);
const jpeg = (length = 400, seed = 1) => imageBytes(JPEG_HEAD, length, seed);
const webp = (length = 400, seed = 1) => imageBytes(WEBP_HEAD, length, seed);

const gravatarUrl = (hash: string): string => `https://gravatar.com/avatar/${hash}?s=128&d=404&r=pg`;
const libravatarUrl = (hash: string): string => `https://seccdn.libravatar.org/avatar/${hash}?s=128&d=404`;

// ---- the stubbed network ----

interface Asked {
  url: string;
  host: string;
  hash: string;
  init: RequestInit | undefined;
}
let asked: Asked[] = [];

type Answer = Response | Promise<Response>;
type Handler = (url: URL) => Answer;

/** Replaces `fetch` and starts a new log of what was asked (`asked`). */
function stubFetch(handler: Handler): void {
  asked = [];
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    asked.push({ url: href, host: url.hostname, hash: url.pathname.split('/').at(-1) ?? '', init });
    // awaited here, so a rejected answer is handled in the same turn it was made
    const answer = await handler(url);
    return answer;
  });
}

const image = (bytes: Uint8Array<ArrayBuffer>, type = 'image/png', extraHeaders: Record<string, string> = {}): Response =>
  new Response(bytes, { status: 200, headers: { 'Content-Type': type, ...extraHeaders } });
const notFound = (): Response => new Response('Not found', { status: 404, headers: { 'Content-Type': 'text/html' } });
const redirect = (location: string, status = 302): Response => new Response(null, { status, headers: { Location: location } });

/** One answer per provider (a provider with none says 404). Any other host is an error, and shows up in `asked` too. */
const providers =
  (answers: { gravatar?: Handler; libravatar?: Handler }): Handler =>
  (url) => {
    if (url.hostname === 'gravatar.com') {
      return (answers.gravatar ?? notFound)(url);
    }
    if (url.hostname === 'seccdn.libravatar.org') {
      return (answers.libravatar ?? notFound)(url);
    }
    throw new Error('a host outside the providers was asked');
  };

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---- the mailbox ----

interface Row {
  id: string;
  from_address: string;
  origin: string;
  from_hosted: boolean;
  from_avatar: string | null;
}

async function world() {
  const bob = await createUser('bob@example.com');
  return { bob, cookie: await signIn(bob) };
}
const turnOn = async (value = '1'): Promise<void> => {
  await db()
    .insert(settings)
    .values({ key: 'outside_pictures', value, updated_at: Date.now() })
    .onConflictDoUpdate({ target: settings.key, set: { value } });
};
// What Cloudflare records for mail whose From domain vouches for it: only such mail gets an outside picture (see `withFromAvatar`).
const PASS = 'spf=pass;dkim=pass;dmarc=pass';
const mailFrom = (person: Pick<TestUser, 'id'>, address: string, fields: Parameters<typeof addMessage>[1] = {}) =>
  addMessage(person.id, { from_address: address, origin: 'smtp', auth: PASS, ...fields });
const listOf = async (cookie: string): Promise<Row[]> => {
  const answer = await call<{ messages: Row[] }>('/api/messages?folder=inbox&limit=100', { cookie });
  expect(answer.status).toBe(200);
  return answer.json.messages;
};
/** `from_avatar` of every mail in the inbox, by message id. */
const avatarsOf = async (cookie: string): Promise<Map<string, string | null>> =>
  new Map((await listOf(cookie)).map((row) => [row.id, row.from_avatar]));
const heldRows = () => db().select().from(senderPictures);
const rowOf = async (address: string) =>
  must(
    await db()
      .select()
      .from(senderPictures)
      .where(eq(senderPictures.address_hash, await hex(address)))
      .get(),
    `the row of ${address}`
  );
const fetchPicture = (cookie: string | undefined, id: string) => call(`/api/avatars/${id}`, { cookie });
const bytesOf = async (answer: { response: Response }): Promise<number[]> => [...new Uint8Array(await answer.response.arrayBuffer())];
const lastSegment = (url: URL): string => url.pathname.split('/').at(-1) ?? '';

/** One mail per case, from a sender of its own; Gravatar answers what the case says, Libravatar 404. Every case ends as 'no picture'. */
async function refuses(cases: [string, () => Answer][]): Promise<void> {
  const { bob, cookie } = await world();
  await turnOn();
  const byHash = new Map<string, () => Answer>();
  for (const [index, [, answer]] of cases.entries()) {
    byHash.set(await hex(`case${index}@example.org`), answer);
    await mailFrom(bob, `case${index}@example.org`);
  }
  stubFetch(providers({ gravatar: (url) => (byHash.get(lastSegment(url)) ?? notFound)() }));
  await listOf(cookie);
  for (const [index, [label]] of cases.entries()) {
    expect(await rowOf(`case${index}@example.org`), label).toMatchObject({ found: 0, mime: null, data: null });
  }
  expect([...(await avatarsOf(cookie)).values()], 'no picture shown').toEqual(cases.map(() => null));
}

/** Fake dates (timers stay real), and a way to read the inbox as it is `ms` after the start; each read signs in again, a cookie lives 14 days. */
async function onClock() {
  vi.useFakeTimers({ toFake: ['Date'] });
  const start = Date.now();
  const { bob, cookie } = await world();
  const readAt = async (ms: number): Promise<Map<string, string | null>> => {
    vi.setSystemTime(start + ms);
    return avatarsOf(await signIn(bob));
  };
  return { bob, cookie, readAt };
}

async function adminSession() {
  const person = await createUser('boss@example.com', { role: 'admin' });
  return { person, cookie: await signIn(person) };
}
const putSettings = (cookie: string | undefined, body: unknown) => call('/api/admin/settings', { method: 'PUT', cookie, body });
const readSettings = (cookie: string) => call<{ settings: Record<string, unknown> }>('/api/admin/settings', { cookie });
const pictureAudit = async () => (await db().select().from(auditLog)).filter((row) => row.action === 'settings.outside_pictures');
const storedSetting = () => db().select().from(settings).where(eq(settings.key, 'outside_pictures'));

const insertRow = (values: Partial<typeof senderPictures.$inferInsert>) =>
  db()
    .insert(senderPictures)
    .values({
      id: crypto.randomUUID(),
      address_hash: crypto.randomUUID(),
      found: 1,
      mime: 'image/png',
      data: 'AAAA',
      checked_at: 1,
      ...values
    });

describe('the setting is off (the default)', () => {
  it('asks nobody and shows nothing, with the setting absent and with it set to 0', async () => {
    const { bob, cookie } = await world();
    stubFetch(providers({ gravatar: () => image(png()) }));
    const id = await mailFrom(bob, SENDER);
    for (const value of [undefined, '0']) {
      if (value !== undefined) {
        await turnOn(value);
      }
      for (let round = 0; round < 2; round += 1) {
        expect((await avatarsOf(cookie)).get(id)).toBeNull();
        expect(must((await call<{ message: Row }>(`/api/messages/${id}`, { cookie })).json.message).from_avatar).toBeNull();
      }
      expect(asked).toEqual([]);
      expect(await heldRows()).toEqual([]);
    }
  });
});

describe('the setting is on', () => {
  it('shows initials the first time (and looks up in the background), the picture from the next read, and serves it from this origin', async () => {
    const { bob, cookie } = await world();
    await turnOn();
    const picture = png(500, 3);
    stubFetch(providers({ gravatar: () => image(picture) }));
    const id = await mailFrom(bob, SENDER);

    expect((await avatarsOf(cookie)).get(id)).toBeNull();
    expect(asked).toHaveLength(1);
    const held = await heldRows();
    expect(held).toHaveLength(1);
    const row = must(held[0]);
    expect(row).toMatchObject({ found: 1, mime: 'image/png', address_hash: await hex(SENDER), data: toBase64(picture) });
    expect(row.id).toMatch(/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/);

    // the next read has it and asks nobody again; the message itself too
    expect((await avatarsOf(cookie)).get(id)).toBe(row.id);
    expect(must((await call<{ message: Row }>(`/api/messages/${id}`, { cookie })).json.message).from_avatar).toBe(row.id);
    expect(asked).toHaveLength(1);

    const served = await fetchPicture(cookie, row.id);
    expect(served.status).toBe(200);
    expect(await bytesOf(served)).toEqual([...picture]);
    expect(served.headers.get('Content-Type')).toBe('image/png');
    expect(served.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');
    expect(served.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(served.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
    expect(served.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
    expect(served.headers.get('Content-Disposition')).toBe('inline');
    // shared by everybody who is signed in here, nobody who is not
    const carol = await createUser('carol@example.com');
    expect(await bytesOf(await fetchPicture(await signIn(carol), row.id))).toEqual([...picture]);
    expect((await fetchPicture(undefined, row.id)).status).toBe(401);
  });

  it('accepts a JPEG, a WebP and a PNG and keeps the type each one has', async () => {
    const { bob, cookie } = await world();
    await turnOn();
    const files: [string, Uint8Array<ArrayBuffer>, string][] = [
      ['a@example.org', jpeg(), 'image/jpeg'],
      ['b@example.org', webp(), 'image/webp'],
      ['c@example.org', png(), 'image/png']
    ];
    const byHash = new Map<string, [Uint8Array<ArrayBuffer>, string]>();
    for (const [address, bytes, type] of files) {
      byHash.set(await hex(address), [bytes, type]);
      await mailFrom(bob, address);
    }
    stubFetch(
      providers({
        gravatar: (url) => {
          const [bytes, type] = must(byHash.get(lastSegment(url)));
          return image(bytes, type);
        }
      })
    );
    await listOf(cookie);
    for (const [address, bytes, type] of files) {
      expect(await rowOf(address), address).toMatchObject({ found: 1, mime: type, data: toBase64(bytes) });
    }
  });

  it('takes a content type with parameters or capitals', async () => {
    const { bob, cookie } = await world();
    await turnOn();
    stubFetch(providers({ gravatar: () => image(jpeg(), 'IMAGE/JPEG; charset=binary') }));
    await mailFrom(bob, SENDER);
    await listOf(cookie);
    expect(await rowOf(SENDER)).toMatchObject({ found: 1, mime: 'image/jpeg' });
  });

  it('sends the SHA-256 of the lower-cased, trimmed address in a plain GET, and nothing else', async () => {
    const { bob, cookie } = await world();
    await turnOn();
    stubFetch(providers({}));
    await mailFrom(bob, ' User+Tag@Example.ORG ');
    await listOf(cookie);
    const hash = await hex('user+tag@example.org');
    expect(asked.map((entry) => entry.url)).toEqual([gravatarUrl(hash), libravatarUrl(hash)]);
    for (const entry of asked) {
      const init = must(entry.init);
      expect([...new Headers(init.headers).entries()]).toEqual([['user-agent', 'edging-mail']]);
      expect(init.redirect).toBe('manual');
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.method ?? 'GET').toBe('GET');
      expect(init.body ?? null).toBeNull();
      expect(init.referrer).toBeUndefined();
      expect(init.credentials).toBeUndefined();
      expect(JSON.stringify([entry.url, [...new Headers(init.headers).entries()]]).toLowerCase()).not.toContain('example.org');
    }
  });

  it('asks Libravatar second, and takes its picture through its own redirect', async () => {
    const { bob, cookie } = await world();
    await turnOn();
    const picture = jpeg(300, 9);
    const hash = await hex(SENDER);
    stubFetch(
      providers({
        // what the real central server does: a redirect to a path on its own host, which then answers the picture (a JPEG it calls `image/jpg`)
        libravatar: (url) =>
          url.pathname.startsWith('/gravatarproxy/') ? image(picture, 'image/jpg') : redirect(`/gravatarproxy/${hash}?s=128&default=404`)
      })
    );
    const id = await mailFrom(bob, SENDER);
    await listOf(cookie);
    expect(asked.map((entry) => entry.url)).toEqual([
      gravatarUrl(hash),
      libravatarUrl(hash),
      `https://seccdn.libravatar.org/gravatarproxy/${hash}?s=128&default=404`
    ]);
    expect(await rowOf(SENDER)).toMatchObject({ found: 1, mime: 'image/jpeg', data: toBase64(picture) });
    expect((await avatarsOf(cookie)).get(id)).toBe((await rowOf(SENDER)).id);
  });

  it('does not ask Libravatar when Gravatar has the picture', async () => {
    const { bob, cookie } = await world();
    await turnOn();
    stubFetch(providers({ gravatar: () => image(png()), libravatar: () => image(jpeg(), 'image/jpeg') }));
    await mailFrom(bob, SENDER);
    await listOf(cookie);
    expect(asked.map((entry) => entry.host)).toEqual(['gravatar.com']);
    expect((await rowOf(SENDER)).mime).toBe('image/png');
  });

  it('follows a redirect to another host of Gravatar, over https, and nowhere else', async () => {
    const { bob, cookie } = await world();
    await turnOn();
    const hash = await hex(SENDER);
    stubFetch((url) =>
      url.hostname === 'gravatar.com'
        ? redirect(`https://secure.gravatar.com/avatar/${hash}`)
        : url.hostname === 'secure.gravatar.com'
          ? image(png())
          : notFound()
    );
    await mailFrom(bob, SENDER);
    await listOf(cookie);
    expect(asked.map((entry) => entry.url)).toEqual([gravatarUrl(hash), `https://secure.gravatar.com/avatar/${hash}`]);
    expect((await rowOf(SENDER)).found).toBe(1);
  });
});

describe('what is refused', () => {
  it('a body over 24000 bytes, however it is announced', async () => {
    await refuses([
      ['24001 bytes', () => image(png(24_001))],
      ['a length that says so', () => image(png(100), 'image/png', { 'Content-Length': '90000' })],
      ['300000 bytes', () => image(png(300_000))]
    ]);
  });

  it('takes exactly 24000 bytes', async () => {
    const { bob, cookie } = await world();
    await turnOn();
    stubFetch(providers({ gravatar: () => image(png(24_000)) }));
    await mailFrom(bob, SENDER);
    await listOf(cookie);
    expect((await rowOf(SENDER)).found).toBe(1);
    const row = await rowOf(SENDER);
    expect(await bytesOf(await fetchPicture(cookie, row.id))).toEqual([...png(24_000)]);
  });

  it('stops reading a body that never ends', async () => {
    const { bob, cookie } = await world();
    await turnOn();
    let pulls = 0;
    let cancelled = false;
    stubFetch(
      providers({
        gravatar: () =>
          new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                pulls += 1;
                controller.enqueue(pulls === 1 ? png(1000) : new Uint8Array(1000));
              },
              cancel() {
                cancelled = true;
              }
            }),
            { status: 200, headers: { 'Content-Type': 'image/png' } }
          )
      })
    );
    await mailFrom(bob, SENDER);
    await listOf(cookie);
    expect(cancelled).toBe(true);
    // the cap is 24 chunks of 1000 bytes; a few more may have been pulled ahead by the stream's own queue
    expect(pulls).toBeLessThan(40);
    expect(await rowOf(SENDER)).toMatchObject({ found: 0, mime: null, data: null });
  });

  it('a type that is not JPEG, WebP or PNG, and bytes that are not the declared type', async () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const wave = Uint8Array.from([...new TextEncoder().encode('RIFF'), 4, 0, 0, 0, ...new TextEncoder().encode('WAVE'), 1, 2, 3]);
    await refuses([
      ['html', () => image(png(), 'text/html')],
      ['svg', () => image(svg, 'image/svg+xml')],
      ['svg declared as png', () => image(svg, 'image/png')],
      ['gif', () => image(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0]), 'image/gif')],
      ['no type', () => new Response(png())],
      ['png bytes declared jpeg', () => image(png(), 'image/jpeg')],
      ['jpeg bytes declared png', () => image(jpeg(), 'image/png')],
      ['wave declared webp', () => image(wave, 'image/webp')],
      ['an empty body', () => image(new Uint8Array(0))]
    ]);
  });

  it('an answer that is not 200 (403, 401, 304, 410, a redirect with no place to go)', async () => {
    await refuses([
      ['403', () => new Response(png(), { status: 403, headers: { 'Content-Type': 'image/png' } })],
      ['401', () => new Response('no', { status: 401 })],
      ['304', () => new Response(null, { status: 304 })],
      ['302 without Location', () => new Response(null, { status: 302 })],
      ['410', () => new Response('gone', { status: 410 })]
    ]);
  });

  it('a redirect to a host outside the providers, over http, with credentials, on another port or by a host-relative trick', async () => {
    const { bob, cookie } = await world();
    await turnOn();
    const targets = [
      'https://evil.example.net/avatar/x',
      // eslint-disable-next-line unicorn/prefer-https -- the case under test: a downgrade to plain http
      'http://gravatar.com/avatar/x',
      'https://gravatar.com.evil.example.net/avatar/x',
      'https://evilgravatar.com/avatar/x',
      'https://user:pw@gravatar.com/avatar/x',
      'https://gravatar.com:8443/avatar/x',
      '//evil.example.net/avatar/x',
      'https://169.254.169.254/latest',
      'https://localhost/avatar/x',
      'https://libravatar.org/avatar/x'
    ];
    const byHash = new Map<string, string>();
    for (const [index, target] of targets.entries()) {
      byHash.set(await hex(`hop${index}@example.org`), target);
      await mailFrom(bob, `hop${index}@example.org`);
    }
    stubFetch(providers({ gravatar: (url) => redirect(must(byHash.get(lastSegment(url)))) }));
    // ten senders: all of them are looked up in this one request
    await listOf(cookie);
    expect(asked.map((entry) => entry.host)).not.toContain('evil.example.net');
    expect(asked.every((entry) => ['gravatar.com', 'seccdn.libravatar.org'].includes(entry.host))).toBe(true);
    expect(asked.every((entry) => entry.url.startsWith('https://') && !entry.url.includes('/x') && !entry.url.includes(':8443'))).toBe(
      true
    );
    // Gravatar once and Libravatar once for each sender
    expect(asked).toHaveLength(targets.length * 2);
    expect((await heldRows()).map((row) => row.found)).toEqual(targets.map(() => 0));
  });

  it('follows at most two redirects', async () => {
    const { bob, cookie } = await world();
    await turnOn();
    const hash = await hex(SENDER);
    stubFetch((url) => {
      if (url.hostname === 'seccdn.libravatar.org') {
        return notFound();
      }
      if (url.pathname === `/avatar/${hash}`) {
        return redirect('https://secure.gravatar.com/1');
      }
      return redirect(`https://secure.gravatar.com/${Number(url.pathname.slice(1)) + 1}`);
    });
    await mailFrom(bob, SENDER);
    await listOf(cookie);
    expect(asked.map((entry) => entry.url)).toEqual([
      gravatarUrl(hash),
      'https://secure.gravatar.com/1',
      'https://secure.gravatar.com/2',
      libravatarUrl(hash)
    ]);
    expect((await rowOf(SENDER)).found).toBe(0);
  });
});

describe('when a sender is asked about again', () => {
  it('no picture at either provider: a marker, and nobody is asked again for 7 days', async () => {
    const { bob, cookie, readAt } = await onClock();
    await turnOn();
    stubFetch(providers({}));
    const id = await mailFrom(bob, SENDER);
    expect((await avatarsOf(cookie)).get(id)).toBeNull();
    expect(asked).toHaveLength(2);
    expect(await rowOf(SENDER)).toMatchObject({ found: 0, mime: null, data: null });
    for (const offset of [MINUTE, DAY, 7 * DAY - HOUR, 7 * DAY - 1]) {
      await readAt(offset);
      expect(asked, `after ${offset} ms`).toHaveLength(2);
    }
    // after 7 days it asks again, and a picture that has appeared meanwhile is found
    stubFetch(providers({ gravatar: () => image(png(300, 4)) }));
    expect((await readAt(7 * DAY)).get(id)).toBeNull();
    expect(asked).toHaveLength(1);
    expect((await rowOf(SENDER)).found).toBe(1);
    expect((await readAt(7 * DAY + MINUTE)).get(id)).toBe((await rowOf(SENDER)).id);
  });

  it('a lookup that failed for a reason that may pass is retried after an hour and not before', async () => {
    const { bob, cookie, readAt } = await onClock();
    await turnOn();
    const failures: [string, () => Answer][] = [
      ['a network error', () => Promise.reject(new TypeError('network'))],
      ['a timeout', () => Promise.reject(new DOMException('timed out', 'TimeoutError'))],
      ['a 503', () => new Response('down', { status: 503 })],
      ['a 429', () => new Response('slow down', { status: 429 })],
      [
        'a body that breaks off',
        () =>
          new Response(
            new ReadableStream({
              pull(controller) {
                controller.error(new Error('reset'));
              }
            }),
            { status: 200, headers: { 'Content-Type': 'image/png' } }
          )
      ]
    ];
    const answerOf = new Map<string, () => Answer>();
    for (const [index, [, answer]] of failures.entries()) {
      answerOf.set(await hex(`fail${index}@example.org`), answer);
      await mailFrom(bob, `fail${index}@example.org`);
    }
    stubFetch(providers({ gravatar: (url) => must(answerOf.get(lastSegment(url)))() }));
    await listOf(cookie);
    const first = asked.length;
    // Gravatar failed, so Libravatar was asked too
    expect(first).toBe(failures.length * 2);
    expect((await heldRows()).map((row) => row.found)).toEqual(failures.map(() => 0));

    await readAt(59 * MINUTE);
    expect(asked, 'not before an hour').toHaveLength(first);
    await readAt(61 * MINUTE);
    expect(asked, 'after an hour').toHaveLength(first * 2);
    // the second failure is again retried after an hour, not at once
    await readAt(61 * MINUTE + MINUTE);
    expect(asked).toHaveLength(first * 2);
    await readAt(2 * HOUR + 2 * MINUTE);
    expect(asked).toHaveLength(first * 3);
  });

  it('a picture held for 30 days is shown while it is looked up again, keeps its id when the bytes stay and gets a new one when they change', async () => {
    const { bob, cookie, readAt } = await onClock();
    await turnOn();
    stubFetch(providers({ gravatar: () => image(png(400, 1)) }));
    const id = await mailFrom(bob, SENDER);
    await listOf(cookie);
    const first = (await rowOf(SENDER)).id;
    expect((await avatarsOf(cookie)).get(id)).toBe(first);

    expect((await readAt(30 * DAY - MINUTE)).get(id)).toBe(first);
    expect(asked, 'not yet due').toHaveLength(1);

    // due: still shown, looked up again, same bytes, same id
    expect((await readAt(31 * DAY)).get(id)).toBe(first);
    expect(asked).toHaveLength(2);
    expect((await rowOf(SENDER)).id).toBe(first);
    expect((await rowOf(SENDER)).checked_at).toBe(Date.now());
    await readAt(31 * DAY + MINUTE);
    expect(asked, 'once').toHaveLength(2);

    // another picture: a new id, the old one is gone
    const other = webp(500, 7);
    stubFetch(providers({ gravatar: () => image(other, 'image/webp') }));
    expect((await readAt(62 * DAY)).get(id)).toBe(first);
    const changed = (await rowOf(SENDER)).id;
    expect(changed).not.toBe(first);
    expect(await rowOf(SENDER)).toMatchObject({ mime: 'image/webp', data: toBase64(other) });
    expect((await fetchPicture(await signIn(bob), first)).status).toBe(404);
    expect((await readAt(62 * DAY + MINUTE)).get(id)).toBe(changed);

    // the picture is gone at the provider: the old id stops answering, and no picture is shown
    stubFetch(providers({}));
    expect((await readAt(93 * DAY)).get(id)).toBe(changed);
    expect(await rowOf(SENDER)).toMatchObject({ found: 0, mime: null, data: null });
    expect((await fetchPicture(await signIn(bob), changed)).status).toBe(404);
    expect((await readAt(93 * DAY + MINUTE)).get(id)).toBeNull();
  });

  it('a failed refresh keeps the picture that is held and tries again after an hour', async () => {
    const { bob, cookie, readAt } = await onClock();
    await turnOn();
    stubFetch(providers({ gravatar: () => image(png(400, 2)) }));
    const id = await mailFrom(bob, SENDER);
    await listOf(cookie);
    const held = await rowOf(SENDER);

    stubFetch(() => new Response('down', { status: 503 }));
    expect((await readAt(31 * DAY)).get(id)).toBe(held.id);
    const failedAsk = asked.length;
    expect(failedAsk).toBeGreaterThan(0);
    expect(await rowOf(SENDER)).toMatchObject({ id: held.id, found: 1, data: held.data });
    expect((await readAt(31 * DAY + 59 * MINUTE)).get(id)).toBe(held.id);
    expect(asked).toHaveLength(failedAsk);
    stubFetch(providers({ gravatar: () => image(png(400, 2)) }));
    expect((await readAt(31 * DAY + 61 * MINUTE)).get(id)).toBe(held.id);
    expect(asked).toHaveLength(1);
    expect((await rowOf(SENDER)).id).toBe(held.id);
    expect((await readAt(31 * DAY + 62 * MINUTE)).get(id)).toBe(held.id);
    expect(asked).toHaveLength(1);
  });
});

describe('who is never looked up', () => {
  it('an address on a hosted domain: no lookup, no picture, even when the person has one and even when a picture is held for the address', async () => {
    const alice = await createUser('alice@example.com');
    const aliceCookie = await signIn(alice);
    const mine = await call<{ avatar?: string }>('/api/avatar', {
      method: 'PUT',
      cookie: aliceCookie,
      body: { mime: 'image/webp', data: toBase64(webp()) }
    });
    expect(mine.status).toBe(200);
    const reader = await createUser('reader@example.com');
    const readerCookie = await signIn(reader);
    await turnOn();
    // a picture held for the hash of her address, as if it had been looked up before this domain was added here
    await db()
      .insert(senderPictures)
      .values({
        id: crypto.randomUUID(),
        address_hash: await hex('alice@example.com'),
        found: 1,
        mime: 'image/png',
        data: toBase64(png()),
        checked_at: Date.now()
      });
    stubFetch(providers({ gravatar: () => image(png()) }));
    const spoof = await mailFrom(reader, 'alice@example.com');
    const shouting = await mailFrom(reader, ' Alice@EXAMPLE.com ');
    const internal = await addMessage(reader.id, { from_address: 'alice@example.com', origin: 'internal' });
    for (let round = 0; round < 2; round += 1) {
      const avatars = await avatarsOf(readerCookie);
      expect(avatars.get(spoof)).toBeNull();
      expect(avatars.get(shouting)).toBeNull();
      // her own picture still shows on mail that was written in the app
      expect(avatars.get(internal)).toBe(must(mine.json.avatar));
    }
    expect(asked).toEqual([]);
  });

  it('mail written in the app from an outside address is not looked up either', async () => {
    const { bob, cookie } = await world();
    await turnOn();
    stubFetch(providers({ gravatar: () => image(png()) }));
    const id = await addMessage(bob.id, { from_address: SENDER, origin: 'internal' });
    for (let round = 0; round < 2; round += 1) {
      expect((await avatarsOf(cookie)).get(id)).toBeNull();
    }
    expect(asked).toEqual([]);
    expect(await heldRows()).toEqual([]);
  });

  it('an address that is not a plain local@domain', async () => {
    const { bob, cookie } = await world();
    await turnOn();
    stubFetch(providers({ gravatar: () => image(png()) }));
    const bad = [
      'Name <a@example.org>',
      'a@example',
      'a b@example.org',
      '"a"@example.org',
      'a@@example.org',
      'a@b@example.org',
      'a@[1.2.3.4]',
      'a@1.2.3.4',
      '',
      ' '.repeat(3),
      'plain',
      '@example.org',
      'a@',
      '.a@example.org',
      'a..b@example.org',
      'ä@example.org',
      'a@exa mple.org',
      'a,b@example.org',
      `${'x'.repeat(65)}@example.org`
    ];
    const ids: string[] = [];
    for (const address of bad) {
      ids.push(await mailFrom(bob, address));
    }
    for (let round = 0; round < 2; round += 1) {
      const avatars = await avatarsOf(cookie);
      expect(ids.map((id) => avatars.get(id))).toEqual(bad.map(() => null));
    }
    expect(asked).toEqual([]);
    expect(await heldRows()).toEqual([]);
    for (const address of bad) {
      expect(lookableAddress(address), JSON.stringify(address)).toBeNull();
    }
  });

  it('works out the address and its hash the way the lookup needs', async () => {
    expect(lookableAddress(' User+Tag@Example.ORG ')).toBe('user+tag@example.org');
    expect(lookableAddress("o'brien@mail.example.co.uk")).toBe("o'brien@mail.example.co.uk");
    // a SHA-256 known answer (computed with sha256sum)
    expect(await addressHash('myemailaddress@example.com')).toBe('84059b07d4be67b806386c0aad8070a23f18836bbaae342275dc0a83414c32ee');
  });
});

describe('how much is asked at once', () => {
  it('asks the same sender once however many mails there are and however the address is written', async () => {
    const { bob, cookie } = await world();
    await turnOn();
    stubFetch(providers({ gravatar: () => image(png()) }));
    await mailFrom(bob, 'Sender@Example.ORG');
    await mailFrom(bob, ' sender@example.org ');
    await mailFrom(bob, SENDER);
    await listOf(cookie);
    expect(asked).toHaveLength(1);
    expect(await heldRows()).toHaveLength(1);
  });

  it('looks up at most 10 senders per request, three at a time', async () => {
    const { bob, cookie } = await world();
    await turnOn();
    let active = 0;
    let most = 0;
    // a slow network, to see how many are in flight at once
    stubFetch(async () => {
      active += 1;
      most = Math.max(most, active);
      await new Promise((resolve) => {
        setTimeout(resolve, 5);
      });
      active -= 1;
      return notFound();
    });
    for (let index = 0; index < 30; index += 1) {
      await mailFrom(bob, `s${index}@example.org`);
    }
    await listOf(cookie);
    expect(new Set(asked.map((entry) => entry.hash)).size).toBe(10);
    expect(most).toBe(3);
    await listOf(cookie);
    expect(new Set(asked.map((entry) => entry.hash)).size).toBe(20);
    await listOf(cookie);
    expect(new Set(asked.map((entry) => entry.hash)).size).toBe(30);
    const total = asked.length;
    await listOf(cookie);
    expect(asked).toHaveLength(total);
    expect(await heldRows()).toHaveLength(30);
  });
});

describe('privacy of what is kept and logged', () => {
  it('stores the hash and never the address, and writes nothing about it to the console', async () => {
    const { bob, cookie } = await world();
    await turnOn();
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((name) => vi.spyOn(console, name).mockImplementation(noop));
    const hashOfSender = await hex('private.person@example.org');
    stubFetch(
      providers({
        gravatar: (url) => (lastSegment(url) === hashOfSender ? image(png()) : new Response('down', { status: 503 })),
        libravatar: () => notFound()
      })
    );
    await mailFrom(bob, 'Private.Person@Example.org');
    await mailFrom(bob, 'other.person@example.org');
    await listOf(cookie);
    await listOf(cookie);
    const rows = await heldRows();
    expect(rows).toHaveLength(2);
    const kept = JSON.stringify(rows);
    for (const needle of ['private.person', 'other.person', 'example.org', 'Private']) {
      expect(kept).not.toContain(needle);
    }
    expect(rows.map((row) => row.address_hash).toSorted()).toEqual([hashOfSender, await hex('other.person@example.org')].toSorted());
    const logged = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    expect(logged).not.toContain('person');
    expect(logged).not.toContain('example.org');
    expect(logged).not.toContain(hashOfSender);
  });

  it('logs a failure to keep a lookup by its class only', async () => {
    const hash = await hex('private.person@example.org');
    const spy = vi.spyOn(console, 'error').mockImplementation(noop);
    stubFetch(providers({ gravatar: () => image(png()) }));
    const broken = {
      insert() {
        throw new Error('boom private.person@example.org');
      }
    } as unknown as Db;
    await refreshPictures(broken, [hash]);
    expect(spy.mock.calls).toEqual([['[edging-mail] Sender picture lookup failed:', 'Error']]);
  });
});

describe('the organisation setting (admin)', () => {
  it('reads false by default, and a round trip turns it on and off with the other settings untouched', async () => {
    const { cookie } = await adminSession();
    expect((await readSettings(cookie)).json.settings).toEqual({ require_2fa: false, default_language: 'en', outside_pictures: false });
    const on = await putSettings(cookie, { outside_pictures: true });
    expect(on.status).toBe(200);
    expect(on.json).toEqual({ success: true, settings: { require_2fa: false, default_language: 'en', outside_pictures: true } });
    expect((await readSettings(cookie)).json.settings).toMatchObject({ outside_pictures: true });
    expect(await storedSetting()).toMatchObject([{ value: '1' }]);
    // another setting alone changes nothing here
    expect((await putSettings(cookie, { default_language: 'vi' })).json).toMatchObject({
      settings: { default_language: 'vi', outside_pictures: true }
    });
    const off = await putSettings(cookie, { outside_pictures: false });
    expect(off.json).toMatchObject({ settings: { outside_pictures: false, default_language: 'vi' } });
    expect(await storedSetting()).toMatchObject([{ value: '0' }]);
  });

  it('refuses anything that is not true or false, and changes nothing', async () => {
    const { cookie } = await adminSession();
    for (const value of ['yes', 'true', '1', 1, 0, null, [], {}, [true]]) {
      const answer = await putSettings(cookie, { outside_pictures: value });
      expect(answer.status, JSON.stringify(value)).toBe(400);
      expect(answer.json, JSON.stringify(value)).toMatchObject({
        success: false,
        code: 'invalid_request',
        error: 'outside_pictures must be true or false'
      });
    }
    expect(await storedSetting()).toEqual([]);
    expect(await pictureAudit()).toEqual([]);
  });

  it('is for admins only', async () => {
    const member = await createUser('member@example.com');
    const cookie = await signIn(member);
    expect((await putSettings(cookie, { outside_pictures: true })).status).toBe(403);
    expect((await readSettings(cookie)).status).toBe(403);
    expect((await putSettings(undefined, { outside_pictures: true })).status).toBe(401);
    expect(await storedSetting()).toEqual([]);
  });

  it('needs no step-up and no confirmation (relaxing 2FA does, at the same moment)', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const start = Date.now();
    const { person, cookie } = await adminSession();
    await db().update(settings).set({ value: '1' }).where(eq(settings.key, 'require_2fa'));
    // the step-up of the sign-in lasts five minutes
    vi.setSystemTime(start + 10 * MINUTE);
    expect((await putSettings(cookie, { require_2fa: false, confirm: person.email })).json).toMatchObject({ code: 'step_up_required' });
    const on = await putSettings(cookie, { outside_pictures: true });
    expect(on.status).toBe(200);
    expect(on.json).toMatchObject({ settings: { outside_pictures: true } });
  });

  it('is audited once, only when the value changes', async () => {
    const { cookie } = await adminSession();
    expect((await putSettings(cookie, { outside_pictures: false })).status).toBe(200);
    expect(await pictureAudit(), 'off to off is no change').toEqual([]);
    expect((await putSettings(cookie, { outside_pictures: true })).status).toBe(200);
    expect((await putSettings(cookie, { outside_pictures: true })).status).toBe(200);
    expect(await pictureAudit()).toMatchObject([
      { actor_email: 'boss@example.com', target: '', detail: JSON.stringify({ from: false, to: true }) }
    ]);
    expect((await putSettings(cookie, { outside_pictures: false })).status).toBe(200);
    expect((await pictureAudit()).map((row) => row.detail)).toEqual([
      JSON.stringify({ from: false, to: true }),
      JSON.stringify({ from: true, to: false })
    ]);
    // a PUT without the field, or with another setting, writes none
    expect((await putSettings(cookie, { default_language: 'zh-CN' })).status).toBe(200);
    expect(await pictureAudit()).toHaveLength(2);
    const listed = await call<{ entries: { action: string }[] }>('/api/admin/audit', { cookie });
    expect(listed.json.entries.filter((entry) => entry.action === 'settings.outside_pictures')).toHaveLength(2);
  });

  it('turning it off deletes every picture and marker that was kept, and the ids stop answering', async () => {
    const { cookie } = await adminSession();
    const reader = await createUser('reader@example.com');
    const readerCookie = await signIn(reader);
    expect((await putSettings(cookie, { outside_pictures: true })).status).toBe(200);
    const hashOfFound = await hex('found@example.org');
    stubFetch(providers({ gravatar: (url) => (lastSegment(url) === hashOfFound ? image(png()) : notFound()) }));
    const withPicture = await mailFrom(reader, 'found@example.org');
    const without = await mailFrom(reader, 'nobody@example.org');
    await listOf(readerCookie);
    const id = must((await avatarsOf(readerCookie)).get(withPicture));
    expect(await heldRows()).toHaveLength(2);
    expect((await fetchPicture(readerCookie, id)).status).toBe(200);
    const mine = await call<{ avatar?: string }>('/api/avatar', {
      method: 'PUT',
      cookie: readerCookie,
      body: { mime: 'image/webp', data: toBase64(webp()) }
    });

    expect((await putSettings(cookie, { outside_pictures: false })).status).toBe(200);
    expect(await heldRows()).toEqual([]);
    expect((await fetchPicture(readerCookie, id)).status).toBe(404);
    const askedBefore = asked.length;
    expect((await avatarsOf(readerCookie)).get(withPicture)).toBeNull();
    expect((await avatarsOf(readerCookie)).get(without)).toBeNull();
    expect(asked, 'nothing is asked while it is off').toHaveLength(askedBefore);
    // a person's own picture is not touched
    expect(await db().select().from(userAvatars)).toMatchObject([{ id: must(mine.json.avatar) }]);

    // on again: looked up afresh, under a new id
    expect((await putSettings(cookie, { outside_pictures: true })).status).toBe(200);
    await listOf(readerCookie);
    const again = must((await avatarsOf(readerCookie)).get(withPicture));
    expect(again).not.toBe(id);
    expect((await fetchPicture(readerCookie, id)).status).toBe(404);
    expect((await fetchPicture(readerCookie, again)).status).toBe(200);
  });

  it('a PUT that says off clears what is held even when the value did not change, without an audit row', async () => {
    const { cookie } = await adminSession();
    await db()
      .insert(senderPictures)
      .values({ id: crypto.randomUUID(), address_hash: await hex(SENDER), found: 0, mime: null, data: null, checked_at: Date.now() });
    expect((await putSettings(cookie, { outside_pictures: false })).status).toBe(200);
    expect(await heldRows()).toEqual([]);
    expect(await pictureAudit()).toEqual([]);
  });

  it('a lookup that was in flight when it was turned off keeps nothing', async () => {
    const { bob, cookie } = await world();
    await turnOn();
    stubFetch(
      providers({
        gravatar: async () => {
          // an admin turns it off while the answer is on its way
          await db().delete(settings).where(eq(settings.key, 'outside_pictures'));
          return image(png());
        }
      })
    );
    await mailFrom(bob, SENDER);
    await listOf(cookie);
    expect(asked).toHaveLength(1);
    expect(await heldRows()).toEqual([]);
    // the same for every kind of answer, written directly
    for (const [name, answer] of [
      ['late', { kind: 'found', mime: 'image/png', bytes: png() }],
      ['later', { kind: 'none' }],
      ['latest', { kind: 'failed' }]
    ] as const) {
      await recordLookup(db(), await hex(`${name}@example.org`), answer);
    }
    expect(await heldRows()).toEqual([]);
  });
});

describe('GET /api/avatars/:id', () => {
  it("serves a person's own picture, and a held sender picture only when there is a picture", async () => {
    const { bob, cookie } = await world();
    await turnOn();
    const mine = await call<{ avatar?: string }>('/api/avatar', {
      method: 'PUT',
      cookie,
      body: { mime: 'image/jpeg', data: toBase64(jpeg(300, 5)) }
    });
    const own = must(mine.json.avatar);
    const hashOfFound = await hex('found@example.org');
    stubFetch(providers({ gravatar: (url) => (lastSegment(url) === hashOfFound ? image(png(600, 8)) : notFound()) }));
    await mailFrom(bob, 'found@example.org');
    await mailFrom(bob, 'nobody@example.org');
    await listOf(cookie);
    const held = await heldRows();
    const picture = must(held.find((row) => row.found === 1));
    const marker = must(held.find((row) => row.found === 0));
    const ownAnswer = await fetchPicture(cookie, own);
    expect(ownAnswer.headers.get('Content-Type')).toBe('image/jpeg');
    expect(await bytesOf(ownAnswer)).toEqual([...jpeg(300, 5)]);
    const outside = await fetchPicture(cookie, picture.id);
    expect(outside.headers.get('Content-Type')).toBe('image/png');
    expect(fromBase64(must(picture.data))).toEqual([...png(600, 8)]);
    expect(await bytesOf(outside)).toEqual([...png(600, 8)]);
    // a marker is not a picture; neither is an unknown id, a hash, or an address
    for (const id of [marker.id, crypto.randomUUID(), picture.address_hash, 'found@example.org', picture.id.toUpperCase()]) {
      const answer = await fetchPicture(cookie, encodeURIComponent(id));
      expect(answer.status, id).toBe(404);
      expect(answer.json, id).toEqual({ success: false, error: 'Not found', code: 'not_found' });
    }
  });
});

describe('only mail whose From domain passed DMARC', () => {
  const UNAUTHENTICATED: [string, string | null][] = [
    ['no result of ours (auth NULL)', null],
    ['dmarc=none', 'spf=pass;dkim=pass;dmarc=none'],
    ['dmarc=fail', 'spf=pass;dkim=pass;dmarc=fail'],
    ['dmarc=softfail', 'spf=none;dkim=none;dmarc=softfail'],
    ['dmarc=temperror', 'spf=none;dkim=none;dmarc=temperror'],
    ['dmarc=policy', 'spf=none;dkim=none;dmarc=policy'],
    ['spf and dkim pass, dmarc missing', 'spf=pass;dkim=pass;dmarc=none'],
    ['a value that is not the stored form', 'dmarc=pass'],
    ['a pass written another way', 'spf=pass;dkim=pass;dmarc=PASS']
  ];

  it('looks up nobody and shows nothing for any other result, and not for a missing one either', async () => {
    const { bob, cookie } = await world();
    await turnOn();
    stubFetch(providers({ gravatar: () => image(png()) }));
    const ids = await Promise.all(UNAUTHENTICATED.map(([, auth], index) => mailFrom(bob, `sender${index}@example.org`, { auth })));
    for (let round = 0; round < 2; round += 1) {
      expect([...(await avatarsOf(cookie)).values()]).toEqual(ids.map(() => null));
    }
    for (const id of ids) {
      expect(must((await call<{ message: Row }>(`/api/messages/${id}`, { cookie })).json.message).from_avatar).toBeNull();
    }
    expect(asked).toEqual([]);
    expect(await heldRows()).toEqual([]);
  });

  it('a picture already held for the address is shown on the authenticated mail and not on the other, in the same list', async () => {
    const { bob, cookie } = await world();
    await turnOn();
    stubFetch(providers({ gravatar: () => image(png(500, 3)) }));
    const real = await mailFrom(bob, SENDER);
    await avatarsOf(cookie);
    const held = await heldRows();
    expect(held).toHaveLength(1);
    const claimed = await mailFrom(bob, SENDER, { auth: null });
    const failed = await mailFrom(bob, SENDER, { auth: 'spf=fail;dkim=none;dmarc=fail' });
    const shown = await avatarsOf(cookie);
    expect(shown.get(real)).toBe(must(held[0]).id);
    expect(shown.get(claimed)).toBeNull();
    expect(shown.get(failed)).toBeNull();
    expect(must((await call<{ message: Row }>(`/api/messages/${claimed}`, { cookie })).json.message).from_avatar).toBeNull();
    expect(asked).toHaveLength(1);
  });

  it('a sender whose only mail is unauthenticated is never asked about, however many mails there are', async () => {
    const { bob, cookie } = await world();
    await turnOn();
    stubFetch(providers({ gravatar: () => image(png()) }));
    for (let index = 0; index < 5; index += 1) {
      await mailFrom(bob, SENDER, { auth: null });
    }
    await avatarsOf(cookie);
    await avatarsOf(cookie);
    expect(asked).toEqual([]);
    // the first mail that passes starts the lookup
    await mailFrom(bob, SENDER);
    await avatarsOf(cookie);
    expect(asked).toHaveLength(1);
  });

  it('through the real arrival: no Authentication-Results from Cloudflare, no lookup; a pass, a lookup', async () => {
    const { bob, cookie } = await world();
    await turnOn();
    stubFetch(providers({ gravatar: () => image(png(500, 3)) }));
    const mail = (extra: string[]): string => [...extra, rawMail({ from: 'Someone <sender@example.org>', to: bob.email })].join('\r\n');
    await deliverMail(bob.email, mail([]));
    await deliverMail(bob.email, mail(['Authentication-Results: mail.example.org; spf=pass; dkim=pass; dmarc=pass']));
    await deliverMail(bob.email, mail(['Authentication-Results: mx.cloudflare.net; dkim=none; dmarc=fail; spf=fail']));
    // a sender cannot make its own claim ours: the header of another server first, ours (forged) after it
    await deliverMail(
      bob.email,
      mail(['Authentication-Results: mail.example.org; dmarc=pass', 'Authentication-Results: mx.cloudflare.net; dmarc=pass'])
    );
    expect(await avatarsOf(cookie)).toBeTruthy();
    expect(asked).toEqual([]);
    expect(await heldRows()).toEqual([]);
    await deliverMail(bob.email, mail(['Authentication-Results: mx.cloudflare.net; dkim=pass; dmarc=pass; spf=pass']));
    await avatarsOf(cookie);
    expect(asked).toHaveLength(1);
  });

  it('mail from a hosted address and mail written in the app are decided as before, whatever the result says', async () => {
    const { bob, cookie } = await world();
    await turnOn();
    stubFetch(providers({ gravatar: () => image(png()) }));
    const hosted = await mailFrom(bob, 'alice@example.com');
    const internal = await addMessage(bob.id, { from_address: 'alice@example.com', origin: 'internal', auth: null });
    expect([...(await avatarsOf(cookie)).entries()]).toEqual(
      expect.arrayContaining([
        [hosted, null],
        [internal, null]
      ])
    );
    expect(asked).toEqual([]);
  });
});

describe('arrival by email', () => {
  it('a mail delivered by SMTP from an outside address gets its sender picture from the second read on', async () => {
    const { bob, cookie } = await world();
    await turnOn();
    const picture = webp(700, 6);
    stubFetch(providers({ libravatar: () => image(picture, 'image/webp') }));
    const delivered = await deliverMail(
      bob.email,
      `Authentication-Results: mx.cloudflare.net; dkim=pass; dmarc=pass; spf=pass\r\n${rawMail({ from: 'Someone <sender@example.org>', to: bob.email })}`
    );
    expect(delivered.rejected).toBeUndefined();
    const [row] = await listOf(cookie);
    expect(must(row)).toMatchObject({ origin: 'smtp', from_hosted: false, from_avatar: null });
    expect(asked.map((entry) => entry.host)).toEqual(['gravatar.com', 'seccdn.libravatar.org']);
    const next = must((await listOf(cookie))[0]);
    expect(next.from_avatar).toBe((await rowOf(SENDER)).id);
    expect(await bytesOf(await fetchPicture(cookie, must(next.from_avatar)))).toEqual([...picture]);
  });
});

describe('housekeeping', () => {
  it('the hourly prune deletes sender pictures and markers whose last lookup is older than 90 days, and only those', async () => {
    const now = Date.now();
    const rows = [
      ['old-picture', 1, now - 91 * DAY],
      ['old-marker', 0, now - 90 * DAY - 1000],
      ['edge', 1, now - 89 * DAY - 23 * HOUR],
      ['recent', 0, now - 5 * DAY],
      ['fresh', 1, now]
    ] as const;
    for (const [name, found, checkedAt] of rows) {
      await db()
        .insert(senderPictures)
        .values({
          id: crypto.randomUUID(),
          address_hash: await hex(name),
          found,
          mime: found === 1 ? 'image/png' : null,
          data: found === 1 ? toBase64(png()) : null,
          checked_at: checkedAt
        });
    }
    await pruneActivity(testEnv());
    const kept = new Set((await heldRows()).map((row) => row.address_hash));
    expect(kept).toEqual(new Set(await Promise.all(['edge', 'recent', 'fresh'].map((name) => hex(name)))));
  });
});

describe('the table', () => {
  it('refuses a row whose found flag and picture disagree, or a type that is not allowed, and a second row for one hash', async () => {
    await expect(insertRow({ found: 1, mime: null, data: null })).rejects.toThrow();
    await expect(insertRow({ found: 0, mime: 'image/png', data: 'AAAA' })).rejects.toThrow();
    await expect(insertRow({ found: 1, mime: 'image/svg+xml' as never })).rejects.toThrow();
    await expect(insertRow({ found: 1, mime: 'image/gif' as never })).rejects.toThrow();
    await insertRow({ found: 1 });
    await insertRow({ found: 0, mime: null, data: null });
    const hash = crypto.randomUUID();
    await insertRow({ address_hash: hash });
    await expect(insertRow({ address_hash: hash })).rejects.toThrow();
  });
});
