import type { HonoRequest } from 'hono';
import type { Env } from './types';

// `nonEmpty(value) ?? fallback` is `value || fallback` for strings: null, undefined and '' all fall through.
export const nonEmpty = (value: string | null | undefined): string | undefined => (value ?? '') || undefined;

// A request body that is not a JSON object, or has a key the route does not know, is the caller's mistake (HTTP 400), not a server
// failure (500). The answer never says why or quotes the body: a parse error can carry a fragment of what was sent.
export const BAD_BODY = 'A JSON object body with only the documented fields is required';
export const jsonObject = async <T extends object>(request: HonoRequest, allowedKeys: readonly string[]): Promise<T | null> => {
  const body = await request.json<unknown>().catch(() => null);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return null;
  }
  return Object.keys(body).every((key) => allowedKeys.includes(key)) ? (body as T) : null;
};

// Product name shown to the user (health check, notification titles): the APP_NAME var from wrangler.jsonc.
export const appName = (env: Env): string => nonEmpty(env.APP_NAME) ?? 'Edging Mail';

// Bare address only ("name@host.tld"); display names are handled separately. No comma or quote either, so
// "a@x.com,b@y.com" is not one address.
export const isEmail = (value: string): boolean => /^[^\s@<>,"]+@[^\s@<>,"]+\.[^\s@<>,"]+$/.test(value);

// R2 key of a stored attachment (inbound and sent): UUIDs only, so a key never reveals a file name.
export const attachmentKey = (messageId: string, attachmentId: string): string => `attachments/${messageId}/${attachmentId}`;

// What to log about a failure: its class, never its message (which can carry file names, addresses or SQL parameters).
export const errorClass = (error: unknown): string => (error instanceof Error ? error.name : typeof error);
