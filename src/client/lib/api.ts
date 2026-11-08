import { t as tr, tDyn, type MessageKey } from '../../shared/i18n';
import { nonEmpty } from './mail';
import { RENEWAL_PATHS, renewing } from './sessionRenewal';

interface ApiBody {
  success?: boolean;
  error?: string;
  code?: string;
}

/** The server answered 401: no valid login cookie. main.tsx turns it into a sign-out. */
export class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

// These answer 401 for a WRONG credential (a password, a recovery key, a code), not for a missing session: that 401 is an ordinary
// failure of the screen that asked, and it must neither sign anybody out nor wipe a stored key (CK-13: only the 401 of an authenticated
// route or of the session check does). A wrong code at the step-up is the same.
const CREDENTIAL_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/login/2fa',
  '/api/auth/forgot/verify',
  '/api/auth/forgot/complete',
  '/api/auth/step-up',
  '/api/auth/setup',
  '/api/auth/recover'
]);

const pathOf = (url: string): string => url.split('?', 1)[0] ?? url;

/**
 * A 401 means "this session is over" (sign out, wipe the keys) only when the Worker says `unauthorized` or says nothing at all (a proxy page),
 * and only on a route that is not itself a credential check. Any other 401 is a wrong credential on a route that needs one (a wrong authenticator
 * code while turning two-factor off, an expired sign-in step): the screen shows it, and a typo never signs the person out or deletes their key.
 */
function isSessionLoss(status: number, code: string | undefined, url: string): boolean {
  return status === 401 && (code === undefined || code === 'unauthorized') && !CREDENTIAL_PATHS.has(pathOf(url));
}

/**
 * Any other error answer. `code` is the machine-readable reason when the server sent one (`last_admin`, `step_up_required`, ...).
 * `message` is always text in the UI language (see `errorText`): the server's English `error` is for API clients, not for people.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string | undefined;
  /** Seconds until the server accepts another try (`Retry-After` of a 429), when it said. */
  readonly retryAfter: number | undefined;

  constructor(message: string, status: number, code?: string, retryAfter?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

/**
 * What to tell the person about a failed call, in the UI language: the catalogue's `err.<code>` for a code it knows; a generic
 * "Something went wrong (code)" for a code it does not know; the caller's own fallback text when the server sent no code at all
 * (a proxy error page, a deploy in progress).
 */
export function errorText(code: string | undefined, fallback: MessageKey): string {
  if (code === undefined) {
    return tr(fallback);
  }
  return tDyn(`err.${code}`) ?? tr('common.unknown_error', { code });
}

// Every endpoint answers `{ success, ... }` (or `{ success: false, error, code }`); anything else is an error. A request that renews the
// caller's session (sessionRenewal.ts) is counted as such while it runs, so the signs of the old session ending are not taken for a loss.
function request<T>(url: string, init: RequestInit, fallback: MessageKey): Promise<T> {
  return RENEWAL_PATHS.has(pathOf(url)) ? renewing(() => send<T>(url, init, fallback)) : send<T>(url, init, fallback);
}

async function send<T>(url: string, init: RequestInit, fallback: MessageKey): Promise<T> {
  const res = await fetch(url, init);
  // An error page from a proxy or a deploy in progress is not JSON: it fails like any other answer, with the fallback text.
  const data = await res.json<(T & ApiBody) | null>().catch(() => null);
  if (!res.ok || data?.success !== true) {
    const code = nonEmpty(data?.code);
    const message = errorText(code, fallback);
    if (isSessionLoss(res.status, code, url)) {
      throw new UnauthorizedError(message);
    }
    const retryAfter = Number.parseInt(res.headers.get('Retry-After') ?? '', 10);
    throw new ApiError(message, res.status, code, Number.isNaN(retryAfter) ? undefined : retryAfter);
  }
  return data;
}

export function apiGet<T>(url: string, fallback: MessageKey, signal?: AbortSignal): Promise<T> {
  return request<T>(url, { signal }, fallback);
}

function sendJson<T>(method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, body: unknown, fallback: MessageKey): Promise<T> {
  return request<T>(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, fallback);
}

export function apiPost<T>(url: string, body: unknown, fallback: MessageKey): Promise<T> {
  return sendJson<T>('POST', url, body, fallback);
}

export function apiPut<T>(url: string, body: unknown, fallback: MessageKey): Promise<T> {
  return sendJson<T>('PUT', url, body, fallback);
}

export function apiPatch<T>(url: string, body: unknown, fallback: MessageKey): Promise<T> {
  return sendJson<T>('PATCH', url, body, fallback);
}

/** DELETE, with a JSON body when the route asks for one (deleting an account needs its typed address). */
export function apiDelete<T>(url: string, fallback: MessageKey, body?: unknown): Promise<T> {
  return body === undefined ? request<T>(url, { method: 'DELETE' }, fallback) : sendJson<T>('DELETE', url, body, fallback);
}
