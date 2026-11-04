import { Hono } from 'hono';
import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { Env } from './types';
import { errorMessage, getDb } from './db';
import type { Db } from './db';
import { loginAttempts, settings } from './db/schema';
import { nonEmpty } from './utils';

const COOKIE_NAME = 'edging_session';
const SESSION_SECONDS = 14 * 24 * 60 * 60;
const MIN_JWT_SECRET_LENGTH = 32;
const MIN_PASSWORD_LENGTH = 12;
// settings row: sessions issued before this time (ms) are revoked. Not part of the /api/settings keys.
const SESSIONS_VALID_AFTER_KEY = 'sessions_valid_after';

const WRONG_PASSWORD_DELAY_MS = 400;
const GLOBAL_PRESSURE_DELAY_MS = 3000;
const ATTEMPT_WINDOW_MS = 15 * 60_000;
const LOCK_BASE_MS = 15 * 60_000;
const LOCK_MAX_MS = 24 * 60 * 60_000;
const RETAIN_MS = 24 * 60 * 60_000;
const GLOBAL_KEY = 'global';
const GLOBAL_WINDOW_MS = 60 * 60_000;
const GLOBAL_FAILURE_LIMIT = 20;
// Attempts per lock. The counter also counts the attempt that triggers the lock, so one lock cycle is 6 numbers wide:
// 1..5 are let through, 6 is refused and locks, 7..11 are let through again after the lock, 12 locks twice as long, and so on.
const ATTEMPTS_PER_LOCK = 5;
const CYCLE = ATTEMPTS_PER_LOCK + 1;

const encoder = new TextEncoder();

const toBase64Url = (bytes: Uint8Array): string =>
  btoa(String.fromCodePoint(...bytes))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');

const fromBase64Url = (value: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.codePointAt(0) ?? 0);

const hmacKey = (secret: string): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const warned = new Set<string>();
function warnTooShort(name: string, minimum: number): void {
  if (!warned.has(name)) {
    warned.add(name);
    console.error(`[edging-mail] ${name} is shorter than ${minimum} characters: login is disabled until it is replaced`);
  }
}

// Login only works (and old cookies only count) while both secrets are set and long enough: fail closed.
function loadSecrets(env: Env): { password: string; key: string } | undefined {
  const jwtSecret = nonEmpty(env.JWT_SECRET);
  const password = nonEmpty(env.APP_PASSWORD);
  if (jwtSecret === undefined || password === undefined) {
    return undefined;
  }
  if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
    warnTooShort('JWT_SECRET', MIN_JWT_SECRET_LENGTH);
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    warnTooShort('APP_PASSWORD', MIN_PASSWORD_LENGTH);
  }
  if (jwtSecret.length < MIN_JWT_SECRET_LENGTH || password.length < MIN_PASSWORD_LENGTH) {
    return undefined;
  }
  // The signing key contains the password, so changing APP_PASSWORD signs every session out.
  return { password, key: `${jwtSecret}\u0000${password}` };
}

async function createSessionToken(key: string): Promise<string> {
  const now = Date.now();
  // iat is in milliseconds (like sessions_valid_after) so a logout and a login within the same second stay ordered.
  const payload = toBase64Url(encoder.encode(JSON.stringify({ iat: now, exp: Math.floor(now / 1000) + SESSION_SECONDS })));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(key), encoder.encode(payload));
  return `${payload}.${toBase64Url(new Uint8Array(signature))}`;
}

// Returns the issue time (ms) of a genuine, unexpired token.
async function sessionIssuedAt(token: string | undefined, key: string): Promise<number | undefined> {
  const parts = token?.split('.');
  if (parts?.length !== 2) {
    return undefined;
  }
  const [payload = '', signature = ''] = parts;
  try {
    // SubtleCrypto.verify compares the MAC in constant time
    const authentic = await crypto.subtle.verify('HMAC', await hmacKey(key), fromBase64Url(signature), encoder.encode(payload));
    if (!authentic) {
      return undefined;
    }
    const { exp, iat } = JSON.parse(new TextDecoder().decode(fromBase64Url(payload))) as { exp?: unknown; iat?: unknown };
    return typeof exp === 'number' && exp > Date.now() / 1000 && typeof iat === 'number' ? iat : undefined;
  } catch {
    // malformed base64 or JSON
    return undefined;
  }
}

