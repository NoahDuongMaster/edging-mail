import { waitUntil } from 'cloudflare:workers';
import type { Env, Message } from './types';
import { broadcast } from './realtime';
import { notifyPush } from './push';
import { nonEmpty } from './utils';

/** Called once for every stored inbound mail; never throws (inbound delivery must not fail because of it). */
export async function notifyNewMail(env: Env, message: Message): Promise<void> {
  if (message.folder !== 'inbox') {
    return;
  }

  // Push services can be slow, so the push keeps running after the inbound handler returns (waitUntil) instead of
  // delaying it. The WebSocket broadcast goes to our own Durable Object and is awaited, so open tabs update at once.
  waitUntil(
    notifyPush(env, {
      title: nonEmpty(message.from_name) ?? message.from_address,
      body: nonEmpty(message.subject) ?? nonEmpty(message.snippet) ?? '',
      tag: message.id,
      url: `/?m=${message.id}`
    })
  );
  await broadcast(env, {
    type: 'mail.new',
    id: message.id,
    folder: message.folder,
    from_name: message.from_name,
    from_address: message.from_address,
    subject: message.subject ?? '',
    snippet: message.snippet ?? '',
    created_at: message.created_at
  });
}
