import { env } from 'cloudflare:workers';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { eq } from 'drizzle-orm';
import { vi } from 'vitest';
import { toBase64Url } from '../src/worker/base64url';
import { getDb } from '../src/worker/db';
import { addresses, domains, messages, settings, users } from '../src/worker/db/schema';
import type { Folder, Role, UserStatus } from '../src/worker/db/schema';
import worker from '../src/worker/index';
import {
  deriveRecoveryAuth,
  generateRecoveryKey,
  generateUserKeyPair,
  openField,
  recoveryWrapKey,
  unwrapCek,
  wrapPrivateKey
} from '../src/shared/crypto/client';
import {
  createSecretVerifier,
  createVerifier,
  decodeCanonical,
  loadDataKeys,
  newCek,
  parsePublicKey,
  sealCek,
  sealData,
  sealField,
  toBase64Url as bytesToBase64Url
} from '../src/shared/crypto/server';
import { hotp, newTotpSecret, stepOf } from '../src/worker/auth/totp';
import type { Env } from '../src/worker/types';

// Shared by every test file: the Worker with its real bindings, a way to call it with a changed environment (secrets missing, a mocked
// binding), the `auth` credential the browser would send, and fixtures that put users and mail straight into D1.

export const ORIGIN = 'https://mail.example.test';

/** The Worker's bindings, optionally changed for one call (for example `{ JWT_SECRET: undefined }`). */
export const testEnv = (overrides: Partial<Env> = {}): Env => ({
  DB: env.DB,
  BUCKET: env.BUCKET,
  MAIL_HUB: env.MAIL_HUB,
  APP_NAME: env.APP_NAME,
  DEFAULT_FROM: env.DEFAULT_FROM,
  APP_PASSWORD: env.APP_PASSWORD,
  JWT_SECRET: env.JWT_SECRET,
  DATA_KEY: env.DATA_KEY,
  ALLOW_LOCAL_PUSH: env.ALLOW_LOCAL_PUSH,
  ...overrides
});

export const db = (): ReturnType<typeof getDb> => getDb(env.DB);

/** A value a test needs to exist: a clear failure instead of a non-null assertion. */
export function must<T>(value: T | null | undefined, what = 'value'): T {
  if (value === null || value === undefined) {
    throw new Error(`the test expected ${what} to exist`);
  }
  return value;
}

export const userRow = async (id: string): Promise<typeof users.$inferSelect> =>
  must(await db().select().from(users).where(eq(users.id, id)).get(), `user ${id}`);

