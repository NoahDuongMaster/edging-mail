import type { Context, MiddlewareHandler } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { LOCALES } from '../shared/i18n/languages';
import { errorClass } from './utils';
import type { AppEnv } from './types';

// The registry of every error code the Worker can answer with (addendum 4.6): `code` -> English text and HTTP status. The English `error` stays
// for API clients and docs; the client shows its own localised text for the `code` (catalogue key `err.<code>`). Routes answer with
// `apiError(c, 'code')`. An error response that was written without a code still gets one: `withErrorCodes` maps its text (or, failing that,
// its status) to a registry code, so no response ever leaves without one. test/errors.test.ts checks the registry against the source.

interface Entry {
  status: ContentfulStatusCode;
  error: string;
}

/**
 * The app's languages as the end of an English sentence ("en, vi or zh-CN"), built from the one list (`LOCALES`) so that adding a language touches no
 * message. The text of an error stays English; its `code` is what the client localises.
 */
export const LANGUAGE_CHOICES = `${LOCALES.slice(0, -1).join(', ')} or ${LOCALES.slice(-1).join('')}`;

export const ERRORS = {
  // Generic (the fallback of each status)
  invalid_request: { status: 400, error: 'The request is not valid' },
  invalid_body: { status: 400, error: 'A JSON object body with only the documented fields is required' },
  unauthorized: { status: 401, error: 'Unauthorized' },
  forbidden: { status: 403, error: 'Forbidden' },
  not_found: { status: 404, error: 'Not found' },
  conflict: { status: 409, error: 'The request conflicts with the current state' },
  payload_too_large: { status: 413, error: 'The request is too large' },
  too_many_requests: { status: 429, error: 'Too many requests. Try again later.' },
  server_error: { status: 500, error: 'Something went wrong' },
  bad_gateway: { status: 502, error: 'An upstream service did not answer' },
  unavailable: { status: 503, error: 'This is temporarily unavailable' },
  // Configuration
  not_configured: { status: 503, error: 'Server is not configured' },
  // Sign-in, gates, sessions
  admin_required: { status: 403, error: 'Administrator access is required' },
  wrong_credentials: { status: 401, error: 'Wrong email or password' },
  wrong_password: { status: 403, error: 'The current password is wrong' },
  wrong_code: { status: 401, error: 'That code is wrong or was already used' },
  wrong_setup_key: { status: 401, error: 'Wrong setup key' },
  too_many_attempts: { status: 429, error: 'Too many attempts. Try again later.' },
  too_many_lookups: { status: 429, error: 'Too many lookups. Try again later.' },
  upgrade_required: { status: 426, error: 'Expected a WebSocket upgrade request' },
  account_disabled: { status: 403, error: 'This account is disabled. Contact your administrator.' },
  challenge_invalid: { status: 401, error: 'This sign-in step has expired. Sign in again.' },
  two_factor_broken: { status: 403, error: 'Two-step verification is broken for this account. Ask an administrator to reset it.' },
  two_factor_required: { status: 403, error: 'Two-step verification is required and cannot be turned off' },
  two_factor_enrollment_required: { status: 403, error: 'Set up two-step verification first' },
  password_change_required: { status: 403, error: 'Choose a new password first' },
  key_setup_required: { status: 403, error: 'Set up your encryption keys first' },
  admin_password_upgrade_required: { status: 403, error: 'Set a password of the administrator length first' },
  step_up_required: { status: 403, error: 'Confirm with a code from your authenticator first' },
  already_set_up: { status: 409, error: 'Setup is already done' },
  not_enabled: { status: 409, error: 'Two-step verification is not on' },
  already_enabled: { status: 409, error: 'Two-step verification is already on' },
  not_started: { status: 409, error: 'Two-step enrolment was not started' },
  // Keys, passwords, recovery
  same_password: { status: 400, error: 'Choose a password that is different from your current one' },
  keys_required: { status: 400, error: 'The private key must be wrapped again under the new password' },
  invalid_keys: { status: 400, error: 'The keys are not valid' },
  keys_changed: { status: 409, error: 'Your keys changed in the meantime. Reload and try again.' },
  key_in_use: { status: 409, error: 'That key is already in use' },
  not_applicable: { status: 409, error: 'This does not apply to the account in its current state' },
  recovery_failed: {
    status: 401,
    error:
      'The recovery key or the authenticator code is not correct. If you use two-factor sign-in, enter the code from your authenticator app too.'
  },
  ticket_invalid: { status: 401, error: 'This recovery has expired. Start again.' },
  recovery_stale: { status: 409, error: 'Your account changed in the meantime. Start again.' },
  // Mail
  message_not_found: { status: 404, error: 'Message not found' },
  draft_not_found: { status: 404, error: 'Draft not found' },
  not_a_draft: { status: 409, error: 'This id belongs to a message that is not a draft' },
  from_not_allowed: { status: 403, error: 'You can only send from your own address' },
  // Admin: users, aliases, domains
  invalid_address: { status: 400, error: 'That is not an address this product can host' },
  invalid_hostname: { status: 400, error: 'That is not a valid domain name' },
  domain_not_configured: { status: 400, error: 'Add the domain first' },
  domain_exists: { status: 409, error: 'That domain is already added' },
  domain_in_use: { status: 409, error: 'Addresses still use this domain' },
  domain_not_found: { status: 404, error: 'Domain not found' },
  address_taken: { status: 409, error: 'That address is already in use' },
  no_such_admin: { status: 404, error: 'No administrator has that address' },
  reissue_refused: {
    status: 409,
    error: 'A new temporary password can only be issued while the person has not chosen their own password yet'
  },
  user_not_found: { status: 404, error: 'User not found' },
  alias_not_found: { status: 404, error: 'Alias not found' },
  too_many_aliases: { status: 400, error: 'This account has the most aliases it can have' },
  cannot_disable_self: { status: 409, error: 'You cannot disable your own account' },
  cannot_delete_self: { status: 409, error: 'You cannot delete your own account' },
  cannot_reset_self: { status: 409, error: 'You cannot reset your own two-step verification' },
  last_admin: { status: 409, error: 'There must always be one active administrator' },
  confirm_mismatch: { status: 400, error: 'The confirmation does not match' },
  reset_limit: { status: 429, error: 'Too many resets for this person. Try again later.' },
  notice_locked: { status: 403, error: 'This notice cannot be dismissed yet' },
  notice_not_found: { status: 404, error: 'Notice not found' },
  no_pending_reset: { status: 409, error: 'No reset of your two-step verification is pending' },
  dns_lookup_failed: { status: 502, error: 'The DNS lookup failed' },
  invalid_language: { status: 400, error: `language must be ${LANGUAGE_CHOICES}` },
  // Internal (end-to-end) mail: POST /api/messages/internal
  key_changed: { status: 409, error: "A recipient's key changed. Their current keys are in the answer: encrypt the message again." },
  too_many_recipients: { status: 400, error: 'A message can have at most 50 different recipients' },
  recipient_not_internal: { status: 400, error: 'Some recipients are not on this deployment: send the message the normal way' },
  copies_mismatch: { status: 400, error: 'There must be exactly one encrypted copy for each recipient' },
  id_in_use: { status: 409, error: 'One of the ids is already in use' }
} as const satisfies Record<string, Entry>;

