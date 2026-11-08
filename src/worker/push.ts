import { Hono } from 'hono';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, desc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import { currentUser } from './auth/middleware';
import { dataKeysOf } from './auth/secrets';
import { getDb, type Db } from './db';
import { pushKeys, pushSubscriptions, users } from './db/schema';
import { failed, statusError } from './errors';
import { appName, errorClass, isEmail, nonEmpty } from './utils';
import type { AppEnv, Env } from './types';
import { openData, openLegacyVapidKey, sealData } from '../shared/crypto/server';
import type { DataKeys } from '../shared/crypto/server';

export interface PushPayload {
  title: string;
  body: string;
  tag: string;
  url: string;
}

// Web Push without a library: RFC 8291 (aes128gcm payload encryption) + RFC 8292 (VAPID) on top of WebCrypto, which
// is ~80 lines and works unchanged on workerd. The popular Workers libraries only accept https endpoints, which
// would make the local fake-push-service test impossible.

const MAX_SUBSCRIPTIONS = 20;
const MAX_REQUEST_CHARS = 4096;
const MAX_ENDPOINT_CHARS = 2048;
const SEND_TIMEOUT_MS = 8000;
const TTL_SECONDS = 86_400;
// RFC 8292 caps `exp` at 24 h from the request; 12 h leaves room for clock skew.
const VAPID_LIFETIME_SECONDS = 43_200;
// A push service must accept 4096 body bytes (RFC 8030): 86 header bytes (salt, record size, key id) + padding delimiter + GCM tag.
const MAX_PLAINTEXT_BYTES = 4096 - 86 - 1 - 16;
const MAX_TITLE_CHARS = 100;
const MAX_BODY_CHARS = 200;

const encoder = new TextEncoder();

// WebCrypto/fetch only take ArrayBuffer-backed views, which TypeScript 7 tells apart from Uint8Array<ArrayBufferLike>.
type Bytes = Uint8Array<ArrayBuffer>;

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCodePoint(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');

// Throws on invalid input. Accepts base64url and plain base64, with or without padding.
function fromBase64Url(value: string): Bytes {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (char) => char.codePointAt(0) ?? 0);
}

const concat = (...parts: Bytes[]): Bytes => {
  const out = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

async function hkdf(secret: Bytes, salt: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8));
}

const importSubscriberKey = (p256dh: Bytes): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', p256dh, { name: 'ECDH', namedCurve: 'P-256' }, false, []);

/** RFC 8291 section 3: one aes128gcm record (RFC 8188) addressed to the subscriber's p256dh/auth keys. */
async function encryptPayload(keys: { p256dh: string; auth: string }, plaintext: Bytes): Promise<Bytes> {
  if (plaintext.length > MAX_PLAINTEXT_BYTES) {
    throw new Error(`Push payload is ${plaintext.length} bytes, the maximum is ${MAX_PLAINTEXT_BYTES}`);
  }
  const uaPublic = fromBase64Url(keys.p256dh);
  const authSecret = fromBase64Url(keys.auth);
  const ephemeral = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  const ecdhSecret = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: await importSubscriberKey(uaPublic) }, ephemeral.privateKey, 256)
  );

  const ikm = await hkdf(ecdhSecret, authSecret, concat(encoder.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(ikm, salt, encoder.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(ikm, salt, encoder.encode('Content-Encoding: nonce\0'), 12);

  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  // 0x02 marks the last (here: only) record.
  const record = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, concat(plaintext, Uint8Array.of(2))));
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, record);
}

interface Vapid {
  publicKey: string;
  privateKey: string;
  subject: string;
}

// There is nothing to configure: the VAPID key pair is created the first time push is needed and kept in `push_keys`. The private
// half is sealed under DATA_KEY (version, kid, AES-GCM), so a copy of the database alone cannot sign pushes. Changing DATA_KEY to a key
// that cannot open the stored pair (and without DATA_KEY_PREVIOUS) makes it unreadable: it is replaced and the devices made for the old pair
// are dropped (the push services would refuse them anyway), so every device turns notifications on again. A rotation keeps it readable.
// A pair written by the single-user version (sealed under JWT_SECRET) is converted instead: see `unsealLegacy`.

const VAPID_ROW_ID = 1;

const decoder = new TextDecoder();

type KeyPair = Omit<Vapid, 'subject'>;

