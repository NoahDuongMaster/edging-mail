import PostalMime from 'postal-mime';
import { eq } from 'drizzle-orm';
import type { Env, Message, Attachment } from '../types';
import { getDb } from '../db';
import { attachments, messages } from '../db/schema';
import { attachmentKey, nonEmpty } from '../utils';
import { notifyNewMail } from '../notify';

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_REFERENCES_LENGTH = 4000;

// The Date header is the sender's claim: a missing or unparsable one counts as "now", and so does one more than a few
// minutes ahead, which would pin the mail to the top of the list.
function sentTime(date: string | undefined, now: number): number {
  const time = new Date(date ?? '').getTime();
  return Number.isNaN(time) || time > now + MAX_CLOCK_SKEW_MS ? now : time;
}

// Kept whole when it fits; a longer chain is cut after its last complete id.
function clipReferences(value: string | undefined): string | null {
  const references = nonEmpty(value?.replaceAll(/\s+/g, ' ').trim());
  if (references === undefined) {
    return null;
  }
  return references.length <= MAX_REFERENCES_LENGTH ? references : references.slice(0, MAX_REFERENCES_LENGTH).replace(/ \S*$/, '');
}

export async function parseAndStoreEmail(
  rawStream: ReadableStream<Uint8Array> | ArrayBuffer,
  env: Env,
  options: { envelopeFrom: string; envelopeTo: string }
): Promise<{ message: Message; attachments: Attachment[] }> {
  // Convert stream to ArrayBuffer if needed
  let rawBuffer: ArrayBuffer;
  if (rawStream instanceof ArrayBuffer) {
    rawBuffer = rawStream;
  } else {
    const response = new Response(rawStream);
    rawBuffer = await response.arrayBuffer();
  }

  const parser = new PostalMime();
  const parsed = await parser.parse(rawBuffer);

  const id = crypto.randomUUID();
  const now = Date.now();
  const text = nonEmpty(parsed.text);
  const html = nonEmpty(parsed.html);
  const fromAddr = nonEmpty(parsed.from?.address) ?? options.envelopeFrom;
  const fromName = nonEmpty(parsed.from?.name) ?? null;
  const toAddr = nonEmpty(parsed.to?.map((t) => t.address).join(', ')) ?? options.envelopeTo;
  const ccAddr = nonEmpty(parsed.cc?.map((c) => c.address).join(', ')) ?? null;
  const bccAddr = nonEmpty(parsed.bcc?.map((b) => b.address).join(', ')) ?? null;
  const subject = nonEmpty(parsed.subject) ?? '(No Subject)';

  // Extract clean text snippet
  let snippet = '';
  if (text !== undefined) {
    snippet = text.trim().replaceAll(/\s+/g, ' ').slice(0, 180);
  } else if (html !== undefined) {
    snippet = html
      .replaceAll(/<[^>]+>/g, ' ')
      .trim()
      .replaceAll(/\s+/g, ' ')
      .slice(0, 180);
  }

  // Store raw EML in Cloudflare R2. Header values are attacker-controlled and R2 caps custom metadata at 2 KB, so
  // the subject stays out and from/to are clipped. r2_key is only kept when the object really exists.
  let rawKey: string | null = `raw/${id}.eml`;
  try {
    await env.BUCKET.put(rawKey, rawBuffer, {
      httpMetadata: { contentType: 'message/rfc822' },
      customMetadata: { from: fromAddr.slice(0, 256), to: toAddr.slice(0, 256) }
    });
  } catch (error) {
    console.error('Failed to store raw EML in R2:', error);
    rawKey = null;
  }

  const db = getDb(env.DB);

  // A reply joins the thread of the stored mail it answers, so a reply to a reply stays in the root thread.
  const inReplyTo = nonEmpty(parsed.inReplyTo);
  const parent =
    inReplyTo === undefined
      ? undefined
      : await db.select({ thread_id: messages.thread_id }).from(messages).where(eq(messages.message_id, inReplyTo)).get();

  const messageRecord: Message = {
    id,
    message_id: nonEmpty(parsed.messageId) ?? null,
    thread_id: nonEmpty(parent?.thread_id) ?? inReplyTo ?? nonEmpty(parsed.messageId) ?? id,
    from_address: fromAddr,
    from_name: fromName,
    to_address: toAddr,
    cc: ccAddr,
    bcc: bccAddr,
    reply_to: nonEmpty(parsed.replyTo?.[0]?.address) ?? null,
    subject,
    snippet,
    body_text: text ?? null,
    body_html: html ?? null,
    r2_key: rawKey,
    folder: 'inbox',
    is_read: 0,
    is_starred: 0,
    has_attachments: parsed.attachments.length > 0 ? 1 : 0,
    size: rawBuffer.byteLength,
    created_at: sentTime(parsed.date, now),
    updated_at: now,
    references_header: clipReferences(parsed.references),
    in_reply_to: inReplyTo ?? null
  };

  // Store message in D1
  await db.insert(messages).values(messageRecord);

  // Process attachments
  const attachmentsList: Attachment[] = [];
  if (parsed.attachments.length > 0) {
    for (const att of parsed.attachments) {
      const attId = crypto.randomUUID();
      const attKey = attachmentKey(id, attId, att.filename);

      try {
        await env.BUCKET.put(attKey, att.content, {
          httpMetadata: { contentType: att.mimeType || 'application/octet-stream' }
        });
      } catch (error) {
        console.error(`Failed to store attachment ${String(att.filename)} to R2:`, error);
      }

      const contentSize = typeof att.content === 'string' ? new TextEncoder().encode(att.content).byteLength : att.content.byteLength || 0;

      const attachmentRecord: Attachment = {
        id: attId,
        message_id: id,
        filename: nonEmpty(att.filename) ?? 'attachment',
        mime_type: att.mimeType || 'application/octet-stream',
        size: contentSize,
        r2_key: attKey,
        content_id: nonEmpty(att.contentId) ?? null,
        is_inline: att.disposition === 'inline' ? 1 : 0,
        created_at: now
      };

      await db.insert(attachments).values(attachmentRecord);

      attachmentsList.push(attachmentRecord);
    }
  }

  // The mail is stored: a failing notification must not make inbound delivery fail.
  try {
    await notifyNewMail(env, messageRecord);
  } catch (error) {
    console.error('Failed to send new-mail notifications:', error);
  }

  return { message: messageRecord, attachments: attachmentsList };
}