export type ErrorCode = keyof typeof ERRORS;

/** A JSON error answer from the registry: `{ success: false, error, code, ...extra }`. `error` can be replaced by a more specific English text. */
export function apiError(c: Context, code: ErrorCode, extra: Record<string, unknown> = {}): Response {
  const entry: Entry = ERRORS[code];
  return c.json({ success: false, error: entry.error, code, ...extra }, entry.status);
}

/**
 * An unexpected failure: logged by its CLASS only and answered with the fixed text; nothing internal reaches the client. The message text of a
 * storage, database or parsing error can carry ids, addresses, file names or submitted values, so it is never logged here.
 */
export function failed(c: Context, error: unknown): Response {
  console.error(`[edging-mail] ${c.req.method} ${c.req.path} failed:`, errorClass(error));
  return apiError(c, 'server_error');
}

const BY_TEXT = new Map<string, ErrorCode>((Object.entries(ERRORS) as [ErrorCode, Entry][]).map(([code, entry]) => [entry.error, code]));
const BY_STATUS: Partial<Record<number, ErrorCode>> = {
  400: 'invalid_request',
  401: 'unauthorized',
  403: 'forbidden',
  404: 'not_found',
  409: 'conflict',
  413: 'payload_too_large',
  429: 'too_many_requests',
  500: 'server_error',
  502: 'bad_gateway',
  503: 'unavailable'
};

/** The registry code for an error answer that has none: by its exact text, else by its status. */
export const codeFor = (status: number, text: unknown): ErrorCode =>
  (typeof text === 'string' ? BY_TEXT.get(text) : undefined) ?? BY_STATUS[status] ?? 'server_error';

/** An error that carries its own status (an HTTPException, a send failure): its text stays for API clients, the code comes from the registry. */
export const statusError = (c: Context, status: ContentfulStatusCode, message: string): Response =>
  c.json({ success: false, error: message, code: codeFor(status, message) }, status);

/**
 * Registered high in the stack: every `{ success: false }` JSON answer leaves with a registry `code`, also the ones a route wrote by hand
 * without one, and a thrown HTTPException or an unknown route answers in the same shape instead of plain text.
 */
export const withErrorCodes: MiddlewareHandler<AppEnv> = async (c, next) => {
  await next();
  const status = c.res.status;
  if (status < 400 || c.res.headers.get('Content-Type')?.startsWith('application/json') !== true) {
    return;
  }
  const body: unknown = await c.res
    .clone()
    .json()
    .catch(() => null);
  if (typeof body !== 'object' || body === null || (body as { success?: unknown }).success !== false || 'code' in body) {
    return;
  }
  const code = codeFor(status, (body as { error?: unknown }).error);
  const headers = new Headers(c.res.headers);
  headers.delete('Content-Length');
  // A middleware that returns a Response replaces the answer.
  return Response.json({ ...body, code }, { status, headers });
};
