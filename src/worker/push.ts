import { Hono } from 'hono';
import type { Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { desc, eq, inArray, notInArray } from 'drizzle-orm';
import { errorMessage, getDb } from './db';
import { pushSubscriptions } from './db/schema';
import { appName, nonEmpty } from './utils';
import type { Env } from './types';

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

function getVapid(env: Env): Vapid | undefined {
  const publicKey = nonEmpty(env.VAPID_PUBLIC_KEY);
  const privateKey = nonEmpty(env.VAPID_PRIVATE_KEY);
  const subject = nonEmpty(env.VAPID_SUBJECT);
  return publicKey !== undefined && privateKey !== undefined && subject !== undefined ? { publicKey, privateKey, subject } : undefined;
}

function requireVapid(env: Env): Vapid {
  const vapid = getVapid(env);
  if (vapid === undefined) {
    throw new HTTPException(503, { message: 'Push is not configured' });
  }
  return vapid;
}

/** RFC 8292: `Authorization: vapid t=<ES256 JWT>, k=<public key>`. */
async function vapidAuthorization(vapid: Vapid, audience: string): Promise<string> {
  const publicBytes = fromBase64Url(vapid.publicKey);
  const key = await crypto.subtle.importKey(
    'jwk',
    { kty: 'EC', crv: 'P-256', x: toBase64Url(publicBytes.slice(1, 33)), y: toBase64Url(publicBytes.slice(33, 65)), d: vapid.privateKey },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
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
    console.error(`[edging-mail] push: sending to ${origin} failed: ${errorMessage(error)}`);
  }
  return 'failed';
}

interface PushResult {
  sent: number;
  failed: number;
  removed: number;
}

const clip = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

async function deliver(env: Env, payload: PushPayload): Promise<PushResult> {
  const result: PushResult = { sent: 0, failed: 0, removed: 0 };
  const vapid = getVapid(env);
  if (vapid === undefined) {
    return result;
  }
  const db = getDb(env.DB);
  const subscriptions = await db.select().from(pushSubscriptions);
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

/** Sends a notification to every subscribed device. Never throws: push is best-effort, the mail is already stored. */
export async function notifyPush(env: Env, payload: PushPayload): Promise<void> {
  try {
    await deliver(env, payload);
  } catch (error) {
    console.error('[edging-mail] push: notification failed:', error);
  }
}

// --- HTTP API (mounted at /api/push) ---

type PushContext = Context<{ Bindings: Env }>;

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

// https to a push service only; plain http is allowed for loopback so a local fake push service can be used in development.
function parseSubscriptionEndpoint(value: unknown): string {
  const endpoint = parseEndpoint(value);
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new HTTPException(400, { message: 'endpoint must be a valid URL' });
  }
  const isLocalHttp = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1');
  if (url.protocol !== 'https:' && !isLocalHttp) {
    throw new HTTPException(400, { message: 'endpoint must be an https URL' });
  }
  if (url.username !== '' || url.password !== '') {
    throw new HTTPException(400, { message: 'endpoint must not contain credentials' });
  }
  if (!isLocalHttp && !PUSH_SERVICE_HOST.test(url.hostname)) {
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

export const pushRoutes = new Hono<{ Bindings: Env }>();

pushRoutes.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ success: false, error: error.message }, error.status);
  }
  console.error('[edging-mail] push route failed:', error);
  return c.json({ success: false, error: errorMessage(error) }, 500);
});

pushRoutes.get('/public-key', (c) => c.json({ success: true, publicKey: requireVapid(c.env).publicKey }));

pushRoutes.post('/subscribe', async (c) => {
  requireVapid(c.env);
  const body = await readBody(c);
  const endpoint = parseSubscriptionEndpoint(body.endpoint);
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
  await db
    .insert(pushSubscriptions)
    .values({ endpoint, p256dh: p256dh.text, auth: auth.text, user_agent: userAgent, created_at: Date.now() })
    .onConflictDoUpdate({ target: pushSubscriptions.endpoint, set: { p256dh: p256dh.text, auth: auth.text, user_agent: userAgent } });
  // Keep the newest MAX_SUBSCRIPTIONS rows; stale devices are normally pruned on 404/410, this is the backstop.
  const newest = db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .orderBy(desc(pushSubscriptions.created_at), desc(pushSubscriptions.id))
    .limit(MAX_SUBSCRIPTIONS);
  await db.delete(pushSubscriptions).where(notInArray(pushSubscriptions.id, newest));
  return c.json({ success: true });
});

pushRoutes.post('/unsubscribe', async (c) => {
  const { endpoint } = await readBody(c);
  await getDb(c.env.DB)
    .delete(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, parseEndpoint(endpoint)));
  return c.json({ success: true });
});

pushRoutes.post('/status', async (c) => {
  const { endpoint } = await readBody(c);
  const row = await getDb(c.env.DB)
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.endpoint, parseEndpoint(endpoint)))
    .get();
  return c.json({ success: true, subscribed: row !== undefined });
});

pushRoutes.post('/test', async (c) => {
  requireVapid(c.env);
  const result = await deliver(c.env, { title: appName(c.env), body: 'Notifications are working', tag: 'test', url: '/' });
  return c.json({ success: true, ...result });
});