/** What the browser derives from a password: 32 bytes as base64url. The real derivation lives in the client; the server only checks the shape. */
export async function authFor(email: string, password: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${email.toLowerCase()}|${password}`);
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

export interface CallOptions {
  method?: string;
  body?: unknown;
  cookie?: string;
  headers?: Record<string, string>;
  env?: Partial<Env>;
  ip?: string;
}

export interface Answer<T = Record<string, unknown>> {
  status: number;
  headers: Headers;
  json: T;
  text: string;
  response: Response;
}

/** One request through the real `fetch()` handler (middleware, auth gate, routes), then waits for its background work. */
export async function call<T = Record<string, unknown>>(path: string, options: CallOptions = {}): Promise<Answer<T>> {
  const headers = new Headers(options.headers);
  headers.set('CF-Connecting-IP', options.ip ?? '203.0.113.7');
  if (options.cookie !== undefined) {
    headers.set('Cookie', options.cookie);
  }
  let body: string | undefined;
  if (options.body !== undefined) {
    body = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
    headers.set('Content-Type', 'application/json');
  }
  const ctx = createExecutionContext();
  const response = await worker.fetch(
    new Request(`${ORIGIN}${path}`, { method: options.method ?? (body === undefined ? 'GET' : 'POST'), headers, body }),
    testEnv(options.env),
    ctx
  );
  await waitOnExecutionContext(ctx);
  // Decoded from the bytes so a download (octet-stream, message/rfc822) does not make the runtime warn about reading it as text.
  const text = new TextDecoder().decode(await response.clone().arrayBuffer());
  let json = {} as T;
  try {
    json = JSON.parse(text) as T;
  } catch {
    // not JSON (a download, a plain 404)
  }
  return { status: response.status, headers: response.headers, json, text, response };
}

/** "__Host-edging_session=..." (the tests run over https) from a Set-Cookie header, ready for the Cookie header of the next call. */
export const cookieOf = (answer: Answer): string => {
  const setCookie = answer.headers.get('Set-Cookie') ?? '';
  const pair = /(?:__Host-)?edging_session=[^;]+/.exec(setCookie)?.[0];
  if (pair === undefined) {
    throw new Error('no session cookie in the answer');
  }
  return pair;
};

export const DEFAULT_PASSWORD = 'correct horse battery staple';

export interface TestUser {
  id: string;
  email: string;
  auth: string;
  password: string;
  /** The user's key pair (null when created without keys): the private half opens what the Worker sealed to them. */
  keys: { privateKey: CryptoKey; publicKey: CryptoKey; keyId: string; spki: string } | null;
  /** The TOTP secret (null when two-step verification is off for this user). */
  totpSecret: Uint8Array<ArrayBuffer> | null;
  /** The recovery key (32 bytes) and the `recovery_auth` the browser would send for it (null when created without keys). */
  recoveryKey: Uint8Array<ArrayBuffer> | null;
  recoveryAuth: string | null;
}

/** The test DATA_KEY as the Worker reads it (the same module, so tests seal exactly what production seals). */
export const testDataKeys = async () => {
  const keys = await loadDataKeys(env.DATA_KEY, undefined, [env.JWT_SECRET, env.APP_PASSWORD]);
  if (keys === undefined) {
    throw new Error('the test DATA_KEY is not usable');
  }
  return keys;
};

/** A random wrapped-key blob of the right shape: the server only checks shape, so tests that do not unwrap use it. */
export const fakeWrap = (): string => bytesToBase64Url(Uint8Array.from([1, ...crypto.getRandomValues(new Uint8Array(167))]));

/**
 * A user row (and its primary address) straight in D1: no sign-in is involved. By default the user is READY: a key pair with both wraps,
 * and, for an admin, two-step verification enrolled (the organisation policy row, written once, does not require it of members).
 * `keys: false` / `totp` leave the matching gate open.
 */
export async function createUser(
  email: string,
  options: {
    role?: Role;
    status?: UserStatus;
    mustChange?: boolean;
    display_name?: string;
    password?: string;
    aliases?: string[];
    keys?: boolean;
    totp?: boolean;
  } = {}
): Promise<TestUser> {
  const password = options.password ?? DEFAULT_PASSWORD;
  const auth = await authFor(email, password);
  const id = crypto.randomUUID();
  const now = Date.now();
  const domain = email.slice(email.indexOf('@') + 1);
  await db().insert(domains).values({ id: crypto.randomUUID(), name: domain, created_at: now }).onConflictDoNothing();
  // Members are not required to enrol two-step verification unless a test turns the policy on (the real default, set by Setup, is on).
  await db().insert(settings).values({ key: 'require_2fa', value: '0', updated_at: now }).onConflictDoNothing();
  const withKeys = options.keys !== false;
  const pair = withKeys ? await generateUserKeyPair() : null;
  const wrapKey = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), 'AES-GCM', false, [
    'wrapKey',
    'unwrapKey'
  ]);
  const recoveryKey = pair === null ? null : generateRecoveryKey();
  const recoveryAuth = recoveryKey === null ? null : await deriveRecoveryAuth(recoveryKey);
  const recoveryVerifier = recoveryAuth === null ? null : await createSecretVerifier(recoveryAuth.raw);
  const wrapped = (key: CryptoKey): Promise<Uint8Array<ArrayBuffer>> | undefined =>
    pair === null ? undefined : wrapPrivateKey(key, pair.privateKey, email, pair.publicKey.keyId);
  const totpSecret = (options.totp ?? options.role === 'admin') ? newTotpSecret() : null;
  await db()
    .insert(users)
    .values({
      id,
      email,
      display_name: options.display_name ?? '',
      ...(await createVerifier(auth)),
      role: options.role ?? 'member',
      status: options.status ?? 'active',
      must_change_password: options.mustChange === true ? 1 : 0,
      created_at: now,
      updated_at: now,
      ...(pair === null
        ? {}
        : {
            public_key: bytesToBase64Url(pair.publicKey.spki),
            key_id: pair.publicKey.keyId,
            wrapped_private_key_pw: bytesToBase64Url((await wrapped(wrapKey)) ?? new Uint8Array(0)),
            // A real recovery wrap: it opens under the recovery key, so a forgot-password test can unwrap it
            wrapped_private_key_recovery: bytesToBase64Url(
              (await wrapped(await recoveryWrapKey(recoveryKey ?? new Uint8Array(32)))) ?? new Uint8Array(0)
            ),
            recovery_verifier: recoveryVerifier?.verifier ?? null,
            recovery_salt: recoveryVerifier?.salt ?? null,
            recovery_iterations: recoveryVerifier?.iterations ?? null,
            recovery_set_at: now,
            keys_version: 1
          }),
      ...(totpSecret === null
        ? {}
        : {
            totp_enabled: 1,
            totp_enrolled_at: now,
            totp_secret_enc: bytesToBase64Url(await sealData(await testDataKeys(), 'totp', id, totpSecret))
          })
    });
  await db().insert(addresses).values({ address: email, user_id: id, kind: 'primary' });
  for (const alias of options.aliases ?? []) {
    await db().insert(addresses).values({ address: alias, user_id: id, kind: 'alias' });
  }
  return {
    id,
    email,
    auth,
    password,
    keys:
      pair === null
        ? null
        : {
            privateKey: pair.privateKey,
            publicKey: pair.publicKey.key,
            keyId: pair.publicKey.keyId,
            spki: bytesToBase64Url(pair.publicKey.spki)
          },
    totpSecret,
    recoveryKey,
    recoveryAuth: recoveryAuth?.text ?? null
  };
}

/** The current six-digit code of a user's authenticator; `ahead` steps into the future (each code works once, so a second sign-in needs a later step). */
export async function totpCode(user: TestUser, ahead = 0): Promise<string> {
  if (user.totpSecret === null) {
    throw new Error('this user has no two-step verification');
  }
  return hotp(user.totpSecret, stepOf(Date.now()) + ahead);
}

/** Signs in through the real routes (the second step too, when the user has one) and returns the session cookie. */
export async function signIn(user: TestUser, ip?: string): Promise<string> {
  const answer = await call('/api/auth/login', { body: { email: user.email, auth: user.auth, kdf: 1 }, ip });
  if (answer.status !== 200) {
    throw new Error(`sign-in of ${user.email} failed with ${answer.status}`);
  }
  if (answer.json.two_factor_required !== true) {
    return cookieOf(answer);
  }
  // Fixtures share one 30 second step, and a code works once: forget the last accepted step so every sign-in can use the current code.
  await db().update(users).set({ totp_last_step: 0 }).where(eq(users.id, user.id));
  const second = await call('/api/auth/login/2fa', { body: { challenge: answer.json.challenge, code: await totpCode(user) }, ip });
  if (second.status !== 200) {
    throw new Error(`second step of ${user.email} failed with ${second.status}`);
  }
  return cookieOf(second);
}

const json = (value: unknown): Uint8Array<ArrayBuffer> => new TextEncoder().encode(JSON.stringify(value));

/** The body of a draft PUT as the browser sends it: subject and body encrypted to the user's key (a fresh content key per save), recipients plain. */
export async function draftBody(
  user: Pick<TestUser, 'keys'>,
  id: string,
  content: { subject?: string; text?: string; to?: string[] } = {}
): Promise<Record<string, unknown>> {
  if (user.keys === null) {
    throw new Error('the user has no keys');
  }
  const publicKey = await parsePublicKey(decodeCanonical(user.keys.spki) ?? new Uint8Array(0));
  const cek = newCek();
  return {
    to: content.to ?? ['x@example.org'],
    key_id: publicKey.keyId,
    wrapped_cek: bytesToBase64Url(await sealCek(cek, id, publicKey)),
    summary_blob: bytesToBase64Url(await sealField(cek, 'summary', id, json({ subject: content.subject ?? 's', snippet: '' }))),
    body_blob: bytesToBase64Url(await sealField(cek, 'body', id, json({ text: content.text ?? 'x', html: null })))
  };
}

export interface SetupKeys {
  public_key: string;
  key_id: string;
  wrapped_private_key_pw: string;
  wrapped_private_key_recovery: string;
  recovery_auth: string;
}

/**
 * The `keys` of a Setup, key-setup or break-glass request, made as the browser would (a fresh pair, both wraps, `recovery_auth` of a fresh
 * recovery key), with the pair and the recovery key themselves. The password wrap is under a random key (the server only checks its shape).
 */
export async function setupKeysWithPair(
  email: string
): Promise<{ request: SetupKeys; keys: NonNullable<TestUser['keys']>; recoveryKey: Uint8Array<ArrayBuffer> }> {
  const pair = await generateUserKeyPair();
  const wrapKey = await crypto.subtle.importKey('raw', crypto.getRandomValues(new Uint8Array(32)), 'AES-GCM', false, [
    'wrapKey',
    'unwrapKey'
  ]);
  const recoveryKey = generateRecoveryKey();
  const wrapped = async (key: CryptoKey) => bytesToBase64Url(await wrapPrivateKey(key, pair.privateKey, email, pair.publicKey.keyId));
  const spki = bytesToBase64Url(pair.publicKey.spki);
  return {
    request: {
      public_key: spki,
      key_id: pair.publicKey.keyId,
      wrapped_private_key_pw: await wrapped(wrapKey),
      wrapped_private_key_recovery: await wrapped(await recoveryWrapKey(recoveryKey)),
      recovery_auth: (await deriveRecoveryAuth(recoveryKey)).text
    },
    keys: { privateKey: pair.privateKey, publicKey: pair.publicKey.key, keyId: pair.publicKey.keyId, spki },
    recoveryKey
  };
}

export const setupKeys = async (email: string): Promise<SetupKeys> => (await setupKeysWithPair(email)).request;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const fromBase32 = (text: string): Uint8Array<ArrayBuffer> => {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const symbol of text) {
    value = (value << 5) | BASE32.indexOf(symbol);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
};

/** Enrols two-step verification through the real endpoints (what the gate asks for) and returns the new session cookie and the codes. */
export async function enrollTotp(
  cookie: string,
  user: Pick<TestUser, 'auth'>
): Promise<{ cookie: string; secret: Uint8Array<ArrayBuffer>; recoveryCodes: string[] }> {
  const start = await call<{ secret_base32: string }>('/api/auth/2fa/enroll/start', { body: { current_auth: user.auth }, cookie });
  if (start.status !== 200) {
    throw new Error(`enrolment start failed with ${start.status}`);
  }
  const secret = fromBase32(start.json.secret_base32);
  const confirm = await call<{ recovery_codes: string[] }>('/api/auth/2fa/enroll/confirm', {
    body: { current_auth: user.auth, code: await hotp(secret, stepOf(Date.now())) },
    cookie
  });
  if (confirm.status !== 200) {
    throw new Error(`enrolment confirm failed with ${confirm.status}`);
  }
  return { cookie: cookieOf(confirm), secret, recoveryCodes: confirm.json.recovery_codes };
}

const fromB64 = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.codePointAt(0) ?? 0);

type EncryptedRow = Pick<typeof messages.$inferSelect, 'id' | 'wrapped_cek' | 'key_id' | 'summary_blob' | 'body_blob'>;

/** The content key of an EM1 row, opened with the owner's private key (the browser's job in production). */
async function cekOf(row: EncryptedRow, user: Pick<TestUser, 'keys'>): Promise<Uint8Array<ArrayBuffer>> {
  if (user.keys === null || row.wrapped_cek === null || row.key_id === null) {
    throw new Error('the row is not an EM1 row of this user');
  }
  return unwrapCek(fromB64(row.wrapped_cek), row.id, row.key_id, { privateKey: user.keys.privateKey, publicKey: user.keys.publicKey });
}

/** An R2 object or a blob column of an EM1 row, decrypted: `purpose` is `raw`, `att/<id>`, `att-meta/<id>`... */
export async function openObject(
  row: EncryptedRow,
  user: Pick<TestUser, 'keys'>,
  purpose: string,
  blob: Uint8Array
): Promise<Uint8Array<ArrayBuffer>> {
  return openField(await cekOf(row, user), purpose, row.id, blob);
}

/** What an EM1 row holds, opened with the owner's private key. */
export async function openRow(
  row: EncryptedRow,
  user: Pick<TestUser, 'keys'>
): Promise<{ subject: string | null; snippet: string | null; text: string | null; html: string | null }> {
  if (row.summary_blob === null || row.body_blob === null) {
    throw new Error('the row is not an EM1 row of this user');
  }
  const read = async (purpose: string, blob: string) =>
    JSON.parse(new TextDecoder().decode(await openObject(row, user, purpose, fromB64(blob)))) as Record<string, string | null>;
  const summary = await read('summary', row.summary_blob);
  const body = await read('body', row.body_blob);
  return { subject: summary.subject ?? null, snippet: summary.snippet ?? null, text: body.text ?? null, html: body.html ?? null };
}

export async function addMessage(
  userId: string | null,
  fields: Partial<typeof messages.$inferInsert> & { folder?: Folder } = {}
): Promise<string> {
  const id = fields.id ?? crypto.randomUUID();
  const now = Date.now();
  await db()
    .insert(messages)
    .values({
      id,
      user_id: userId,
      from_address: 'sender@example.org',
      to_address: 'someone@example.com',
      subject: 'Subject',
      snippet: 'Snippet',
      body_text: 'Body',
      folder: 'inbox',
      created_at: now,
      updated_at: now,
      ...fields
    });
  return id;
}

export const messageRow = (id: string): Promise<typeof messages.$inferSelect | undefined> =>
  db().select().from(messages).where(eq(messages.id, id)).get();

/** A minimal RFC 5322 message. */
export const rawMail = (options: { from?: string; to: string; subject?: string; body?: string; messageId?: string }): string =>
  [
    `From: ${options.from ?? 'Sender <sender@example.org>'}`,
    `To: ${options.to}`,
    `Subject: ${options.subject ?? 'Hello'}`,
    `Message-ID: ${options.messageId ?? `<${crypto.randomUUID()}@example.org>`}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    options.body ?? 'Body text'
  ].join('\r\n');

