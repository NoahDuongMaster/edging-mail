import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { messages, userAvatars, users } from '../src/worker/db/schema';
import type { MessageOrigin } from '../src/worker/db/schema';
import { withFromAvatar } from '../src/worker/mail/view';
import { addMessage, call, createUser, db, deliverMail, enrollTotp, must, rawMail, signIn, totpCode } from './helpers';
import type { TestUser } from './helpers';
import { internalBody } from './internal-helpers';

// Profile pictures: PUT/DELETE /api/avatar, GET /api/avatars/:id, `avatar` on the session user and `from_avatar` on mail (see src/worker/avatars.ts).

const toBase64 = (bytes: Uint8Array): string => btoa(Array.from(bytes, (byte) => String.fromCodePoint(byte)).join(''));
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const ascii = (text: string): number[] => [...new TextEncoder().encode(text)];

/** `length` bytes that start like a JPEG (the Worker checks the first bytes, not the picture). */
const jpeg = (length = 300, seed = 1): Uint8Array<ArrayBuffer> =>
  Uint8Array.from({ length }, (_, index) => [0xff, 0xd8, 0xff, 0xe0][index] ?? (index * 31 + seed) % 256);

/** `length` bytes that start like a WebP: 'RIFF', the size, 'WEBP'. */
const webp = (length = 300, seed = 1): Uint8Array<ArrayBuffer> => {
  const head = [...ascii('RIFF'), (length - 8) & 255, ((length - 8) >> 8) & 255, 0, 0, ...ascii('WEBP')];
  return Uint8Array.from({ length }, (_, index) => head[index] ?? (index * 17 + seed) % 256);
};

const put = (cookie: string | undefined, body: unknown) =>
  call<{ avatar?: string; code?: string }>('/api/avatar', { method: 'PUT', cookie, body });
const upload = async (cookie: string, bytes: Uint8Array, mime = 'image/webp'): Promise<string> => {
  const answer = await put(cookie, { mime, data: toBase64(bytes) });
  expect(answer.status).toBe(200);
  return must(answer.json.avatar);
};
const fetchPicture = (cookie: string | undefined, id: string) => call(`/api/avatars/${id}`, { cookie });
const bytesOf = async (answer: { response: Response }): Promise<number[]> => [...new Uint8Array(await answer.response.arrayBuffer())];
const storedRows = async () => db().select().from(userAvatars);

/** The upload is refused with 400 and the code, and nothing was stored. */
const refused = async (cookie: string, body: unknown, label: string, code = 'invalid_avatar') => {
  const answer = await put(cookie, body);
  expect(answer.status, label).toBe(400);
  expect(answer.json, label).toMatchObject({ success: false, code });
  expect(await storedRows(), label).toEqual([]);
};

const sessionOf = async (cookie: string) =>
  (await call<{ user: { avatar: string | null } }>('/api/auth/session', { cookie })).json.user.avatar;

async function twoPeople() {
  const alice = await createUser('alice@example.com');
  const bob = await createUser('bob@example.com');
  return { alice, bob, aliceCookie: await signIn(alice), bobCookie: await signIn(bob) };
}

