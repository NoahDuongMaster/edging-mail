import { waitUntil } from 'cloudflare:workers';
import type { Env, Message } from './types';
import { broadcast } from './realtime';
import { notifyPush } from './push';
import { nonEmpty } from './utils';

/**
 * Called once for every stored inbound mail; never throws (inbound delivery must not fail because of it). Tells the mail's owner and
 * nobody else: their open tabs and their subscribed devices. Mail without an owner (it arrived before Setup) notifies no one.
 *
 * Mail the spam filter put in Spam sends no push and no `mail.new` (which names the sender): open tabs only get `mail.changed`, which says nothing about the
 * mail and makes the client refetch its lists and folder counts, so the Spam folder and its count stay fresh without a sound or a banner.
 */
export async function notifyNewMail(env: Env, message: Message): Promise<void> {
  if (message.user_id === null) {
    return;
  }
  const userId = message.user_id;
  if (message.folder === 'spam') {
    await broadcast(env, userId, { type: 'mail.changed' });
    return;
  }
  if (message.folder !== 'inbox') {
    return;
  }

  // Push services can be slow, so the push keeps running after the inbound handler returns (waitUntil) instead of
  // delaying it. The WebSocket broadcast goes to the owner's own Durable Object and is awaited, so open tabs update at once.
  waitUntil(
    notifyPush(env, userId, {
      title: nonEmpty(message.from_name) ?? message.from_address,
      body: '',
      tag: message.id,
      url: `/app?m=${message.id}`
    })
  );
  await broadcast(env, userId, {
    type: 'mail.new',
    id: message.id,
    folder: message.folder,
    from_name: message.from_name,
    from_address: message.from_address,
    created_at: message.created_at
  });
}