// The public key is the authenticated context, so a sealed value cannot be moved onto another key pair.
async function seal(pair: KeyPair, keys: DataKeys): Promise<string> {
  return toBase64Url(await sealData(keys, 'vapid', pair.publicKey, encoder.encode(pair.privateKey)));
}

// undefined when the row was sealed under a key we no longer hold, or is damaged.
async function unseal(row: typeof pushKeys.$inferSelect, keys: DataKeys): Promise<KeyPair | undefined> {
  try {
    const plain = await openData(keys, 'vapid', row.public_key, fromBase64Url(row.private_key_sealed));
    return { publicKey: row.public_key, privateKey: decoder.decode(plain) };
  } catch {
    return undefined;
  }
}

// The single-user version sealed the private half under JWT_SECRET (`openLegacyVapidKey`, with the other server decrypts in data-key.ts). A pair like
// that is sealed under DATA_KEY at once, so the devices made for it keep working across the upgrade (the guide says to keep JWT_SECRET); the
// next read finds the current format. undefined for anything else. Remove with `openLegacyVapidKey` in the first release after the upgrade window.
async function unsealLegacy(row: typeof pushKeys.$inferSelect, jwtSecret: string | undefined): Promise<KeyPair | undefined> {
  if (jwtSecret === undefined || jwtSecret === '') {
    return undefined;
  }
  try {
    const plain = await openLegacyVapidKey(jwtSecret, row.public_key, fromBase64Url(row.private_key_sealed));
    return plain === undefined ? undefined : { publicKey: row.public_key, privateKey: decoder.decode(plain) };
  } catch {
    return undefined;
  }
}

// The signing key of a pair: its private scalar with the public point it must belong to. The runtime refuses a pair whose halves do not belong together
// (DataError; test/data-key.test.ts pins that, so a runtime that stopped checking is noticed).
function signingKey(pair: KeyPair): Promise<CryptoKey> {
  const publicBytes = fromBase64Url(pair.publicKey);
  return crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: toBase64Url(publicBytes.slice(1, 33)), y: toBase64Url(publicBytes.slice(33, 65)), d: pair.privateKey },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
}

// A private scalar that does not belong to its public key would sign requests no push service accepts, and the devices would be kept for a pair that
// cannot work: before a pair that came from outside (the old format) is sealed again, it is imported as the signing key it will become.
async function pairIsConsistent(pair: KeyPair): Promise<boolean> {
  try {
    await signingKey(pair);
    return true;
  } catch {
    return false;
  }
}

async function generatePair(): Promise<KeyPair> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const { d } = await crypto.subtle.exportKey('jwk', pair.privateKey);
  if (d === undefined) {
    throw new Error('Could not export the new VAPID key');
  }
  return { publicKey: toBase64Url(new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))), privateKey: d };
}

async function loadKeyPair(db: Db, keys: DataKeys, jwtSecret: string | undefined): Promise<KeyPair> {
  const read = () => db.select().from(pushKeys).where(eq(pushKeys.id, VAPID_ROW_ID)).get();
  const row = await read();
  const existing = row === undefined ? undefined : await unseal(row, keys);
  if (existing !== undefined) {
    return existing;
  }
  const legacy = row === undefined ? undefined : await unsealLegacy(row, jwtSecret);
  if (row !== undefined && legacy !== undefined && (await pairIsConsistent(legacy))) {
    // Sealed under DATA_KEY now, only while the row is still the one that was read; either way this is the pair the devices were made for.
    await db
      .update(pushKeys)
      .set({ private_key_sealed: await seal(legacy, keys) })
      .where(and(eq(pushKeys.id, VAPID_ROW_ID), eq(pushKeys.private_key_sealed, row.private_key_sealed)));
    return legacy;
  }

  const fresh = await generatePair();
  const values = { id: VAPID_ROW_ID, public_key: fresh.publicKey, private_key_sealed: await seal(fresh, keys), created_at: Date.now() };
  // Callers can race, so the first insert wins and everybody reads it back below. An unreadable pair (DATA_KEY changed without DATA_KEY_PREVIOUS) is replaced
  // only while nobody else has (same public key). In the same batch the devices made for an older key are dropped, which also
  // covers a database that held devices before it held a key: the delete runs only while the new pair is the stored one, so the
  // loser of a race deletes nothing and no device made for the winner's key is touched.
  const [, dropped] = await db.batch([
    row === undefined
      ? db.insert(pushKeys).values(values).onConflictDoNothing()
      : db
          .update(pushKeys)
          .set(values)
          .where(and(eq(pushKeys.id, VAPID_ROW_ID), eq(pushKeys.public_key, row.public_key))),
    db
      .delete(pushSubscriptions)
      .where(sql`(select ${pushKeys.public_key} from ${pushKeys} where ${pushKeys.id} = ${VAPID_ROW_ID}) = ${fresh.publicKey}`)
      .returning({ id: pushSubscriptions.id })
  ]);
  const stored = await read();
  const pair = stored === undefined ? undefined : await unseal(stored, keys);
  if (pair === undefined) {
    throw new Error('Could not read the VAPID key pair');
  }
  if (row !== undefined && stored?.public_key === fresh.publicKey) {
    // An operator cannot otherwise tell why notifications went off: one line, no value of any key.
    console.warn(
      `[edging-mail] push: the stored VAPID pair could not be opened; a new pair was made and ${dropped.length} device(s) removed`
    );
  }
  return pair;
}

