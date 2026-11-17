// The spam filter at arrival: glue between the pure scorer and the database. It runs once for each mail that arrives by email, in parseAndStoreEmail, while the
// Worker still holds the plaintext (after sealing, the server cannot read a mail, so this is the only moment a content-based verdict is possible). It reads the
// person's setting and lists, the hosted domains and, only when the rules alone say spam, whether the person has written to the sender or the mail answers one of
// their own. Nothing is sent anywhere: no DNS blocklist, no URL reputation, no model, no counter that learns from content.

import type { Email } from 'postal-mime';
import { and, asc, eq, inArray, notInArray, sql } from 'drizzle-orm';
import type { Db } from '../db';
import { domains, mailFilters, messages, users } from '../db/schema';
import { errorClass } from '../utils';
import type { AuthResult } from './auth-results';
import { factsFromEmail } from './facts';
import type { MailFacts } from './facts';
import { hostOfAddress } from './hosts';
import { listDecision } from './lists';
import { BLOCK_LISTED, spoofsOwnDomain, THRESHOLD } from './rules';
import { reachesThreshold, reasonsOf, scoreMail } from './score';

/** Which step decided the verdict. It is not stored: only `spam`, the score and the reasons of a spam mail are. Tests read it to prove the order of the steps. */
export type Basis = 'filter_off' | 'block_listed' | 'allow_listed' | 'known_correspondent' | 'reply_to_own_mail' | 'rules';

export interface Verdict {
  spam: boolean;
  /** For a spam mail: the score (a block entry counts as exactly the threshold). Otherwise the score the rules gave, 0 when none was computed. */
  score: number;
  /** For a spam mail: the rule ids that added to the score, biggest first, at most six. Empty otherwise. */
  reasons: string[];
  basis: Basis;
}

const NOT_SPAM = (basis: Basis, score = 0): Verdict => ({ spam: false, score, reasons: [], basis });

// A References header can be long: the answer is to one of the last ids.
const MAX_REFERENCE_IDS = 20;
const MESSAGE_ID = /<[^<>\s]{1,255}>/g;

/** The message ids a mail answers: those of In-Reply-To and the last ones of References (with their angle brackets, as they are stored). */
export function repliedIds(inReplyTo: string | undefined, references: string | undefined): string[] {
  const ids = [...(inReplyTo ?? '').slice(0, 4000).matchAll(MESSAGE_ID), ...(references ?? '').slice(-4000).matchAll(MESSAGE_ID)].map(
    (found) => found[0]
  );
  const bare = (inReplyTo ?? '').trim();
  if (ids.length === 0 && bare.length > 0 && bare.length <= 255 && !/[\s<>]/.test(bare)) {
    ids.push(bare);
  }
  return [...new Set(ids)].slice(-MAX_REFERENCE_IDS);
}

/** Has this person written to `address` (to or cc of a mail in their Sent folder, an exact entry of the comma-separated list)? One query, one row at most. */
async function hasWrittenTo(db: Db, ownerId: string, address: string): Promise<boolean> {
  if (address === '') {
    return false;
  }
  const needle = `,${address},`;
  const list = (column: typeof messages.to_address | typeof messages.cc) =>
    sql`instr(',' || replace(lower(coalesce(${column}, '')), ' ', '') || ',', ${needle}) > 0`;
  const row = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.user_id, ownerId), eq(messages.folder, 'sent'), sql`(${list(messages.to_address)} OR ${list(messages.cc)})`))
    .limit(1)
    .get();
  return row !== undefined;
}

/** Does the mail answer one of the person's mails (other than one they sent to Spam or Trash)? */
async function repliesToOwnMail(db: Db, ownerId: string, ids: readonly string[]): Promise<boolean> {
  if (ids.length === 0) {
    return false;
  }
  const row = await db
    .select({ id: messages.id })
    .from(messages)
    .where(and(eq(messages.user_id, ownerId), inArray(messages.message_id, [...ids]), notInArray(messages.folder, ['spam', 'trash'])))
    .limit(1)
    .get();
  return row !== undefined;
}

/** The mail the filter looks at: its facts and the two headers that say which mail it answers. */
export interface Arrival {
  facts: MailFacts;
  inReplyTo: string | undefined;
  references: string | undefined;
}

/**
 * The verdict for one arriving mail of one person. Order: the person's switch (off: nothing is scanned); their lists (the most specific entry wins; a block
 * entry is spam, an allow entry is not); then the rules. A mail the rules call spam is still not spam when the person has written to the sender or the mail
 * answers one of their own mails, unless it claims a domain this deployment hosts without passing DMARC (that is somebody posing as one of us, and an address
 * the person wrote to is exactly what such a mail would use).
 */
export async function classify(db: Db, ownerId: string, arrival: Arrival): Promise<Verdict> {
  const on = await db.select({ on: users.spam_filter }).from(users).where(eq(users.id, ownerId)).get();
  if (on?.on !== 1) {
    return NOT_SPAM('filter_off');
  }
  const { facts } = arrival;
  const entries = await db
    .select({ kind: mailFilters.kind, value: mailFilters.value, created_at: mailFilters.created_at })
    .from(mailFilters)
    .where(eq(mailFilters.user_id, ownerId))
    .orderBy(asc(mailFilters.created_at));
  const listed = listDecision(entries, facts.fromAddress);
  if (listed === 'block') {
    return { spam: true, score: THRESHOLD, reasons: [BLOCK_LISTED], basis: 'block_listed' };
  }
  if (listed === 'allow') {
    return NOT_SPAM('allow_listed');
  }
  const host = hostOfAddress(facts.fromAddress);
  const hosted = host !== '' && (await db.select({ id: domains.id }).from(domains).where(eq(domains.name, host)).get()) !== undefined;
  const scored = scoreMail({ ...facts, fromHosted: hosted });
  if (!reachesThreshold(scored.score)) {
    return NOT_SPAM('rules', scored.score);
  }
  if (!spoofsOwnDomain({ ...facts, fromHosted: hosted })) {
    if (await hasWrittenTo(db, ownerId, facts.fromAddress)) {
      return NOT_SPAM('known_correspondent', scored.score);
    }
    if (await repliesToOwnMail(db, ownerId, repliedIds(arrival.inReplyTo, arrival.references))) {
      return NOT_SPAM('reply_to_own_mail', scored.score);
    }
  }
  return { spam: true, score: scored.score, reasons: reasonsOf(scored.hits), basis: 'rules' };
}

/**
 * The verdict for a parsed mail, or "not spam" when the filter cannot be run: a mail is never lost, rejected or delayed by it. A failure is logged by its
 * class only (never the mail, never an address) and the mail goes to the Inbox.
 */
export async function classifyArrival(
  db: Db,
  ownerId: string | null,
  parsed: Email,
  fromAddress: string,
  auth: AuthResult | null
): Promise<Verdict> {
  if (ownerId === null) {
    // Mail that arrives before Setup has no person, so no setting and no lists: it is kept as it is.
    return NOT_SPAM('filter_off');
  }
  try {
    return await classify(db, ownerId, {
      facts: factsFromEmail(parsed, fromAddress, auth),
      inReplyTo: parsed.inReplyTo,
      references: parsed.references
    });
  } catch (error) {
    console.error('[edging-mail] Spam filter failed, the mail goes to the inbox:', errorClass(error));
    return NOT_SPAM('filter_off');
  }
}
