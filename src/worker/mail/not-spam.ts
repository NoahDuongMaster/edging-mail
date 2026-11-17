import { and, eq, inArray } from 'drizzle-orm';
import { domainOf } from '../addresses';
import type { Db } from '../db';
import { domains, mailFilters, messages } from '../db/schema';
import { addFilter } from './filters';
import { normaliseEntry } from '../spam/lists';
import { ownedBy } from './view';

// D1 allows 100 bound variables per statement: ids go to it in chunks, next to the owner and the other values.
const CHUNK = 80;

export interface NotSpamResult {
  /** How many of the given messages were in Spam and are now in the Inbox. */
  count: number;
  /** The allow entries this call created (not the ones that already existed), so a client can take them back. */
  allowed: { id: string; value: string }[];
  /** The addresses whose own block entry this call removed (an address is not on both lists), so a client can put them back. */
  unblocked: string[];
}

/**
 * "Not spam": moves the caller's messages that are in Spam to the Inbox (their verdict, `spam_score` and `spam_reasons`, stays: an Undo, or a later move back to
 * Spam, still says why) and adds an allow entry for each distinct sender address (taking that address off the block list when it is on it: one address is not on both lists; a block of
 * the whole host stays, the address entry is the more specific), so the next mail from there is not judged again. A sender on a domain this deployment hosts is never allow-listed (that address is
 * only what a sender wrote, and an entry for it would let somebody posing as one of us in), and neither is an address that is not a plain `name@host`. When the
 * list is full the messages are still moved and the entries that no longer fit are left out. Undoing it is the client's move back to Spam and deleting the
 * entries it was given and blocking the addresses it was told it unblocked.
 */
export async function markNotSpam(db: Db, userId: string, ids: readonly string[], now: number): Promise<NotSpamResult> {
  const moved: { id: string; from_address: string }[] = [];
  for (let start = 0; start < ids.length; start += CHUNK) {
    moved.push(
      ...(await db
        .update(messages)
        .set({ folder: 'inbox', snoozed_until: null, updated_at: now })
        .where(and(ownedBy(userId), eq(messages.folder, 'spam'), inArray(messages.id, ids.slice(start, start + CHUNK))))
        .returning({ id: messages.id, from_address: messages.from_address }))
    );
  }
  const hostedDomains = await db.select({ name: domains.name }).from(domains);
  const hosted = new Set(hostedDomains.map((row) => row.name));
  const senders = new Set<string>();
  for (const row of moved) {
    const value = normaliseEntry(row.from_address);
    if (value?.includes('@') === true && !hosted.has(domainOf(value))) {
      senders.add(value);
    }
  }
  const allowed: NotSpamResult['allowed'] = [];
  const unblocked: string[] = [];
  for (const value of senders) {
    const removed = await db
      .delete(mailFilters)
      .where(and(eq(mailFilters.user_id, userId), eq(mailFilters.kind, 'block'), eq(mailFilters.value, value)))
      .returning({ id: mailFilters.id });
    if (removed.length > 0) {
      unblocked.push(value);
    }
    const created = await addFilter(db, userId, 'allow', value, now);
    if (created !== undefined) {
      allowed.push({ id: created.id, value: created.value });
    }
  }
  return { count: moved.length, allowed, unblocked };
}
