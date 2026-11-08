import PostalMime from 'postal-mime';
import { and, eq, isNull } from 'drizzle-orm';
import type { Env, Message, Attachment } from '../types';
import { deleteBlobs, putBlob } from '../content';
import { getDb, runBatch } from '../db';
import type { Db } from '../db';
import { attachments, messages } from '../db/schema';
import { sealMessage } from '../mail/seal';
import type { Recipient } from '../mail/seal';
import { errorClass, nonEmpty } from '../utils';
import { notifyNewMail } from '../notify';

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_REFERENCES_LENGTH = 4000;

/** The steps of receiving one mail, in order. Fixed words: the failure log line carries one of them and nothing else about the mail. */
export type Stage = 'resolve' | 'parse' | 'seal' | 'store-object' | 'store-row';

/**
 * Runs one step of storing a mail. inbound.ts supplies it: it remembers the step for the failure log line and repeats the steps that are safe to
 * repeat. The row id, the attachment ids and the sealed content are all fixed before the first step, so a repeated step writes what the first one would have.
 */
export type RunStage = <T>(stage: Stage, run: () => Promise<T>) => Promise<T>;

// Is the message row in D1? undefined when D1 cannot answer right now.
async function rowExists(db: Db, id: string): Promise<boolean | undefined> {
  try {
    return (await db.select({ id: messages.id }).from(messages).where(eq(messages.id, id)).get()) !== undefined;
  } catch {
    return undefined;
  }
}

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
  // `ownerId` is the user the mail is for (resolved from the envelope recipient before anything is parsed), or null while no user
  // exists yet: such mail is kept and Setup hands it to the admin. `recipient` says who can open the content key: the owner's public key,
  // or the server (DATA_KEY) while the owner has no key yet. Plaintext is never stored: everything leaves here as blobs.
  // `run` is how each step is run (see RunStage): it names the step for the log, and repeats the ones that may be repeated.
  options: { envelopeFrom: string; envelopeTo: string; ownerId: string | null; recipient: Recipient; run: RunStage }
): Promise<{ message: Message; attachments: Attachment[] }> {
  const { run } = options;
  // Convert stream to ArrayBuffer if needed, then parse
  const { rawBuffer, parsed } = await run('parse', async () => {
    const buffer = rawStream instanceof ArrayBuffer ? rawStream : await new Response(rawStream).arrayBuffer();
    return { rawBuffer: buffer, parsed: await new PostalMime().parse(buffer) };
  });

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

  const db = getDb(env.DB);
  const attachmentList = parsed.attachments.map((att) => ({
    id: crypto.randomUUID(),
    filename: nonEmpty(att.filename) ?? 'attachment',
    mime_type: att.mimeType || 'application/octet-stream',
    content_id: nonEmpty(att.contentId) ?? null,
    is_inline: att.disposition === 'inline' ? 1 : 0,
    bytes: typeof att.content === 'string' ? new TextEncoder().encode(att.content) : new Uint8Array(att.content)
  }));
  const sealed = await run('seal', () =>
    sealMessage(
      options.recipient,
      options.ownerId,
      id,
      { subject, snippet, text: text ?? null, html: html ?? null },
      new Uint8Array(rawBuffer),
      attachmentList
    )
  );

  // A reply joins the thread of the owner's stored mail it answers, so a reply to a reply stays in the root thread. A read, done first: if it fails,
  // nothing has been written yet.
  const inReplyTo = nonEmpty(parsed.inReplyTo);
  const ownMail = options.ownerId === null ? isNull(messages.user_id) : eq(messages.user_id, options.ownerId);
  const parent =
    inReplyTo === undefined
      ? undefined
      : await run('store-row', () =>
          db
            .select({ thread_id: messages.thread_id })
            .from(messages)
            .where(and(eq(messages.message_id, inReplyTo), ownMail))
            .get()
        );

  // The objects first, then the rows: a row never points at an object that was not written. A raw mail that cannot be stored is not fatal
  // (the mail is still readable); an attachment that cannot be stored is, and the mail is then rejected rather than stored without it.
  const written: string[] = [];
  let rawKey = sealed.columns.r2_key;
  try {
    await run('store-object', async () => {
      for (const object of sealed.objects) {
        const isRaw = object.key === sealed.columns.r2_key;
        try {
          await putBlob(env, object.key, object.body);
          written.push(object.key);
        } catch (error) {
          console.error('[edging-mail] Could not store an object in R2 (message', id, `): ${errorClass(error)}`);
          if (!isRaw) {
            throw error;
          }
          rawKey = null;
        }
      }
    });
  } catch (error) {
    await deleteBlobs(env, written);
    throw error;
  }

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
    ...sealed.columns,
    r2_key: rawKey,
    folder: 'inbox',
    is_read: 0,
    is_starred: 0,
    has_attachments: attachmentList.length > 0 ? 1 : 0,
    size: rawBuffer.byteLength,
    created_at: sentTime(parsed.date, now),
    updated_at: now,
    references_header: clipReferences(parsed.references),
    in_reply_to: inReplyTo ?? null,
    user_id: options.ownerId,
    // Arrived by email: nothing checks its From address (PX-12).
    origin: 'smtp'
  };

  // The row and its attachment rows in one transaction. Filename, type and content id are inside the encrypted meta blob: the columns stay empty.
  const attachmentsList: Attachment[] = attachmentList.map((att, index) => ({
    id: att.id,
    message_id: id,
    filename: '',
    mime_type: '',
    size: att.bytes.byteLength,
    r2_key: sealed.attachments[index]?.r2_key ?? '',
    content_id: null,
    is_inline: att.is_inline,
    created_at: now,
    meta_blob: sealed.attachments[index]?.meta_blob ?? null
  }));
  // `run` may repeat this step. The row id and the object keys are the ones fixed above, so every attempt is the same insert, and an attempt whose
  // answer was lost after D1 committed it finds its own row and counts as done. When the row cannot be stored in the end the objects go again,
  // but only if the row is known not to be there: deleting the objects of a row that may exist would leave a mail that cannot be opened.
  const row = { knownAbsent: true };
  try {
    await run('store-row', async () => {
      try {
        await runBatch(db, [
          db.insert(messages).values(messageRecord),
          ...attachmentsList.map((record) => db.insert(attachments).values(record))
        ]);
      } catch (error) {
        const stored = await rowExists(db, id);
        if (stored === true) {
          return;
        }
        row.knownAbsent = stored === false;
        throw error;
      }
    });
  } catch (error) {
    if (row.knownAbsent) {
      await deleteBlobs(env, written);
    }
    throw error;
  }

  // The mail is stored: a failing notification must not make inbound delivery fail.
  try {
    await notifyNewMail(env, messageRecord);
  } catch (error) {
    console.error('Failed to send new-mail notifications:', errorClass(error));
  }

  return { message: messageRecord, attachments: attachmentsList };
}
