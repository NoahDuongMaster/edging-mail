import type { MessageKey } from '../../../shared/i18n';
import { ApiError, errorText, UnauthorizedError } from '../api';
import { isRecord } from './helpers';

// The two requests of sealed send go through here instead of `apiPost`: the fetch function can be injected (tests need no network), and the
// answer body stays available (`409 key_changed` carries the new keys, which `apiPost` would drop). Errors follow lib/api.ts exactly.

/** `fetch`, or a stand-in. */
export type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export const browserFetch: Fetcher = (url, init) => fetch(url, init);

export interface Answer {
  res: Response;
  /** The JSON object the server answered, or null (a proxy page, a deploy in progress). */
  data: Record<string, unknown> | null;
}

export async function postJson(url: string, body: string | Record<string, unknown>, fetcher: Fetcher): Promise<Answer> {
  const res = await fetcher(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body)
  });
  const data = await res.json<unknown>().catch(() => null);
  return { res, data: isRecord(data) ? data : null };
}

export type Success = Answer & { data: Record<string, unknown> };

export const succeeded = (answer: Answer): answer is Success => answer.res.ok && answer.data?.success === true;

/**
 * The error of a failed answer, as `request()` of lib/api.ts makes it: text in the UI language (`err.<code>`, or the fallback when the server sent
 * no code); a 401 with code `unauthorized` or no code is a lost session (neither route here is a credential check); a 429 carries `retryAfter`.
 */
export function failureOf(answer: Answer, fallback: MessageKey): ApiError | UnauthorizedError {
  const { res, data } = answer;
  const code = typeof data?.code === 'string' && data.code !== '' ? data.code : undefined;
  const message = errorText(code, fallback);
  if (res.status === 401 && (code === undefined || code === 'unauthorized')) {
    return new UnauthorizedError(message);
  }
  const retryAfter = Number.parseInt(res.headers.get('Retry-After') ?? '', 10);
  return new ApiError(message, res.status, code, Number.isNaN(retryAfter) ? undefined : retryAfter);
}
