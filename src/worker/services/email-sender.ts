import { createMimeMessage } from 'mimetext';
import type { Env, Message, SendEmailPayload } from '../types';

export async function sendEmail(
  payload: SendEmailPayload,
  env: Env
): Promise<{ success: boolean; message: Message; note?: string }> {
  const id = crypto.randomUUID();
  const now = Date.now();

  const recipients = Array.isArray(payload.to) ? payload.to : [payload.to];
  const ccList = payload.cc ? (Array.isArray(payload.cc) ? payload.cc : [payload.cc]) : [];
  const bccList = payload.bcc ? (Array.isArray(payload.bcc) ? payload.bcc : [payload.bcc]) : [];

  const toStr = recipients.join(', ');
  const ccStr = ccList.length > 0 ? ccList.join(', ') : null;
  const bccStr = bccList.length > 0 ? bccList.join(', ') : null;

  // Build RFC 5322 MIME message
  const msg = createMimeMessage();
  msg.setSender(payload.from);
  for (const rcpt of recipients) {
    msg.setRecipient(rcpt);
  }
  for (const cc of ccList) {
    msg.setCc(cc);
  }
  for (const bcc of bccList) {
    msg.setBcc(bcc);
  }
  if (payload.reply_to) {
    msg.setHeader('Reply-To', payload.reply_to);
  }
  msg.setSubject(payload.subject || '(No Subject)');

  if (payload.text) {
    msg.addMessage({ contentType: 'text/plain', data: payload.text });
  }
  if (payload.html) {
    msg.addMessage({ contentType: 'text/html', data: payload.html });
  }

  if (payload.attachments && payload.attachments.length > 0) {
    for (const att of payload.attachments) {
      msg.addAttachment({
        filename: att.filename,
        contentType: att.content_type,
        data: att.content_base64
      });
    }
  }

  const rawMime = msg.asRaw();
  const rawBuffer = new TextEncoder().encode(rawMime);
  const rawKey = `sent/${id}.eml`;

  // Store raw EML in R2
  if (env.BUCKET) {
    try {
      await env.BUCKET.put(rawKey, rawBuffer, {
        httpMetadata: { contentType: 'message/rfc822' },
        customMetadata: { from: payload.from, to: toStr, subject: payload.subject }
      });
    } catch (e) {
      console.error('Failed to store sent email in R2:', e);
    }
  }

  let sendNote: string | undefined;

  // Dispatch email
  if (env.SEND_EMAIL && typeof env.SEND_EMAIL.send === 'function') {
    try {
      // Cloudflare Send Email binding
      for (const rcpt of recipients) {
        // @ts-ignore Cloudflare dynamic EmailMessage
        const { EmailMessage } = await import('cloudflare:email');
        const emailMsg = new EmailMessage(payload.from, rcpt, rawMime);
        await env.SEND_EMAIL.send(emailMsg);
      }
      sendNote = 'Sent via Cloudflare Workers send_email binding';
    } catch (err: any) {
      console.warn('Cloudflare SEND_EMAIL binding failed, saved as sent locally:', err?.message || err);
      sendNote = `Cloudflare send_email notice: ${err?.message || 'Local simulation'}`;
    }
  } else {
    sendNote = 'Simulated delivery: No Cloudflare SEND_EMAIL binding configured. Saved to Sent.';
  }

  const snippet = (payload.text || payload.html?.replace(/<[^>]+>/g, ' ') || '').trim().slice(0, 180);

  const messageRecord: Message = {
    id,
    message_id: `<${id}@${payload.from.split('@')[1] || 'edging-mail'}>`,
    thread_id: id,
    from_address: payload.from,
    from_name: null,
    to_address: toStr,
    cc: ccStr,
    bcc: bccStr,
    reply_to: payload.reply_to || null,
    subject: payload.subject || '(No Subject)',
    snippet,
    body_text: payload.text || null,
    body_html: payload.html || null,
    r2_key: rawKey,
    folder: 'sent',
    is_read: 1,
    is_starred: 0,
    has_attachments: payload.attachments && payload.attachments.length > 0 ? 1 : 0,
    size: rawBuffer.byteLength,
    created_at: now,
    updated_at: now
  };

  // Store in D1 messages table under 'sent' folder
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

  return { success: true, message: messageRecord, note: sendNote };
}