// Compares MACs of both values, never the values: SubtleCrypto.verify is constant-time and the length does not leak.
async function passwordMatches(supplied: string, expected: string, key: string): Promise<boolean> {
  const hmac = await hmacKey(key);
  const mac = await crypto.subtle.sign('HMAC', hmac, encoder.encode(supplied));
  return crypto.subtle.verify('HMAC', hmac, mac, encoder.encode(expected));
}

// A genuine, unexpired cookie that logout has not revoked. Throws when the revocation marker cannot be read.
async function verifySession(c: Context<{ Bindings: Env }>): Promise<boolean> {
  const secrets = loadSecrets(c.env);
  if (secrets === undefined) {
    return false;
  }
  const issuedAt = await sessionIssuedAt(getCookie(c, COOKIE_NAME), secrets.key);
  if (issuedAt === undefined) {
    return false;
  }
  const marker = await getDb(c.env.DB)
    .select({ value: settings.value })
    .from(settings)
    .where(eq(settings.key, SESSIONS_VALID_AFTER_KEY))
    .get();
  // An unreadable marker (NaN) compares false: fail closed.
  return issuedAt > Number(marker?.value ?? 0);
}

async function isAuthenticated(c: Context<{ Bindings: Env }>): Promise<boolean> {
  try {
    return await verifySession(c);
  } catch (error) {
    console.error('[edging-mail] Session check failed:', errorMessage(error));
    return false;
  }
}

/** Rejects every /api request without a valid session cookie, except /api/health and /api/auth/*. */
export const requireAuth: MiddlewareHandler<{ Bindings: Env }> = async (c, next) => {
  const path = c.req.path;
  if (path === '/api/health' || path.startsWith('/api/auth/') || (await isAuthenticated(c))) {
    await next();
    return;
  }
  return c.json({ success: false, error: 'Unauthorized' }, 401);
};

// IPv4 as is, IPv6 reduced to its /64 (one subscriber gets a whole /64), anything else shares the 'local' key.
function clientKey(c: Context<{ Bindings: Env }>): string {
  const ip = c.req.header('CF-Connecting-IP')?.trim() ?? '';
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(ip)) {
    return ip;
  }
  const halves = ip.split('::');
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves[1] ? halves[1].split(':') : [];
  const fill = 8 - head.length - tail.length;
  const groups = halves.length === 2 ? [...head, ...Array.from({ length: Math.max(fill, 0) }, () => '0'), ...tail] : head;
  if (halves.length > 2 || (halves.length === 2 && fill < 1) || groups.length !== 8 || !groups.every((g) => /^[\da-f]{1,4}$/i.test(g))) {
    return 'local';
  }
  return `${groups
    .slice(0, 4)
    .map((g) => Number.parseInt(g, 16).toString(16))
    .join(':')}::/64`;
}

// Counts this attempt BEFORE the password is compared, in one atomic upsert, so parallel requests cannot all get a free
// comparison. A correct password deletes the row; a wrong one costs nothing more. Lock lengths: 15 min, then doubling to 24 h.
async function claimAttempt(db: Db, key: string, now: number): Promise<{ allowed: boolean; retryAfter: number }> {
  const t = loginAttempts;
  const locked = sql`${t.locked_until} > ${now}`;
  // A row is forgotten after 24 h of silence, or once its 15-minute window is over if it never locked.
  const forgotten = sql`(${t.updated_at} < ${now - RETAIN_MS} OR (${t.locked_until} = 0 AND ${t.window_start} < ${now - ATTEMPT_WINDOW_MS}))`;
  const counted = sql`${t.failures} + 1`;
  const rows = await db
    .insert(t)
    .values({ key, failures: 1, window_start: now, locked_until: 0, updated_at: now })
    .onConflictDoUpdate({
      target: t.key,
      set: {
        failures: sql`CASE WHEN ${forgotten} THEN 1 WHEN ${locked} THEN ${t.failures} ELSE ${counted} END`,
        window_start: sql`CASE WHEN ${forgotten} THEN ${now} ELSE ${t.window_start} END`,
        locked_until: sql`CASE WHEN ${forgotten} THEN 0 WHEN ${locked} THEN ${t.locked_until}
          WHEN (${counted}) % ${CYCLE} = 0 THEN ${now} + MIN(${LOCK_MAX_MS}, ${LOCK_BASE_MS} * (1 << MIN((${counted}) / ${CYCLE} - 1, 7)))
          ELSE ${t.locked_until} END`,
        updated_at: sql`CASE WHEN ${locked} THEN ${t.updated_at} ELSE ${now} END`
      }
    })
    .returning({ failures: t.failures, locked_until: t.locked_until });
  const row = rows.at(0);
  if (row === undefined) {
    throw new Error('login_attempts upsert returned no row');
  }
  return { allowed: row.failures % CYCLE !== 0, retryAfter: Math.max(1, Math.ceil((row.locked_until - now) / 1000)) };
}