// The contact the push services may write to (RFC 8292 wants a mailto: or https: URL): the DEFAULT_FROM var when it holds an address
// (the deployment's own contact), otherwise the primary address of the person being notified. Never a value of the upstream project.
async function vapidSubject(env: Env, db: Db, userId: string): Promise<string> {
  const configured = nonEmpty(env.DEFAULT_FROM?.trim());
  if (configured !== undefined && isEmail(configured)) {
    return `mailto:${configured}`;
  }
  const owner = await db.select({ email: users.email }).from(users).where(eq(users.id, userId)).get();
  if (owner === undefined) {
    throw new Error('Push contact: the user does not exist');
  }
  return `mailto:${owner.email}`;
}

/** The key pair (created on first use) and the contact for the push services. undefined only without a usable DATA_KEY. */
async function getVapid(env: Env, userId: string): Promise<Vapid | undefined> {
  const keys = await dataKeysOf(env);
  if (keys === undefined) {
    return undefined;
  }
  const db = getDb(env.DB);
  return { ...(await loadKeyPair(db, keys, env.JWT_SECRET)), subject: await vapidSubject(env, db, userId) };
}

async function requireVapid(env: Env, userId: string): Promise<Vapid> {
  const vapid = await getVapid(env, userId);
  if (vapid === undefined) {
    throw new HTTPException(503, { message: 'Push is not configured' });
  }
  return vapid;
}

/** RFC 8292: `Authorization: vapid t=<ES256 JWT>, k=<public key>`. */
async function vapidAuthorization(vapid: Vapid, audience: string): Promise<string> {
  const key = await signingKey(vapid);
  const header = toBase64Url(encoder.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = toBase64Url(
    encoder.encode(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + VAPID_LIFETIME_SECONDS, sub: vapid.subject }))
  );
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, encoder.encode(`${header}.${claims}`));
  return `vapid t=${header}.${claims}.${toBase64Url(new Uint8Array(signature))}, k=${vapid.publicKey}`;
}

type Subscription = typeof pushSubscriptions.$inferSelect;
type Outcome = 'sent' | 'gone' | 'failed';

async function sendToSubscription(vapid: Vapid, subscription: Subscription, payload: Bytes): Promise<Outcome> {
  // The endpoint is a secret capability URL, so only its origin is logged.
  let origin = 'unknown endpoint';
  try {
    const endpoint = new URL(subscription.endpoint);
    origin = endpoint.origin;
    const response = await fetch(endpoint, {
      method: 'POST',
      // A push service never redirects; following one would hand the encrypted payload and the VAPID JWT to another host.
      redirect: 'manual',
      headers: {
        Authorization: await vapidAuthorization(vapid, endpoint.origin),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(TTL_SECONDS),
        Urgency: 'high'
      },
      body: await encryptPayload(subscription, payload),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS)
    });
    if (response.ok) {
      await response.body?.cancel();
      return 'sent';
    }
    // 404/410: the browser unsubscribed or the subscription expired for good (RFC 8030 section 7.3).
    if (response.status === 404 || response.status === 410) {
      await response.body?.cancel();
      return 'gone';
    }
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      console.error(`[edging-mail] push: ${origin} answered a redirect (HTTP ${response.status}), not followed`);
      return 'failed';
    }
    const detail = await response.text();
    console.error(`[edging-mail] push: ${origin} answered HTTP ${response.status}:`, detail.slice(0, 200));
  } catch (error) {
    console.error(`[edging-mail] push: sending to ${origin} failed: ${errorClass(error)}`);
  }
  return 'failed';
}