export interface Delivery {
  rejected: string | undefined;
}

/** Hands a raw message to the Worker's `email()` handler as Email Routing would (envelope recipient `to`). */
export async function deliverMail(to: string, raw: string, overrides: Partial<Env> = {}): Promise<Delivery> {
  const delivery: Delivery = { rejected: undefined };
  const bytes = new TextEncoder().encode(raw);
  const message = {
    from: 'sender@example.org',
    to,
    headers: new Headers(),
    raw: new Response(bytes).body,
    rawSize: bytes.byteLength,
    setReject: (reason: string) => {
      delivery.rejected = reason;
    }
  } as unknown as ForwardableEmailMessage;
  await worker.email(message, testEnv(overrides));
  return delivery;
}

type Bytes = Uint8Array<ArrayBuffer>;

export interface PushSubscriber {
  privateKey: CryptoKey;
  publicRaw: Bytes;
  authSecret: Bytes;
  /** The `keys` object of a push subscription, as a browser sends it. */
  keys: { p256dh: string; auth: string };
}

/** A fresh browser push subscription: its keys, so a test can read the notifications the Worker sends to it. */
export async function newSubscriber(): Promise<PushSubscriber> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicRaw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const authSecret = crypto.getRandomValues(new Uint8Array(16));
  return { privateKey: pair.privateKey, publicRaw, authSecret, keys: { p256dh: toBase64Url(publicRaw), auth: toBase64Url(authSecret) } };
}