describe('uploading, replacing and removing a picture', () => {
  it('stores it, answers its id, and a new upload replaces the old picture under a new id', async () => {
    const { alice, aliceCookie } = await twoPeople();
    const first = await put(aliceCookie, { mime: 'image/webp', data: toBase64(webp()) });
    expect(first.status).toBe(200);
    const firstId = must(first.json.avatar);
    expect(first.json).toEqual({ success: true, avatar: firstId });
    expect(firstId).toMatch(/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/);
    expect(first.headers.get('Cache-Control')).toBe('no-store');
    expect(await storedRows()).toMatchObject([{ id: firstId, user_id: alice.id, mime: 'image/webp', data: toBase64(webp()) }]);

    // the same image again is a new picture with a new id; a JPEG replaces a WebP
    const again = await upload(aliceCookie, webp());
    expect(again).not.toBe(firstId);
    const replaced = await upload(aliceCookie, jpeg(), 'image/jpeg');
    expect(new Set([firstId, again, replaced]).size).toBe(3);
    expect(await storedRows()).toHaveLength(1);
    expect((await fetchPicture(aliceCookie, firstId)).status).toBe(404);
    expect((await fetchPicture(aliceCookie, again)).status).toBe(404);
    const current = await fetchPicture(aliceCookie, replaced);
    expect(current.headers.get('Content-Type')).toBe('image/jpeg');
    expect(await bytesOf(current)).toEqual([...jpeg()]);
  });

  it('removes it, and removing again (or with none) is not an error', async () => {
    const { aliceCookie, bobCookie } = await twoPeople();
    const id = await upload(aliceCookie, webp());
    const removed = await call('/api/avatar', { method: 'DELETE', cookie: aliceCookie });
    expect(removed.status).toBe(200);
    expect(removed.json).toEqual({ success: true, avatar: null });
    expect(removed.headers.get('Cache-Control')).toBe('no-store');
    expect(await storedRows()).toEqual([]);
    expect((await fetchPicture(aliceCookie, id)).status).toBe(404);
    expect((await call('/api/avatar', { method: 'DELETE', cookie: aliceCookie })).json).toEqual({ success: true, avatar: null });
    expect((await call('/api/avatar', { method: 'DELETE', cookie: bobCookie })).json).toEqual({ success: true, avatar: null });
  });

  it('touches only the caller: another person keeps their picture', async () => {
    const { alice, bob, aliceCookie, bobCookie } = await twoPeople();
    const aliceId = await upload(aliceCookie, webp(300, 1));
    const bobId = await upload(bobCookie, jpeg(400, 2), 'image/jpeg');
    expect(new Map((await storedRows()).map((row) => [row.user_id, row.id]))).toEqual(
      new Map([
        [alice.id, aliceId],
        [bob.id, bobId]
      ])
    );
    await call('/api/avatar', { method: 'DELETE', cookie: aliceCookie });
    expect((await storedRows()).map((row) => row.id)).toEqual([bobId]);
    await upload(aliceCookie, webp(300, 3));
    expect((await storedRows()).map((row) => row.id)).toContain(bobId);
  });
});

