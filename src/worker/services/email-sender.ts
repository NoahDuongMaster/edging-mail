import { createMimeMessage, Mailbox, MIMETextError } from 'mimetext';
import { and, eq } from 'drizzle-orm';
import type { Attachment, Env, Message, SendEmailPayload } from '../types';
import { deleteBlobs, putBlob } from '../content';
import { errorMessage, getDb } from '../db';
import { attachments, messages } from '../db/schema';
import { sealMessage } from '../mail/seal';
import type { Recipient } from '../mail/seal';
import { errorClass, isEmail, nonEmpty } from '../utils';

/** The mail was not sent: 400 = bad request, 502 = Cloudflare Email Service is missing or refused it. */
export class SendError extends Error {
  status: 400 | 502;

  constructor(message: string, status: 400 | 502) {
    super(message);
    this.name = 'SendError';
    this.status = status;
  }
}

const toList = (value: string | string[] | undefined): string[] =>
  (Array.isArray(value) ? value : [value]).map((address) => address?.trim() ?? '').filter((address) => address !== '');

const byteLength = (value: string): number => new TextEncoder().encode(value).byteLength;

// At most 998 bytes (RFC 5322 line limit), so that the first and the last id of a References header always fit in 2048 bytes.
export const isMessageId = (value: string): boolean => /^<[^<>\s]+>$/.test(value) && byteLength(value) <= 998;

export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const MAX_REFERENCES_BYTES = 2048;

// The ids of a stored References header, oldest first; anything else in it is ignored.
export const parseReferences = (header: string | null | undefined): string[] => (header?.match(/<[^<>\s]+>/g) ?? []).filter(isMessageId);

// The answered mail's chain plus the answered mail, oldest first and without duplicates. When it does not fit in the
// header, the oldest ids go first, except the root (first) and the answered mail (last).
export function buildReferences(known: string[], inReplyTo: string | undefined): string[] {
  const ids = [...new Set(known.filter((id) => id !== inReplyTo)), ...(inReplyTo === undefined ? [] : [inReplyTo])];
  if (ids.length === 0) {
    return [];
  }
  const [root, ...rest] = ids;
  let size = byteLength(root);
  const newest: string[] = [];
  for (const id of rest.toReversed()) {
    size += 1 + byteLength(id);
    if (size > MAX_REFERENCES_BYTES) {
      break;
    }
    newest.push(id);
  }
  return [root, ...newest.toReversed()];
}

function decodeBase64(attachment: { filename: string; content_base64: string }): Uint8Array<ArrayBuffer> {
  try {
    return Uint8Array.from(atob(attachment.content_base64), (char) => char.codePointAt(0) ?? 0);
  } catch {
    throw new SendError(`Attachment ${attachment.filename} is not valid base64`, 400);
  }
}

const hasLineBreak = (value: string): boolean => /[\r\n]/.test(value);

// Cloudflare Email Service limits (docs/mail-features.md): enforced by Cloudflare too, checked here so nothing oversized is built.
const MAX_ATTACHMENTS = 32;
const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;

// Hands the message to Cloudflare Email Service (send_email binding); anything but a clean acceptance is an error.
async function deliver(env: Env, builder: EmailMessageBuilder): Promise<string> {
  if (env.SEND_EMAIL === undefined) {
    throw new SendError('Email sending is not configured: the SEND_EMAIL binding is missing', 502);
  }
  try {
    const { messageId } = await env.SEND_EMAIL.send(builder);
    return messageId;
  } catch (error) {
    console.error('[edging-mail] Email delivery failed:', errorClass(error));
    const reason = error instanceof Error ? nonEmpty(error.message) : undefined;
    const code = error instanceof Error && 'code' in error && typeof error.code === 'string' ? ` [${error.code}]` : '';
    throw new SendError(`Email delivery failed: ${reason ?? 'unknown error'}${code}`, 502);
  }
}