const hkdfBits = async (ikm: Bytes, salt: Bytes, info: Bytes, bits: number): Promise<Bytes> =>
  new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info },
      await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']),
      bits
    )
  );

/** Decrypts one aes128gcm Web Push body (RFC 8291 / RFC 8188) and parses the JSON notification inside. */
export async function decryptPush(body: Bytes, subscriber: PushSubscriber): Promise<Record<string, unknown>> {
  const encoder = new TextEncoder();
  const salt = body.slice(0, 16);
  const asPublic = body.slice(21, 21 + body[20]);
  const record = body.slice(21 + body[20]);
  const ecdh = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: 'ECDH', public: await crypto.subtle.importKey('raw', asPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []) },
      subscriber.privateKey,
      256
    )
  );
  const info = new Uint8Array([...encoder.encode('WebPush: info\0'), ...subscriber.publicRaw, ...asPublic]);
  const ikm = await hkdfBits(ecdh, subscriber.authSecret, info, 256);
  const cek = await hkdfBits(ikm, salt, encoder.encode('Content-Encoding: aes128gcm\0'), 128);
  const nonce = await hkdfBits(ikm, salt, encoder.encode('Content-Encoding: nonce\0'), 96);
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, record));
  return JSON.parse(new TextDecoder().decode(padded.slice(0, padded.lastIndexOf(2)))) as Record<string, unknown>;
}