interface PushResult {
  sent: number;
  failed: number;
  removed: number;
}

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

async function deliver(env: Env, userId: string, payload: PushPayload): Promise<PushResult> {
  const result: PushResult = { sent: 0, failed: 0, removed: 0 };
  const db = getDb(env.DB);
  const mine = eq(pushSubscriptions.user_id, userId);
  // No device, no key to create: installs that never turn notifications on stay out of push entirely.
  const devices = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(mine).limit(1);
  if (devices.length === 0) {
    return result;
  }
  const vapid = await getVapid(env, userId);
  if (vapid === undefined) {
    return result;
  }
  // Read after the key: a reset key (DATA_KEY changed) has just dropped the devices made for the old one.
  const subscriptions = await db.select().from(pushSubscriptions).where(mine);
  if (subscriptions.length === 0) {
    return result;
  }

  const body = encoder.encode(
    JSON.stringify({ ...payload, title: clip(payload.title, MAX_TITLE_CHARS), body: clip(payload.body, MAX_BODY_CHARS) })
  );
  const outcomes = await Promise.all(subscriptions.map((subscription) => sendToSubscription(vapid, subscription, body)));
  const idsWith = (wanted: Outcome): number[] =>
    subscriptions.filter((_, index) => outcomes[index] === wanted).map((subscription) => subscription.id);
  const sent = idsWith('sent');
  const gone = idsWith('gone');

  if (sent.length > 0) {
    await db.update(pushSubscriptions).set({ last_success_at: Date.now() }).where(inArray(pushSubscriptions.id, sent));
  }
  if (gone.length > 0) {
    await db.delete(pushSubscriptions).where(inArray(pushSubscriptions.id, gone));
  }
  result.sent = sent.length;
  result.removed = gone.length;
  result.failed = subscriptions.length - sent.length - gone.length;
  return result;
}

/** Sends a notification to every device subscribed by ONE user. Never throws: push is best-effort, the mail is already stored. */
export async function notifyPush(env: Env, userId: string, payload: PushPayload): Promise<void> {
  try {
    await deliver(env, userId, payload);
  } catch (error) {
    console.error('[edging-mail] push: notification failed:', errorClass(error));
  }
}

// --- HTTP API (mounted at /api/push) ---

type PushContext = Context<AppEnv>;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

async function readBody(c: PushContext): Promise<Record<string, unknown>> {
  const text = await c.req.text();
  if (text.length > MAX_REQUEST_CHARS) {
    throw new HTTPException(413, { message: 'Request body too large' });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HTTPException(400, { message: 'Request body must be valid JSON' });
  }
  if (!isRecord(body)) {
    throw new HTTPException(400, { message: 'Request body must be a JSON object' });
  }
  return body;
}

function parseEndpoint(value: unknown): string {
  if (typeof value !== 'string' || value === '') {
    throw new HTTPException(400, { message: 'endpoint is required' });
  }
  if (value.length > MAX_ENDPOINT_CHARS) {
    throw new HTTPException(400, { message: 'endpoint is too long' });
  }
  return value;
}

// Only the browsers' real push services: an arbitrary https endpoint would let a stolen session keep receiving every
// notification (sender + subject) on a server of its own. Matched on the parsed, lowercased hostname.
const PUSH_SERVICE_HOST =
  /^(?:fcm\.googleapis\.com|updates\.push\.services\.mozilla\.com|(?:[a-z0-9-]+\.)+(?:push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com))$/;

// https on port 443 to a push service, and nothing else (PX-4). A deployment that says it is local (ALLOW_LOCAL_PUSH is "on": `wrangler dev`, the
// tests) also takes a loopback host over http or https on any port, for a fake push service. The URL parser has made `127.1` and `2130706433` into
// 127.0.0.1 by now, so the loopback test is on the parsed host name.
const isLoopback = (hostname: string): boolean => hostname === 'localhost' || hostname === '127.0.0.1';

