import type { Env } from './types';

// `nonEmpty(value) ?? fallback` is `value || fallback` for strings: null, undefined and '' all fall through.
export const nonEmpty = (value: string | null | undefined): string | undefined => (value ?? '') || undefined;

// Product name shown to the user (health check, notification titles): the APP_NAME var from wrangler.jsonc.
export const appName = (env: Env): string => nonEmpty(env.APP_NAME) ?? 'Edging Mail';

// Bare address only ("name@host.tld"); display names are handled separately. No comma or quote either, so
// "a@x.com,b@y.com" is not one address.
export const isEmail = (value: string): boolean => /^[^\s@<>,"]+@[^\s@<>,"]+\.[^\s@<>,"]+$/.test(value);

// R2 key of a stored attachment (inbound and sent): the file name is reduced to a safe character set.
export const attachmentKey = (messageId: string, attachmentId: string, filename: string | null | undefined): string =>
  `attachments/${messageId}/${attachmentId}_${(nonEmpty(filename) ?? 'attachment').replaceAll(/[^a-zA-Z0-9._-]/g, '_')}`;
