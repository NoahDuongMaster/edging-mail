import { and, eq, isNotNull, lte } from 'drizzle-orm';
import { getDb } from './db';
import { messages } from './db/schema';
import { notifyPush } from './push';
import type { PushPayload } from './push';
import { broadcast } from './realtime';
import type { Env, Message } from './types';
import { appName, errorClass, nonEmpty } from './utils';

// More returned mails than this get one summary notification on top of the individual ones.
const MAX_INDIVIDUAL_NOTIFICATIONS = 3;

/**
 * Moves every snoozed mail whose time has come back to the inbox, unread, and returns those mails. It is a single
 * UPDATE ... RETURNING, so cron runs that overlap cannot release (or notify about) the same mail twice. The mail keeps
 * its original date: it returns in place. Every owner's mail is released in the same pass; mail without an owner (snoozed before
 * Setup) returns to the inbox too, and Setup hands it over later without a notification.
 */
export function releaseSnoozed(env: Env): Promise<Message[]> {
  const now = Date.now();
  return getDb(env.DB)
    .update(messages)
    .set({ folder: 'inbox', snoozed_until: null, is_read: 0, updated_at: now })
    .where(and(eq(messages.folder, 'snoozed'), isNotNull(messages.snoozed_until), lte(messages.snoozed_until, now)))
    .returning();
}

// One person's returned mails: the notifications and the realtime event go to them and to nobody else.
async function tellOwner(env: Env, userId: string, returned: Message[]): Promise<void> {
  const notices: PushPayload[] = returned
    .toSorted((a, b) => b.created_at - a.created_at)
    .slice(0, MAX_INDIVIDUAL_NOTIFICATIONS)
    .map((message) => ({
      title: nonEmpty(message.from_name) ?? message.from_address,
      body: '',
      tag: message.id,
      url: `/app?m=${message.id}`
    }));
  if (returned.length > MAX_INDIVIDUAL_NOTIFICATIONS) {
    notices.push({ title: appName(env), body: `${returned.length} snoozed messages are back`, tag: 'snooze', url: '/app' });
  }
  // broadcast and notifyPush never throw.
  await Promise.all([broadcast(env, userId, { type: 'mail.changed' }), ...notices.map((notice) => notifyPush(env, userId, notice))]);
}

/** Cron entry point: releaseSnoozed + realtime broadcast + push to each owner for their own returned mails. Never throws. */
export async function returnSnoozedMail(env: Env): Promise<void> {
  try {
    const returned = await releaseSnoozed(env);
    if (returned.length === 0) {
      return;
    }
    // Counts only: mail content and addresses stay out of the logs.
    console.log(`[edging-mail] snooze: ${returned.length} snoozed message(s) returned to the inbox`);

    const byOwner = Map.groupBy(
      returned.filter((message): message is Message & { user_id: string } => message.user_id !== null),
      (message) => message.user_id
    );
    await Promise.all([...byOwner].map(([userId, mails]) => tellOwner(env, userId, mails)));
  } catch (error) {
    console.error('[edging-mail] snooze: could not return snoozed mail:', errorClass(error));
  }
}