function parseSubscriptionEndpoint(env: Env, value: unknown): string {
  const endpoint = parseEndpoint(value);
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new HTTPException(400, { message: 'endpoint must be a valid URL' });
  }
  const local = env.ALLOW_LOCAL_PUSH?.trim().toLowerCase() === 'on' && isLoopback(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new HTTPException(400, { message: 'endpoint must be an https URL' });
  }
  if (url.username !== '' || url.password !== '') {
    throw new HTTPException(400, { message: 'endpoint must not contain credentials' });
  }
  if (!local && (!PUSH_SERVICE_HOST.test(url.hostname) || url.port !== '')) {
    // An empty port is the default one (443): `:443` is dropped by the parser, any other port stays.
    throw new HTTPException(400, { message: 'endpoint is not a known push service' });
  }
  return endpoint;
}

// Returns the canonical (unpadded base64url) form of a key that decodes to the expected length.
function parseKey(value: unknown, name: string, length: number): { bytes: Bytes; text: string } {
  if (typeof value !== 'string' || value === '') {
    throw new HTTPException(400, { message: `keys.${name} is required` });
  }
  let bytes: Bytes;
  try {
    bytes = fromBase64Url(value);
  } catch {
    throw new HTTPException(400, { message: `keys.${name} is not valid base64url` });
  }
  if (bytes.length !== length) {
    throw new HTTPException(400, { message: `keys.${name} must be ${length} bytes, got ${bytes.length}` });
  }
  return { bytes, text: toBase64Url(bytes) };
}

export const pushRoutes = new Hono<AppEnv>();

pushRoutes.onError((error, c) => {
  if (error instanceof HTTPException) {
    return statusError(c, error.status, error.message);
  }
  return failed(c, error);
});

pushRoutes.get('/public-key', async (c) => {
  const { publicKey } = await requireVapid(c.env, currentUser(c).id);
  return c.json({ success: true, publicKey });
});

pushRoutes.post('/subscribe', async (c) => {
  const userId = currentUser(c).id;
  await requireVapid(c.env, userId);
  const body = await readBody(c);
  const endpoint = parseSubscriptionEndpoint(c.env, body.endpoint);
  const keys = isRecord(body.keys) ? body.keys : {};
  const p256dh = parseKey(keys.p256dh, 'p256dh', 65);
  const auth = parseKey(keys.auth, 'auth', 16);
  try {
    await importSubscriberKey(p256dh.bytes);
  } catch {
    throw new HTTPException(400, { message: 'keys.p256dh is not a valid P-256 public key' });
  }

  const db = getDb(c.env.DB);
  const userAgent = c.req.header('User-Agent')?.slice(0, 300) ?? null;
  // The endpoint identifies one browser profile. When somebody else subscribes from that same browser (a user switch on a shared device),
  // the device moves to them: it must stop notifying the previous person. This conflict path is the one place a row of another user
  // is taken over on purpose, and only ever by the holder of the endpoint's own keys.
  await db
    .insert(pushSubscriptions)
    .values({ endpoint, p256dh: p256dh.text, auth: auth.text, user_agent: userAgent, user_id: userId, created_at: Date.now() })
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: { p256dh: p256dh.text, auth: auth.text, user_agent: userAgent, user_id: userId }
    });
  // Keep each user's newest MAX_SUBSCRIPTIONS rows; stale devices are normally pruned on 404/410, this is the backstop.
  const mine = eq(pushSubscriptions.user_id, userId);
  const newest = db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(mine)
    .orderBy(desc(pushSubscriptions.created_at), desc(pushSubscriptions.id))
    .limit(MAX_SUBSCRIPTIONS);
  await db.delete(pushSubscriptions).where(and(mine, notInArray(pushSubscriptions.id, newest)));
  return c.json({ success: true });
});

// Unsubscribe, status and test only ever touch the caller's own devices.
pushRoutes.post('/unsubscribe', async (c) => {
  const { endpoint } = await readBody(c);
  await getDb(c.env.DB)
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, parseEndpoint(endpoint)), eq(pushSubscriptions.user_id, currentUser(c).id)));
  return c.json({ success: true });
});

pushRoutes.post('/status', async (c) => {
  const { endpoint } = await readBody(c);
  const row = await getDb(c.env.DB)
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, parseEndpoint(endpoint)), eq(pushSubscriptions.user_id, currentUser(c).id)))
    .get();
  return c.json({ success: true, subscribed: row !== undefined });
});

pushRoutes.post('/test', async (c) => {
  const userId = currentUser(c).id;
  await requireVapid(c.env, userId);
  const result = await deliver(c.env, userId, { title: appName(c.env), body: 'Notifications are working', tag: 'test', url: '/app' });
  return c.json({ success: true, ...result });
});