export async function sendEmail(
  payload: SendEmailPayload,
  env: Env,
  sender: { address: string; name: string | null },
  userId: string,
  // The sender's own key: the copy in Sent is sealed to it like every other mail the sender holds.
  recipient: Recipient
): Promise<{ success: boolean; message: Message; note: string }> {
  const id = crypto.randomUUID();
  const now = Date.now();

  const recipients = toList(payload.to);
  const ccList = toList(payload.cc);
  const bccList = toList(payload.bcc);
  if (recipients.length === 0) {
    throw new SendError('At least one recipient is required', 400);
  }
  const draftId = payload.draft_id;
  if (draftId !== undefined && !(typeof draftId === 'string' && UUID_PATTERN.test(draftId))) {
    throw new SendError('draft_id must be a UUID', 400);
  }
  const replyTo = nonEmpty(payload.reply_to?.trim());
  const invalid = [sender.address, ...recipients, ...ccList, ...bccList, ...(replyTo === undefined ? [] : [replyTo])].find(
    (address) => !isEmail(address)
  );
  if (invalid !== undefined) {
    throw new SendError(`Invalid email address: ${invalid}`, 400);
  }

  const inReplyTo = nonEmpty(payload.in_reply_to?.trim());
  const references = payload.references ?? [];
  if ((inReplyTo !== undefined && !isMessageId(inReplyTo)) || !Array.isArray(references) || !references.every(isMessageId)) {
    throw new SendError('in_reply_to and references must be Message-IDs in angle brackets', 400);
  }

  const db = getDb(env.DB);
  // The mail being answered, among the sender's own mail: another user's thread is neither read nor joined.
  const parent =
    inReplyTo === undefined
      ? undefined
      : await db
          .select({ thread_id: messages.thread_id, references_header: messages.references_header })
          .from(messages)
          .where(and(eq(messages.message_id, inReplyTo), eq(messages.user_id, userId)))
          .get();
  // The chain stored with the answered mail is the truth; the client's list only stands in when the mail is unknown.
  const knownChain = parseReferences(parent?.references_header);
  const chain = buildReferences(knownChain.length > 0 ? knownChain : references, inReplyTo);
  const referencesHeader = chain.length > 0 ? chain.join(' ') : undefined;

  const text = nonEmpty(payload.text);
  const html = nonEmpty(payload.html);
  const subject = payload.subject || '(No Subject)';
  const attachmentList = payload.attachments ?? [];

  // Header values go to Cloudflare's builder and into the archive copy as they are: no line breaks (header injection).
  // reply_to and the addresses are covered by isEmail, which excludes whitespace.
  const headerValues = [subject, sender.name ?? '', ...attachmentList.flatMap((att) => [att.filename, att.content_type])];
  if (headerValues.some(hasLineBreak)) {
    throw new SendError('Subject, sender name and attachment filenames or types must not contain line breaks', 400);
  }
  if (attachmentList.length > MAX_ATTACHMENTS) {
    throw new SendError(`At most ${MAX_ATTACHMENTS} attachments are allowed`, 400);
  }
  // Attachments arrive base64-encoded, so string lengths approximate the size of the MIME message.
  const approxBytes = attachmentList.reduce((total, att) => total + att.content_base64.length, (text?.length ?? 0) + (html?.length ?? 0));
  if (approxBytes > MAX_MESSAGE_BYTES) {
    throw new SendError('The message is larger than 25 MiB', 400);
  }
  // Decoded before delivery: a bad attachment is a 400, and nothing can fail on it once the mail is out.
  const files = attachmentList.map((att) => ({ att, bytes: decodeBase64(att) }));

  // Archive copy of what is handed over (the platform adds Date, Message-ID and the DKIM signature itself). It is built
  // before delivery so that nothing here can fail once the mail is out; Cloudflare's Message-ID replaces the placeholder.
  const pendingMessageId = `<${id}@pending.invalid>`;
  let archive: string;
  try {
    const msg = createMimeMessage();
    msg.setSender(sender.name === null ? sender.address : { name: sender.name, addr: sender.address });
    msg.setHeader('Message-ID', pendingMessageId);
    msg.setTo(recipients);
    if (ccList.length > 0) {
      msg.setCc(ccList);
    }
    if (bccList.length > 0) {
      msg.setBcc(bccList);
    }
    if (replyTo !== undefined) {
      msg.setHeader('Reply-To', new Mailbox({ addr: replyTo }));
    }
    if (inReplyTo !== undefined) {
      msg.setHeader('In-Reply-To', inReplyTo);
    }
    if (referencesHeader !== undefined) {
      msg.setHeader('References', referencesHeader);
    }
    msg.setSubject(subject);
    if (text !== undefined) {
      msg.addMessage({ contentType: 'text/plain', data: text });
    }
    if (html !== undefined) {
      msg.addMessage({ contentType: 'text/html', data: html });
    }
    for (const att of attachmentList) {
      msg.addAttachment({
        filename: att.filename,
        contentType: att.content_type,
        data: att.content_base64
      });
    }
    archive = msg.asRaw();
  } catch (error) {
    if (error instanceof MIMETextError) {
      throw new SendError(`Invalid message: ${error.message}`, 400);
    }
    throw error;
  }

  const returnedId = await deliver(env, {
    from: sender.name === null ? sender.address : { name: sender.name, email: sender.address },
    to: recipients,
    cc: ccList.length > 0 ? ccList : undefined,
    bcc: bccList.length > 0 ? bccList : undefined,
    replyTo,
    subject,
    text,
    html,
    headers:
      referencesHeader === undefined
        ? undefined
        : { ...(inReplyTo === undefined ? {} : { 'In-Reply-To': inReplyTo }), References: referencesHeader },
    attachments: attachmentList.map((att) => ({
      disposition: 'attachment',
      filename: att.filename,
      type: att.content_type,
      content: att.content_base64
    }))
  });

  // Cloudflare assigns the Message-ID: keep it, a recipient's reply will point to it.
  const messageId = `<${returnedId.replaceAll(/^<|>$/g, '')}>`;

  const rawBuffer = new TextEncoder().encode(archive.replace(pendingMessageId, () => messageId));
  const toStr = recipients.join(', ');
  const snippet = (text ?? html?.replaceAll(/<[^>]+>/g, ' ') ?? '').trim().slice(0, 180);

  // The copy in Sent is sealed to the sender's key: plaintext is never stored. Objects first, then the rows in one batch.
  const attachmentContents = files.map(({ att, bytes }) => ({
    id: crypto.randomUUID(),
    filename: nonEmpty(att.filename) ?? 'attachment',
    mime_type: nonEmpty(att.content_type) ?? 'application/octet-stream',
    content_id: null,
    bytes
  }));
  const sealed = await sealMessage(
    recipient,
    userId,
    id,
    { subject, snippet, text: text ?? null, html: html ?? null },
    rawBuffer,
    attachmentContents
  );
  const written: string[] = [];
  let rawKey = sealed.columns.r2_key;
  for (const object of sealed.objects) {
    try {
      await putBlob(env, object.key, object.body);
      written.push(object.key);
    } catch (error) {
      // The mail is already out: a part that cannot be kept is logged (ids and the error class only) and left out of Sent.
      console.error('[edging-mail] Could not store a sent object in R2 (message', id, `): ${errorClass(error)}`);
      if (object.key === rawKey) {
        rawKey = null;
      }
    }
  }
  const attachmentRecords: Attachment[] = sealed.attachments
    .filter((record) => written.includes(record.r2_key))
    .map((record) => ({
      id: record.id,
      message_id: id,
      filename: '',
      mime_type: '',
      size: attachmentContents.find((content) => content.id === record.id)?.bytes.byteLength ?? 0,
      r2_key: record.r2_key,
      content_id: null,
      is_inline: 0,
      created_at: now,
      meta_blob: record.meta_blob
    }));

  const messageRecord: Message = {
    id,
    message_id: messageId,
    // a reply joins the thread of the mail it answers; a new mail starts one, keyed like inbound mail (by its Message-ID)
    thread_id: nonEmpty(parent?.thread_id) ?? messageId,
    from_address: sender.address,
    from_name: sender.name,
    to_address: toStr,
    cc: ccList.length > 0 ? ccList.join(', ') : null,
    bcc: bccList.length > 0 ? bccList.join(', ') : null,
    reply_to: replyTo ?? null,
    ...sealed.columns,
    r2_key: rawKey,
    folder: 'sent',
    is_read: 1,
    is_starred: 0,
    has_attachments: attachmentRecords.length > 0 ? 1 : 0,
    size: rawBuffer.byteLength,
    created_at: now,
    updated_at: now,
    references_header: referencesHeader ?? null,
    in_reply_to: inReplyTo ?? null,
    user_id: userId
  };

  // Store in D1 messages table under 'sent' folder, with its attachment rows in the same batch
  try {
    await db.batch([
      db.insert(messages).values(messageRecord),
      ...attachmentRecords.map((record) => db.insert(attachments).values(record))
    ]);
  } catch (error) {
    await deleteBlobs(env, written);
    throw new Error(`The email was sent but could not be saved to Sent: ${errorMessage(error)}`, { cause: error });
  }

  // The draft this mail was written in is done: delete it, but only the sender's own drafts-folder row, never a real mail.
  if (draftId !== undefined) {
    try {
      await db.delete(messages).where(and(eq(messages.id, draftId), eq(messages.folder, 'drafts'), eq(messages.user_id, userId)));
    } catch (error) {
      console.error('[edging-mail] Could not delete the draft of a sent mail:', errorClass(error));
    }
  }

  return { success: true, message: messageRecord, note: 'Accepted by Cloudflare Email Service' };
}