/** Polls until `condition` holds (a push or a socket message arrives after the response). */
export async function waitUntil(condition: () => boolean, timeoutMs = 3000): Promise<void> {
  const started = Date.now();
  while (!condition()) {
    if (Date.now() - started > timeoutMs) {
      throw new Error('timed out waiting for a condition');
    }
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });
  }
}

/** A fake push service: every notification to an fcm.googleapis.com endpoint is recorded; everything else goes through. Restore with vi.restoreAllMocks(). */
export function fakePushService(): { posted: string[]; bodies: Uint8Array<ArrayBuffer>[] } {
  const posted: string[] = [];
  const bodies: Uint8Array<ArrayBuffer>[] = [];
  const original = globalThis.fetch;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = input instanceof Request ? input.url : input.toString();
    if (url.includes('fcm.googleapis.com')) {
      bodies.push(new Uint8Array(await new Response(init?.body).arrayBuffer()));
      posted.push(url);
      return new Response(null, { status: 201 });
    }
    return original(input, init);
  });
  return { posted, bodies };
}

/** Registers a fresh device for push on the signed-in session and returns its keys, so the test can read what the Worker sends to it. */
export async function subscribeDevice(cookie: string, name: string): Promise<PushSubscriber> {
  const subscriber = await newSubscriber();
  const answer = await call('/api/push/subscribe', {
    cookie,
    body: { endpoint: `https://fcm.googleapis.com/fcm/send/${name}`, keys: subscriber.keys }
  });
  if (answer.status !== 200) {
    throw new Error(`could not subscribe a device (${answer.status})`);
  }
  return subscriber;
}
