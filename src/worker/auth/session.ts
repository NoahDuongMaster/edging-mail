import type { Context } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { parse } from 'hono/utils/cookie';
import { eq, getTableColumns, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { users } from '../db/schema';
import { toBase64Url } from '../../shared/crypto/server';
import type { AppEnv, Env, SessionUser } from '../types';
import { errorClass, nonEmpty } from '../utils';
import { sessionUser, tempPasswordExpired } from './accounts';
import { readToken, signToken } from './tokens';

// Over https the session cookie is `__Host-edging_session` (PX-9): the browser then refuses to store it unless it is Secure, has Path=/ and no
// Domain, so a page on a sibling subdomain cannot plant ("toss") a cookie of that name for the parent domain, as it can for a plain name. The plain
// name stays for http, which is local development only: the prefix needs Secure, and a Secure cookie does not belong on plain http.
export const COOKIE_NAME = 'edging_session';
export const HOST_COOKIE_NAME = '__Host-edging_session';

const isHttps = (request: Request): boolean => new URL(request.url).protocol === 'https:';

/** The name of the session cookie for this request: the `__Host-` one over https, the plain one over http. */
export const cookieNameFor = (request: Request): string => (isHttps(request) ? HOST_COOKIE_NAME : COOKIE_NAME);

const SESSION_SECONDS = 14 * 24 * 60 * 60;
// A session in use does not run out: a request that finds the cookie more than a day old gets a new one for another fourteen days, so only a
// device that stays away for fourteen days is signed out. The cookie keeps the `iat` of the sign-in, so a revocation (sessions_valid_after) still
// ends it, and the renewals stop ninety days after that sign-in: nobody stays signed in forever by being used.
const SESSION_RENEW_AFTER_SECONDS = 24 * 60 * 60;
export const SESSION_MAX_SECONDS = 90 * 24 * 60 * 60;
// A sign-in from a shared or public device (`shared: true`, CK-17): the cookie is a browser-session cookie and the server ends the session after
// twelve hours whatever the browser does. Never renewed.
const SHARED_SESSION_SECONDS = 12 * 60 * 60;
const MIN_JWT_SECRET_LENGTH = 32;

const warned = new Set<string>();

/**
 * The key that signs session cookies and challenges: JWT_SECRET and nothing else (the setup key may be removed after Setup without signing
 * anyone out). undefined while it is missing or shorter than 32 characters: nobody can sign in and every cookie counts as signed out
 * (fail closed).
 */
export function signingSecret(env: Env): string | undefined {
  const secret = nonEmpty(env.JWT_SECRET);
  if (secret === undefined) {
    return undefined;
  }
  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    if (!warned.has('JWT_SECRET')) {
      warned.add('JWT_SECRET');
      console.error(
        `[edging-mail] JWT_SECRET is shorter than ${MIN_JWT_SECRET_LENGTH} characters: sign-in is disabled until it is replaced`
      );
    }
    return undefined;
  }
  return secret;
}

/** The id of one sign-in: sign-out revokes it alone, and the sockets opened with the cookie carry it. */
const newSessionId = (): string => toBase64Url(crypto.getRandomValues(new Uint8Array(16)));

/**
 * Starts a session for this device. `validAfter` is the user's current sessions_valid_after: the cookie is issued strictly after it,
 * so a sign-out (or password change) and a sign-in within the same millisecond cannot leave the new cookie revoked. `stepUpAt` (epoch ms)
 * records a second-factor check made in this request: step-up actions accept it for five minutes. `options.shared`: a sign-in from a shared
 * device. A renewal of the caller's own session (password change, two-step changes, step-up) leaves it out and inherits the shared mark of the
 * cookie it replaces, so renewing never turns a twelve-hour session into a fourteen-day one.
 */
export async function startSession(
  c: Context<AppEnv>,
  secret: string,
  userId: string,
  validAfter: number,
  stepUpAt = 0,
  options: { shared?: boolean } = {}
): Promise<void> {
  const shared = options.shared ?? (await currentCookieIsShared(c, secret));
  const token = await signToken(
    secret,
    'session',
    { uid: userId, sid: newSessionId(), iat: Math.max(Date.now(), validAfter + 1), su: stepUpAt, ...(shared ? { sh: 1 } : {}) },
    shared ? SHARED_SESSION_SECONDS : SESSION_SECONDS
  );
  // No Max-Age for a shared device: the cookie goes when the browser session ends.
  writeSessionCookie(c, token, shared ? undefined : SESSION_SECONDS);
  dropPlainCookie(c);
}

function writeSessionCookie(c: Context<AppEnv>, token: string, maxAge: number | undefined): void {
  setCookie(c, cookieNameFor(c.req.raw), token, {
    httpOnly: true,
    sameSite: 'Lax',
    path: '/',
    ...(maxAge === undefined ? {} : { maxAge }),
    secure: isHttps(c.req.raw)
  });
}

/**
 * Keeps a session that is being used alive: when the cookie of this request was issued (or last renewed) more than a day ago, answers with a new
 * one for fourteen more days, but never past ninety days after the sign-in. Same account, same `iat` (so a revocation still ends it), same
 * step-up mark. A shared-device cookie is never renewed. Call it AFTER the route ran: an answer that already sets the session cookie (sign-in,
 * password change, sign-out) keeps its own.
 */