// After a wrong password: count it in the shared hourly row, forget stale rows. True when the whole app is being hammered.
async function recordFailure(db: Db): Promise<boolean> {
  const t = loginAttempts;
  const now = Date.now();
  const expired = sql`${t.window_start} < ${now - GLOBAL_WINDOW_MS}`;
  try {
    const [counted] = await db.batch([
      db
        .insert(t)
        .values({ key: GLOBAL_KEY, failures: 1, window_start: now, locked_until: 0, updated_at: now })
        .onConflictDoUpdate({
          target: t.key,
          set: {
            failures: sql`CASE WHEN ${expired} THEN 1 ELSE ${t.failures} + 1 END`,
            window_start: sql`CASE WHEN ${expired} THEN ${now} ELSE ${t.window_start} END`,
            updated_at: now
          }
        })
        .returning({ failures: t.failures }),
      db.delete(t).where(and(lt(t.updated_at, now - RETAIN_MS), lt(t.locked_until, now)))
    ]);
    return (counted[0]?.failures ?? 0) > GLOBAL_FAILURE_LIMIT;
  } catch (error) {
    console.error('[edging-mail] Could not record a failed login:', errorMessage(error));
    return false;
  }
}

export const authRoutes = new Hono<{ Bindings: Env }>();

authRoutes.post('/login', async (c) => {
  const secrets = loadSecrets(c.env);
  if (secrets === undefined) {
    return c.json({ success: false, error: 'Login is not configured' }, 503);
  }

  const db = getDb(c.env.DB);
  const key = clientKey(c);
  let claim;
  try {
    claim = await claimAttempt(db, key, Date.now());
  } catch (error) {
    // Without the throttle there is no login.
    console.error('[edging-mail] Login throttle unavailable:', errorMessage(error));
    return c.json({ success: false, error: 'Login is temporarily unavailable' }, 503);
  }
  if (!claim.allowed) {
    c.header('Retry-After', String(claim.retryAfter));
    return c.json({ success: false, error: 'Too many attempts. Try again later.', retry_after: claim.retryAfter }, 429);
  }

  const body = await c.req.json<{ password?: unknown } | null>().catch(() => null);
  const supplied = typeof body?.password === 'string' ? body.password : '';
  if (!(await passwordMatches(supplied, secrets.password, secrets.key))) {
    const underAttack = await recordFailure(db);
    await sleep(WRONG_PASSWORD_DELAY_MS + (underAttack ? GLOBAL_PRESSURE_DELAY_MS : 0));
    return c.json({ success: false, error: 'Wrong password' }, 401);
  }

  try {
    await db.delete(loginAttempts).where(eq(loginAttempts.key, key));
  } catch (error) {
    console.error('[edging-mail] Could not reset the login counter:', errorMessage(error));
  }
  setCookie(c, COOKIE_NAME, await createSessionToken(secrets.key), {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_SECONDS,
    secure: new URL(c.req.url).protocol === 'https:'
  });
  return c.json({ success: true });
});

authRoutes.post('/logout', async (c) => {
  deleteCookie(c, COOKIE_NAME, { path: '/' });
  try {
    // Only a signed-in caller revokes, otherwise anyone could sign the owner out.
    if (await verifySession(c)) {
      const now = Date.now();
      await getDb(c.env.DB)
        .insert(settings)
        .values({ key: SESSIONS_VALID_AFTER_KEY, value: String(now), updated_at: now })
        .onConflictDoUpdate({ target: settings.key, set: { value: String(now), updated_at: now } });
    }
  } catch (error) {
    console.error('[edging-mail] Logout could not revoke sessions:', errorMessage(error));
    return c.json({ success: false, error: 'Could not sign out on the server' }, 500);
  }
  return c.json({ success: true });
});

authRoutes.get('/session', async (c) => c.json({ success: true, authenticated: await isAuthenticated(c) }));
