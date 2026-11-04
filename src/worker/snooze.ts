import { and, eq, isNotNull, lte } from 'drizzle-orm';
import { errorMessage, getDb } from './db';
import { messages } from './db/schema';
import { notifyPush } from './push';
import type { PushPayload } from './push';
import { broadcast } from './realtime';
import type { Env, Message } from './types';
import { appName, nonEmpty } from './utils';

// More returned mails than this get one summary notification on top of the individual ones.
const MAX_INDIVIDUAL_NOTIFICATIONS = 3;

/**
 * Moves every snoozed mail whose time has come back to the inbox, unread, and returns those mails. It is a single
 * UPDATE ... RETURNING, so cron runs that overlap cannot release (or notify about) the same mail twice. The mail keeps
 * its original date: it returns in place.
 */
export function releaseSnoozed(env: Env): Promise<Message[]> {
  const now = Date.now();
  return getDb(env.DB)
    .update(messages)
    .set({ folder: 'inbox', snoozed_until: null, is_read: 0, updated_at: now })
    .where(and(eq(messages.folder, 'snoozed'), isNotNull(messages.snoozed_until), lte(messages.snoozed_until, now)))
    .returning();
}

/** Cron entry point: releaseSnoozed + realtime broadcast + push for the returned mails. Never throws. */
export async function returnSnoozedMail(env: Env): Promise<void> {
  try {
    const returned = await releaseSnoozed(env);
    if (returned.length === 0) {
      return;
    }
    // Counts only: mail content and addresses stay out of the logs.
    console.log(`[edging-mail] snooze: ${returned.length} snoozed message(s) returned to the inbox`);

    const notices: PushPayload[] = returned
      .toSorted((a, b) => b.created_at - a.created_at)
      .slice(0, MAX_INDIVIDUAL_NOTIFICATIONS)
      .map((message) => ({
        title: nonEmpty(message.from_name) ?? message.from_address,
        body: nonEmpty(message.subject) ?? nonEmpty(message.snippet) ?? '',
        tag: message.id,
        url: `/?m=${message.id}`
      }));
    if (returned.length > MAX_INDIVIDUAL_NOTIFICATIONS) {
      notices.push({ title: appName(env), body: `${returned.length} snoozed messages are back`, tag: 'snooze', url: '/' });
    }
    // broadcast and notifyPush never throw.
    await Promise.all([broadcast(env, { type: 'mail.changed' }), ...notices.map((notice) => notifyPush(env, notice))]);
  } catch (error) {
    console.error('[edging-mail] snooze: could not return snoozed mail:', errorMessage(error));
  }
}
