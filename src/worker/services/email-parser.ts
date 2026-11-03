import PostalMime from 'postal-mime';
import type { Env, Message, Attachment } from '../types';

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
  const fromAddr = parsed.from?.address || options.envelopeFrom;
  const fromName = parsed.from?.name || null;
  const toAddr = parsed.to?.map(t => t.address).join(', ') || options.envelopeTo;
  const ccAddr = parsed.cc?.map(c => c.address).join(', ') || null;
  const bccAddr = parsed.bcc?.map(b => b.address).join(', ') || null;
  const subject = parsed.subject || '(No Subject)';

  // Extract clean text snippet
  let snippet = '';
  if (parsed.text) {
    snippet = parsed.text.trim().replace(/\s+/g, ' ').slice(0, 180);
  } else if (parsed.html) {
    snippet = parsed.html.replace(/<[^>]+>/g, ' ').trim().replace(/\s+/g, ' ').slice(0, 180);
  }

  // Store raw EML in Cloudflare R2
  const rawKey = `raw/${id}.eml`;
  if (env.BUCKET) {
    try {
      await env.BUCKET.put(rawKey, rawBuffer, {
        httpMetadata: { contentType: 'message/rfc822' },
        customMetadata: { from: fromAddr, to: toAddr, subject }
      });
    } catch (err) {
      console.error('Failed to store raw EML in R2:', err);
    }
  }

  const messageRecord: Message = {
    id,
    message_id: parsed.messageId || null,
    thread_id: parsed.inReplyTo || parsed.messageId || id,
    from_address: fromAddr,
    from_name: fromName,
    to_address: toAddr,
    cc: ccAddr,
    bcc: bccAddr,
    reply_to: parsed.replyTo?.[0]?.address || null,
    subject,
    snippet,
    body_text: parsed.text || null,
    body_html: parsed.html || null,
    r2_key: rawKey,
    folder: 'inbox',
    is_read: 0,
    is_starred: 0,
    has_attachments: parsed.attachments && parsed.attachments.length > 0 ? 1 : 0,
    size: rawBuffer.byteLength,
    created_at: parsed.date ? new Date(parsed.date).getTime() : now,
    updated_at: now
  };

  // Store message in D1
  await env.DB.prepare(`
    INSERT INTO messages (
      id, message_id, thread_id, from_address, from_name, to_address, cc, bcc,
      reply_to, subject, snippet, body_text, body_html, r2_key, folder,
      is_read, is_starred, has_attachments, size, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    messageRecord.id,
    messageRecord.message_id,
    messageRecord.thread_id,
    messageRecord.from_address,
    messageRecord.from_name,
    messageRecord.to_address,
    messageRecord.cc,
    messageRecord.bcc,
    messageRecord.reply_to,
    messageRecord.subject,
    messageRecord.snippet,
    messageRecord.body_text,
    messageRecord.body_html,
    messageRecord.r2_key,
    messageRecord.folder,
    messageRecord.is_read,
    messageRecord.is_starred,
    messageRecord.has_attachments,
    messageRecord.size,
    messageRecord.created_at,
    messageRecord.updated_at
  ).run();

  // Process attachments
  const attachmentsList: Attachment[] = [];
  if (parsed.attachments && parsed.attachments.length > 0) {
    for (const att of parsed.attachments) {
      const attId = crypto.randomUUID();
      const safeFilename = (att.filename || 'attachment').replace(/[^a-zA-Z0-9._-]/g, '_');
      const attKey = `attachments/${id}/${attId}_${safeFilename}`;

      if (env.BUCKET) {
        try {
          await env.BUCKET.put(attKey, att.content, {
            httpMetadata: { contentType: att.mimeType || 'application/octet-stream' }
          });
        } catch (e) {
          console.error(`Failed to store attachment ${att.filename} to R2:`, e);
        }
      }

      const contentSize = typeof att.content === 'string'
        ? new TextEncoder().encode(att.content).byteLength
        : (att.content?.byteLength || 0);

      const attachmentRecord: Attachment = {
        id: attId,
        message_id: id,
        filename: att.filename || 'attachment',
        mime_type: att.mimeType || 'application/octet-stream',
        size: contentSize,
        r2_key: attKey,
        content_id: att.contentId || null,
        is_inline: att.disposition === 'inline' ? 1 : 0,
        created_at: now
      };

      await env.DB.prepare(`
        INSERT INTO attachments (
          id, message_id, filename, mime_type, size, r2_key, content_id, is_inline, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        attachmentRecord.id,
        attachmentRecord.message_id,
        attachmentRecord.filename,
        attachmentRecord.mime_type,
        attachmentRecord.size,
        attachmentRecord.r2_key,
        attachmentRecord.content_id,
        attachmentRecord.is_inline,
        attachmentRecord.created_at
      ).run();

      attachmentsList.push(attachmentRecord);
    }
  }

  return { message: messageRecord, attachments: attachmentsList };
}
