import type { Message } from '../types';
import type { MessageKey } from './i18n';

// Why a message is in Spam, in words a person can read. The Worker's filter records the ids of the rules that fired in `spam_reasons` (a JSON
// array written as text, like `labels`); this module turns them into catalogue keys. Pure, so it runs in Node: the screen never trusts the
// column (an older row has none, a newer Worker may name a rule this client has never heard of), and nothing here throws.

/**
 * The rules the Worker may report, each with the key of its sentence. Written out whole (no key is built from the id): the unused-key scan sees
 * every one, and an id that is not a key of this table can never reach the catalogue.
 */
export const SPAM_REASON_KEYS = {
  auth_failed: 'spam.reason.auth_failed',
  auth_missing_pass: 'spam.reason.auth_missing_pass',
  block_listed: 'spam.reason.block_listed',
  display_name_mismatch: 'spam.reason.display_name_mismatch',
  hidden_text: 'spam.reason.hidden_text',
  html_attachment: 'spam.reason.html_attachment',
  image_only: 'spam.reason.image_only',
  link_ip_address: 'spam.reason.link_ip_address',
  link_shortener: 'spam.reason.link_shortener',
  link_text_mismatch: 'spam.reason.link_text_mismatch',
  macro_attachment: 'spam.reason.macro_attachment',
  many_links: 'spam.reason.many_links',
  no_date: 'spam.reason.no_date',
  no_message_id: 'spam.reason.no_message_id',
  no_subject: 'spam.reason.no_subject',
  phishing_phrases: 'spam.reason.phishing_phrases',
  reply_to_differs: 'spam.reason.reply_to_differs',
  risky_attachment: 'spam.reason.risky_attachment',
  shouting_subject: 'spam.reason.shouting_subject',
  spam_phrases: 'spam.reason.spam_phrases',
  spoofs_own_domain: 'spam.reason.spoofs_own_domain'
} as const satisfies Record<string, MessageKey>;

/** The sentence for any rule this client does not know. */
export const OTHER_REASON = 'spam.reason.other' satisfies MessageKey;

/** How many reasons the banner shows before "See all". */
export const SHOWN_REASONS = 3;

/** More ids than this in one column are not a filter's doing; the rest are ignored (the screen stays short and cheap). */
const MAX_IDS = 50;

/** The ids in `raw`: a JSON array of strings. Anything else (null, malformed text, an object, numbers) gives none; repeats are dropped. */
export function parseSpamReasons(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw === '') {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  const ids = parsed.filter((id): id is string => typeof id === 'string' && id.trim() !== '').map((id) => id.trim());
  return [...new Set(ids)].slice(0, MAX_IDS);
}

/** The sentence of one rule: its own, or the general one for an id nobody here knows (an own property only: 'constructor' is not a rule). */
export function reasonKey(id: string): MessageKey {
  return Object.hasOwn(SPAM_REASON_KEYS, id) ? SPAM_REASON_KEYS[id as keyof typeof SPAM_REASON_KEYS] : OTHER_REASON;
}

/** What the banner says: the first reasons, and the rest behind "See all". Both empty: nothing was recorded. */
export interface SpamExplanation {
  shown: MessageKey[];
  more: MessageKey[];
}

/**
 * The reasons of a message in Spam, in the order the filter gave them, as sentences: several unknown ids are one "other" line, and a row the
 * filter scored but whose reasons cannot be read still says so with that line. A message with no score and no reasons (one the person moved
 * to Spam themselves, or from before the filter) has none: the banner then says only that.
 */
export function explainSpam(message: Pick<Message, 'spam_reasons' | 'spam_score'>, limit = SHOWN_REASONS): SpamExplanation {
  const keys = [...new Set(parseSpamReasons(message.spam_reasons).map((id) => reasonKey(id)))];
  if (keys.length === 0 && typeof message.spam_score === 'number') {
    keys.push(OTHER_REASON);
  }
  return { shown: keys.slice(0, limit), more: keys.slice(limit) };
}