export async function renewSessionCookie(c: Context<AppEnv>, claims: Record<string, unknown>): Promise<void> {
  const secret = signingSecret(c.env);
  const { uid, sid, iat, exp, su, sh } = claims;
  if (secret === undefined || sh === 1 || typeof uid !== 'string' || typeof iat !== 'number' || typeof exp !== 'number') {
    return;
  }
  const name = cookieNameFor(c.req.raw);
  if (c.res.headers.getSetCookie().some((cookie) => cookie.startsWith(`${name}=`))) {
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const remaining = exp - now;
  if (remaining > SESSION_SECONDS - SESSION_RENEW_AFTER_SECONDS) {
    return;
  }
  const lifetime = Math.min(SESSION_SECONDS, Math.floor(iat / 1000) + SESSION_MAX_SECONDS - now);
  if (lifetime <= remaining) {
    return;
  }
  const token = await signToken(
    secret,
    'session',
    { uid, ...(typeof sid === 'string' ? { sid } : {}), iat, su: typeof su === 'number' ? su : 0 },
    lifetime
  );
  writeSessionCookie(c, token, lifetime);
}

/**
 * The session token a request carries, under the name of its own scheme and no other. Over https a cookie called `edging_session` is a stale one from
 * before this name was introduced, or a planted one: it is never read (so everybody is signed out once by the upgrade, and a planted cookie is inert).
 */
export function sessionToken(request: Request): string | undefined {
  const header = request.headers.get('Cookie');
  const name = cookieNameFor(request);
  return header === null ? undefined : parse(header, name)[name];
}

/** Whether this request still carries the plain-named cookie (over https only a leftover of the old name). */
const carriesPlainCookie = (request: Request): boolean => {
  const header = request.headers.get('Cookie');
  return header !== null && COOKIE_NAME in parse(header, COOKIE_NAME);
};

/** Over https, removes the leftover plain-named cookie when the browser still has one (a sign-in or a sign-out is the moment to tidy it). */
function dropPlainCookie(c: Context<AppEnv>): void {
  if (isHttps(c.req.raw) && carriesPlainCookie(c.req.raw)) {
    deleteCookie(c, COOKIE_NAME, { path: '/' });
  }
}

/** Whether the session cookie that came with this request was issued for a shared device. */
async function currentCookieIsShared(c: Context<AppEnv>, secret: string): Promise<boolean> {
  const claims = await readToken(sessionToken(c.req.raw), secret, 'session');
  return claims?.sh === 1;
}

/** Sign-out: the cookie of this scheme is cleared, and so is a leftover plain-named one. Works with no session at all. */
export const endSession = (c: Context<AppEnv>): void => {
  deleteCookie(c, cookieNameFor(c.req.raw), { path: '/', ...(isHttps(c.req.raw) ? { secure: true } : {}) });
  dropPlainCookie(c);
};

/**
 * The genuine session token of this request, as far as its signature and expiry go (nothing is looked up in the database): when it ends (its
 * own `exp` claim, epoch ms), which is what an open WebSocket must not outlive (PX-8), and its `sid` (undefined for a cookie from before
 * sign-out became per device). undefined without a genuine token.
 */
export async function sessionTokenInfo(request: Request, env: Env): Promise<{ end: number; sid: string | undefined } | undefined> {
  const secret = signingSecret(env);
  const claims = secret === undefined ? undefined : await readToken(sessionToken(request), secret, 'session');
  return typeof claims?.exp === 'number'
    ? { end: claims.exp * 1000, sid: typeof claims.sid === 'string' ? claims.sid : undefined }
    : undefined;
}

/**
 * Whether the session cookie of this request was issued for a shared device (a renewal inherits the mark). The server's own knowledge of the
 * session, which the app reads from `GET /api/auth/session`: a second tab of a shared computer has no flag of its own (C-5b).
 */
export async function sessionIsShared(c: Context<AppEnv>): Promise<boolean> {
  const secret = signingSecret(c.env);
  return secret !== undefined && (await currentCookieIsShared(c, secret));
}

/** A real session: the account and the claims of the cookie that proved it. */
export interface FoundSession {
  user: SessionUser;
  claims: Record<string, unknown>;
}

/**
 * The one place that decides "this request has a real session": the cookie MAC is valid and not expired, the user still exists and is
 * active, and the cookie was issued after the user's last revocation. null when it has none (signed out, expired, revoked, secret unusable).
 * 'unavailable' when D1 could not be read: that is not an answer about the cookie, so a caller must not tell the browser its session is over
 * (a 401 signs the person out and wipes their key) but that the service is down (a 503). Never throws.
 */
export async function lookupSession(request: Request, env: Env): Promise<FoundSession | null | 'unavailable'> {
  const secret = signingSecret(env);
  if (secret === undefined) {
    return null;
  }
  const claims = await readToken(sessionToken(request), secret, 'session');
  if (claims === undefined || typeof claims.uid !== 'string' || typeof claims.iat !== 'number') {
    return null;
  }
  // A null sid (a cookie from before sign-out became per device) matches no row.
  const sid = typeof claims.sid === 'string' ? claims.sid : null;
  try {
    const row = await getDb(env.DB)
      .select({
        ...getTableColumns(users),
        require_2fa: sql<number>`COALESCE((SELECT value FROM settings WHERE key = 'require_2fa'), '1') != '0'`,
        sid_revoked: sql<number>`EXISTS (SELECT 1 FROM revoked_sessions WHERE sid = ${sid})`
      })
      .from(users)
      .where(eq(users.id, claims.uid))
      .get();
    if (
      row?.status !== 'active' ||
      claims.iat <= row.sessions_valid_after ||
      row.sid_revoked === 1 ||
      tempPasswordExpired(row, Date.now())
    ) {
      return null;
    }
    const stepUp = typeof claims.su === 'number' && claims.su > row.sessions_valid_after ? claims.su : 0;
    return { user: sessionUser(row, { require_2fa: row.require_2fa === 1 }, stepUp), claims };
  } catch (error) {
    console.error('[edging-mail] Session check failed:', errorClass(error));
    return 'unavailable';
  }
}