describe('serving a picture', () => {
  it('answers the bytes as they were uploaded, with the headers that keep it an image and nothing else', async () => {
    const { aliceCookie } = await twoPeople();
    for (const [mime, bytes] of [
      ['image/webp', webp(1234, 5)],
      ['image/jpeg', jpeg(4321, 6)]
    ] as const) {
      const id = await upload(aliceCookie, bytes, mime);
      const answer = await fetchPicture(aliceCookie, id);
      expect(answer.status).toBe(200);
      expect(await bytesOf(answer)).toEqual([...bytes]);
      expect(answer.headers.get('Content-Type')).toBe(mime);
      expect(answer.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');
      expect(answer.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(answer.headers.get('Content-Security-Policy')).toBe("default-src 'none'; sandbox");
      expect(answer.headers.get('Cross-Origin-Resource-Policy')).toBe('same-origin');
      expect(answer.headers.get('Content-Disposition')).toBe('inline');
    }
  });

  it('is open to every signed-in person who knows the id, and to nobody who is signed out', async () => {
    const { aliceCookie, bobCookie } = await twoPeople();
    const id = await upload(aliceCookie, webp());
    expect(await bytesOf(await fetchPicture(bobCookie, id))).toEqual([...webp()]);
    const anonymous = await fetchPicture(undefined, id);
    expect(anonymous.status).toBe(401);
    expect(anonymous.json).toEqual({ success: false, error: 'Unauthorized', code: 'unauthorized' });
    expect((await call('/api/avatar', { method: 'PUT', body: { mime: 'image/webp', data: toBase64(webp()) } })).status).toBe(401);
    expect((await call('/api/avatar', { method: 'DELETE' })).status).toBe(401);
  });

  it('answers a malformed id and an unknown one alike (404, the same body)', async () => {
    const { aliceCookie } = await twoPeople();
    const id = await upload(aliceCookie, webp());
    const answers = await Promise.all(
      [crypto.randomUUID(), 'nope', '123', id.toUpperCase(), `${id}x`, id.replaceAll('-', ''), '%20', ' '].map(async (bad) => ({
        bad,
        answer: await fetchPicture(aliceCookie, encodeURIComponent(bad))
      }))
    );
    for (const { bad, answer } of answers) {
      expect(answer.status, bad).toBe(404);
      expect(answer.json, bad).toEqual({ success: false, error: 'Not found', code: 'not_found' });
    }
    // the upper-case spelling of a real id is not that id
    expect((await fetchPicture(aliceCookie, id.toUpperCase())).status).toBe(404);
    expect((await fetchPicture(aliceCookie, id)).status).toBe(200);
  });
});

describe('what an upload must be', () => {
  const good = toBase64(webp());
  it('refuses another type, also an SVG, and a type that is not a string', async () => {
    const { aliceCookie } = await twoPeople();
    for (const mime of [
      'image/png',
      'image/gif',
      'image/svg+xml',
      'image/avif',
      'IMAGE/WEBP',
      'image/webp ',
      'text/plain',
      '',
      null,
      1,
      ['image/webp']
    ]) {
      await refused(aliceCookie, { mime, data: good }, `mime ${JSON.stringify(mime)}`);
    }
    await refused(aliceCookie, { data: good }, 'no mime');
  });

  it('refuses text that is not canonical standard base64', async () => {
    const { aliceCookie } = await twoPeople();
    const padded = toBase64(webp(301));
    // the character before the padding carries four bits that no byte uses: bump the lowest one, the bytes stay the same, the spelling is another
    const at = padded.length - 3;
    const sloppy = `${padded.slice(0, at)}${ALPHABET[ALPHABET.indexOf(padded.charAt(at)) + 1]}==`;
    expect(atob(sloppy)).toBe(atob(padded));
    const urlSafe = toBase64(Uint8Array.from([...webp(), 0xfb, 0xff, 0xfe]))
      .replaceAll('+', '-')
      .replaceAll('/', '_');
    for (const [label, data] of [
      ['not base64', '!!!!'],
      ['url-safe alphabet', urlSafe],
      ['no padding', padded.replace(/=+$/, '')],
      ['white space', `${good.slice(0, 8)}\n${good.slice(8)}`],
      ['a space', ` ${good}`],
      ['a data URL', `data:image/webp;base64,${good}`],
      ['padding in the middle', `${good.slice(0, 4)}====${good.slice(4)}`],
      ['too much padding', `${good}====`],
      ['stray bits', sloppy],
      ['a number', 12],
      ['null', null],
      ['an array', [good]],
      ['an object', { data: good }]
    ] as const) {
      await refused(aliceCookie, { mime: 'image/webp', data }, label);
    }
    await refused(aliceCookie, { mime: 'image/webp' }, 'no data');
  });

  it('refuses what is not an image, and bytes that are not the type they are declared as', async () => {
    const { aliceCookie } = await twoPeople();
    const text = toBase64(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'));
    const png = toBase64(Uint8Array.from([0x89, ...ascii('PNG'), 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]));
    const wave = Uint8Array.from([...ascii('RIFF'), 4, 0, 0, 0, ...ascii('WAVE'), 1, 2]);
    const riffOnly = Uint8Array.from([...ascii('RIFF'), 4, 0, 0, 0, ...ascii('WEB')]);
    for (const [label, mime, data] of [
      ['an SVG as WebP', 'image/webp', text],
      ['an SVG as JPEG', 'image/jpeg', text],
      ['a PNG as WebP', 'image/webp', png],
      ['a WebP as JPEG', 'image/jpeg', toBase64(webp())],
      ['a JPEG as WebP', 'image/webp', toBase64(jpeg())],
      ['a WAVE file as WebP', 'image/webp', toBase64(wave)],
      ['RIFF without WEBP', 'image/webp', toBase64(riffOnly)],
      ['a JPEG that stops after two bytes', 'image/jpeg', toBase64(Uint8Array.from([0xff, 0xd8]))],
      ['a WebP that stops after RIFF', 'image/webp', toBase64(Uint8Array.from(ascii('RIFF')))],
      ['one byte', 'image/jpeg', toBase64(Uint8Array.from([0xff]))]
    ] as const) {
      await refused(aliceCookie, { mime, data }, label);
    }
  });

  it('refuses an empty picture', async () => {
    const { aliceCookie } = await twoPeople();
    await refused(aliceCookie, { mime: 'image/webp', data: '' }, 'empty data');
    await refused(aliceCookie, { mime: 'image/jpeg', data: '' }, 'empty data');
  });

  it('takes 12000 bytes and refuses 12001 with 400 (not 413), and refuses a body over the 16 KiB cap with 413', async () => {
    const { aliceCookie } = await twoPeople();
    for (const [mime, make] of [
      ['image/webp', webp],
      ['image/jpeg', jpeg]
    ] as const) {
      const big = make(12_000);
      const id = await upload(aliceCookie, big, mime);
      expect(await bytesOf(await fetchPicture(aliceCookie, id))).toEqual([...big]);
      const over = await put(aliceCookie, { mime, data: toBase64(make(12_001)) });
      expect(over.status, mime).toBe(400);
      expect(over.json, mime).toMatchObject({ code: 'invalid_avatar' });
      // the refused upload left the accepted one alone
      expect((await fetchPicture(aliceCookie, id)).status).toBe(200);
    }
    const huge = await put(aliceCookie, { mime: 'image/webp', data: toBase64(webp(20_000)) });
    expect(huge.status).toBe(413);
    expect(huge.json).toMatchObject({ code: 'payload_too_large' });
    expect(await storedRows()).toHaveLength(1);
  });

  it('refuses a body that is not a JSON object with only `mime` and `data`', async () => {
    const { aliceCookie } = await twoPeople();
    await refused(aliceCookie, { mime: 'image/webp', data: good, extra: 1 }, 'unknown field', 'invalid_body');
    await refused(aliceCookie, { mime: 'image/webp', data: good, user_id: 'someone-else' }, 'user_id', 'invalid_body');
    await refused(aliceCookie, [{ mime: 'image/webp', data: good }], 'array', 'invalid_body');
    await refused(aliceCookie, 'null', 'null', 'invalid_body');
    await refused(aliceCookie, '"image/webp"', 'string', 'invalid_body');
    await refused(aliceCookie, '{"mime":', 'not JSON', 'invalid_body');
    const none = await call('/api/avatar', { method: 'PUT', cookie: aliceCookie });
    expect(none.status).toBe(400);
    expect(none.json).toMatchObject({ code: 'invalid_body' });
  });

  it('keeps the old picture when an upload is refused', async () => {
    const { aliceCookie } = await twoPeople();
    const id = await upload(aliceCookie, webp());
    expect((await put(aliceCookie, { mime: 'image/png', data: good })).status).toBe(400);
    expect((await storedRows()).map((row) => row.id)).toEqual([id]);
  });
});

describe('the session user', () => {
  it('carries `avatar`: null without a picture, its id with one, and follows a replace and a removal', async () => {
    const { alice, aliceCookie, bobCookie } = await twoPeople();
    expect(await sessionOf(aliceCookie)).toBeNull();
    const first = await upload(aliceCookie, webp());
    expect(await sessionOf(aliceCookie)).toBe(first);
    expect(await sessionOf(bobCookie)).toBeNull();
    const second = await upload(aliceCookie, jpeg(), 'image/jpeg');
    expect(await sessionOf(aliceCookie)).toBe(second);
    await call('/api/avatar', { method: 'DELETE', cookie: aliceCookie });
    expect(await sessionOf(aliceCookie)).toBeNull();
    // a picture that is there when the person signs in comes with the sign-in answer too
    const third = await upload(aliceCookie, webp());
    const login = await call<{ user: { avatar: string | null } }>('/api/auth/login', {
      body: { email: alice.email, auth: alice.auth, kdf: 1 }
    });
    expect(login.json.user.avatar).toBe(third);
  });

  it('is in the other answers that return the user too (here: turning two-step verification off)', async () => {
    const member = await createUser('member@example.com', { totp: false });
    const { cookie, secret } = await enrollTotp(await signIn(member), member);
    const id = await upload(cookie, webp());
    const off = await call<{ user: { avatar: string | null } }>('/api/auth/2fa/disable', {
      cookie,
      body: { current_auth: member.auth, code: await totpCode({ ...member, totpSecret: secret }, 1) }
    });
    expect(off.status).toBe(200);
    expect(off.json.user.avatar).toBe(id);
  });

  it('holds the id and none of the image', async () => {
    const { aliceCookie } = await twoPeople();
    const id = await upload(aliceCookie, webp());
    const answer = await call('/api/auth/session', { cookie: aliceCookie });
    expect(answer.text).toContain(id);
    expect(answer.text).not.toContain(toBase64(webp()).slice(0, 40));
  });
});

describe('deleting the person', () => {
  it('removes the picture with them', async () => {
    const { alice, aliceCookie, bobCookie } = await twoPeople();
    const id = await upload(aliceCookie, webp());
    await upload(bobCookie, jpeg(), 'image/jpeg');
    await db().delete(users).where(eq(users.id, alice.id));
    expect((await storedRows()).map((row) => row.user_id)).not.toContain(alice.id);
    expect(await storedRows()).toHaveLength(1);
    expect((await fetchPicture(bobCookie, id)).status).toBe(404);
  });

  it('removes it when an administrator deletes the account', async () => {
    const admin = await createUser('boss@example.com', { role: 'admin' });
    const adminCookie = await signIn(admin);
    const member = await createUser('member@example.com');
    const id = await upload(await signIn(member), webp());
    const removed = await call(`/api/admin/users/${member.id}`, { method: 'DELETE', cookie: adminCookie, body: { confirm: member.email } });
    expect(removed.status).toBe(200);
    expect(await storedRows()).toEqual([]);
    expect((await fetchPicture(adminCookie, id)).status).toBe(404);
  });
});

interface Row {
  id: string;
  from_address: string;
  origin: string;
  from_avatar: string | null;
}

const listOf = async (cookie: string, query = ''): Promise<Row[]> => {
  const answer = await call<{ messages: Row[] }>(`/api/messages?folder=inbox${query}`, { cookie });
  expect(answer.status).toBe(200);
  return answer.json.messages;
};
const detailOf = async (cookie: string, id: string): Promise<Row> =>
  (await call<{ message: Row }>(`/api/messages/${id}`, { cookie })).json.message;
const avatarOfRow = async (cookie: string, id: string): Promise<[string | null, string | null]> => [
  must((await listOf(cookie)).find((row) => row.id === id)).from_avatar,
  (await detailOf(cookie, id)).from_avatar
];

async function mailbox() {
  const { alice, bob, aliceCookie, bobCookie } = await twoPeople();
  const carol = await createUser('carol@example.com');
  const ids = {
    internal: await addMessage(bob.id, { from_address: 'alice@example.com', origin: 'internal' }),
    spoof: await addMessage(bob.id, { from_address: 'alice@example.com', origin: 'smtp' }),
    noPicture: await addMessage(bob.id, { from_address: 'carol@example.com', origin: 'internal' }),
    shouting: await addMessage(bob.id, { from_address: ' Alice@Example.COM ', origin: 'internal' }),
    outsider: await addMessage(bob.id, { from_address: 'alice@example.org', origin: 'internal' })
  };
  return { alice, bob, carol, aliceCookie, bobCookie, ids };
}

describe('`from_avatar` on mail', () => {
  it("is the sender's picture for mail written in the app, null for the same address on mail that arrived by email, and null when the sender has none", async () => {
    const { aliceCookie, bobCookie, ids } = await mailbox();
    // nobody has a picture yet
    for (const id of Object.values(ids)) {
      expect(await avatarOfRow(bobCookie, id)).toEqual([null, null]);
    }
    const picture = await upload(aliceCookie, webp());
    expect(await avatarOfRow(bobCookie, ids.internal)).toEqual([picture, picture]);
    expect(await avatarOfRow(bobCookie, ids.shouting)).toEqual([picture, picture]);
    // the spoof case: an email whose From is a person of this deployment gets no picture
    expect(await avatarOfRow(bobCookie, ids.spoof)).toEqual([null, null]);
    expect(await avatarOfRow(bobCookie, ids.noPicture)).toEqual([null, null]);
    // another domain is another address
    expect(await avatarOfRow(bobCookie, ids.outsider)).toEqual([null, null]);
    const row = must((await listOf(bobCookie)).find((entry) => entry.id === ids.internal));
    expect(row).toMatchObject({ origin: 'internal', from_avatar: picture });
  });

  it('follows a replaced and a removed picture at once, and a sender who gets one later', async () => {
    const { carol, aliceCookie, bobCookie, ids } = await mailbox();
    const first = await upload(aliceCookie, webp());
    expect(await avatarOfRow(bobCookie, ids.internal)).toEqual([first, first]);
    const second = await upload(aliceCookie, jpeg(), 'image/jpeg');
    expect(await avatarOfRow(bobCookie, ids.internal)).toEqual([second, second]);
    await call('/api/avatar', { method: 'DELETE', cookie: aliceCookie });
    expect(await avatarOfRow(bobCookie, ids.internal)).toEqual([null, null]);
    const carolsPicture = await upload(await signIn(carol), jpeg(200, 9), 'image/jpeg');
    expect(await avatarOfRow(bobCookie, ids.noPicture)).toEqual([carolsPicture, carolsPicture]);
  });

  it('is set on mail that really went through the app, and null on mail that arrived by email from the same person', async () => {
    const { alice, bob, aliceCookie, bobCookie } = await twoPeople();
    const picture = await upload(aliceCookie, webp());
    const sent = await call('/api/messages/internal', {
      cookie: aliceCookie,
      body: await internalBody(alice, { to: [bob] }, { subject: 'in the app', text: 'hello' })
    });
    expect(sent.status).toBe(200);
    // Cloudflare vouches for the From domain (without that, a mail that claims a hosted domain goes to Spam)
    await deliverMail(
      'bob@example.com',
      `Authentication-Results: mx.cloudflare.net; dkim=pass; dmarc=pass; spf=pass\r\n${rawMail({ from: 'alice@example.com', to: 'bob@example.com', subject: 'by email' })}`
    );
    const rows = await listOf(bobCookie);
    expect(rows.map((row) => `${row.origin}:${row.from_avatar ?? 'none'}`).toSorted((a, b) => a.localeCompare(b))).toEqual([
      `internal:${picture}`,
      'smtp:none'
    ]);
    // the sender's own copy in Sent came the app's way too
    const mine = (await call<{ messages: Row[] }>('/api/messages?folder=sent', { cookie: aliceCookie })).json.messages;
    expect(mine.map((row) => [row.origin, row.from_avatar])).toEqual([['internal', picture]]);
  });

  it('is computed for a page of 100 rows with one picture lookup, and a page of one sender', async () => {
    const bob = await createUser('bob@example.com');
    const bobCookie = await signIn(bob);
    // The senders only need an address: no keys, so they are cheap to make.
    const senders: TestUser[] = await Promise.all(
      Array.from({ length: 100 }, (_, index) => createUser(`sender${String(index).padStart(3, '0')}@example.com`, { keys: false }))
    );
    const pictures = new Map<string, string>();
    for (const [index, sender] of senders.entries()) {
      if (index % 2 === 0) {
        const id = crypto.randomUUID();
        await db()
          .insert(userAvatars)
          .values({ id, user_id: sender.id, mime: 'image/webp', data: toBase64(webp()), created_at: Date.now() });
        pictures.set(sender.email, id);
      }
    }
    const at = Date.now();
    await Promise.all(
      senders.map((sender, index) => addMessage(bob.id, { from_address: sender.email, origin: 'internal', created_at: at + index }))
    );
    const page = await listOf(bobCookie, '&limit=100');
    expect(page).toHaveLength(100);
    expect(new Set(page.map((row) => row.from_address)).size).toBe(100);
    for (const row of page) {
      expect(row.from_avatar, row.from_address).toBe(pictures.get(row.from_address) ?? null);
    }
    expect(page.filter((row) => row.from_avatar !== null)).toHaveLength(50);

    // one sender over a whole page
    await db().delete(messages).where(eq(messages.user_id, bob.id));
    const only = must(senders[0]);
    await Promise.all(Array.from({ length: 100 }, () => addMessage(bob.id, { from_address: only.email, origin: 'internal' })));
    const same = await listOf(bobCookie, '&limit=100');
    expect(same).toHaveLength(100);
    expect(new Set(same.map((row) => row.from_avatar))).toEqual(new Set([pictures.get(only.email)]));
  });
});

const noBackground = (): void => undefined;

describe('withFromAvatar', () => {
  it('works through more senders than one D1 statement can bind, and answers [] for no rows', async () => {
    expect(await withFromAvatar(db(), [], noBackground)).toEqual([]);
    const early = await createUser('early@example.com', { keys: false });
    const late = await createUser('late@example.com', { keys: false });
    const ids = new Map<string, string>();
    for (const person of [early, late]) {
      const id = crypto.randomUUID();
      await db()
        .insert(userAvatars)
        .values({ id, user_id: person.id, mime: 'image/jpeg', data: toBase64(jpeg()), created_at: Date.now() });
      ids.set(person.email, id);
    }
    const rows: { from_address: string; origin: MessageOrigin; from_hosted: boolean; auth: string | null }[] = Array.from(
      { length: 250 },
      (_, index) => ({
        from_address: index === 3 ? 'early@example.com' : index === 240 ? 'late@example.com' : `nobody${index}@example.com`,
        origin: 'internal',
        from_hosted: true,
        auth: null
      })
    );
    // a mail that arrived by email from a person with a picture, after all of them
    rows.push({ from_address: 'early@example.com', origin: 'smtp', from_hosted: true, auth: null });
    const shown = await withFromAvatar(db(), rows, noBackground);
    expect(shown).toHaveLength(251);
    expect(must(shown[3]).from_avatar).toBe(ids.get('early@example.com'));
    expect(must(shown[240]).from_avatar).toBe(ids.get('late@example.com'));
    expect(must(shown[250]).from_avatar).toBeNull();
    expect(shown.filter((row) => row.from_avatar !== null)).toHaveLength(2);
  });
});
