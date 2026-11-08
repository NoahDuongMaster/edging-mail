import { and, eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import type { Bytes } from '../../shared/crypto/server';
import { deleteBlobs, putBlob } from '../content';
import type { BatchQuery, Db } from '../db';
import { errorMessage, runBatch } from '../db';
import { attachments, messages, users } from '../db/schema';
import { buildReferences, parseReferences } from '../services/email-sender';
import type { Env } from '../types';
import { nonEmpty } from '../utils';
import type { PlainPart, SealedPart } from './internal-parts';
import { em1Key, sealMessage } from './seal';
import type { Recipient } from './seal';

// What `POST /api/messages/internal` writes: one row (and its attachment rows and R2 objects) per copy. Pure planning first, nothing is written
// until every copy of the message is planned; then the objects, then ONE batch. A row that is sealed to a person's key is inserted only while
// that key is still the person's current one (so a key change between the check and the write stores nothing for it), and an attachment row
// only while its message row exists; whether every row made it is checked afterwards, and a partial result is taken back.

export type MessageRow = typeof messages.$inferSelect;
type AttachmentRow = typeof attachments.$inferSelect;

export interface Planned {
  row: MessageRow;
  attachments: AttachmentRow[];
  objects: { key: string; body: Bytes }[];
  /** The key id the row is sealed to; null while it is held under DATA_KEY. */
  sealedTo: string | null;
}

/** What every copy of one message has in common. */
export interface Mail {
  messageId: string;
  from: string;
  fromName: string | null;
  to: string;
  cc: string | null;
  inReplyTo: string | null;
  now: number;
  /** No plaintext reached the server for any copy of this message. */
  e2e: boolean;
}

export interface Thread {
  threadId: string;
  references: string | null;
}

type SealedColumns = Pick<
  MessageRow,
  | 'enc_fmt'
  | 'key_id'
  | 'wrapped_cek'
  | 'wrap_kind'
  | 'summary_blob'
  | 'body_blob'
  | 'subject'
  | 'snippet'
  | 'body_text'
  | 'body_html'
  | 'r2_key'
>;

/** Thread and References for each person: the mail of THEIR own that is answered (same Message-ID), else a new thread. */
export async function threadsFor(db: Db, userIds: string[], mail: Mail, references: string[]): Promise<Map<string, Thread>> {
  const parents =
    mail.inReplyTo === null
      ? []
      : await db
          .select({ user_id: messages.user_id, thread_id: messages.thread_id, references_header: messages.references_header })
          .from(messages)
          .where(and(eq(messages.message_id, mail.inReplyTo), inArray(messages.user_id, userIds)));
  const inReplyTo = mail.inReplyTo ?? undefined;
  return new Map(
    userIds.map((userId) => {
      const parent = parents.find((candidate) => candidate.user_id === userId);
      const known = parseReferences(parent?.references_header);
      const chain = buildReferences(known.length > 0 ? known : references, inReplyTo);
      return [userId, { threadId: nonEmpty(parent?.thread_id) ?? mail.messageId, references: chain.length > 0 ? chain.join(' ') : null }];
    })
  );
}

function rowOf(
  mail: Mail,
  thread: Thread,
  ownerId: string,
  folder: 'sent' | 'inbox',
  bcc: string | null,
  id: string,
  columns: SealedColumns,
  size: number,
  hasAttachments: boolean
): MessageRow {
  return {
    id,
    message_id: mail.messageId,
    thread_id: thread.threadId,
    from_address: mail.from,
    from_name: mail.fromName,
    to_address: mail.to,
    cc: mail.cc,
    bcc,
    reply_to: null,
    ...columns,
    folder,
    labels: '[]',
    is_read: folder === 'sent' ? 1 : 0,
    is_starred: 0,
    has_attachments: hasAttachments ? 1 : 0,
    size,
    created_at: mail.now,
    updated_at: mail.now,
    references_header: thread.references,
    in_reply_to: mail.inReplyTo,
    snoozed_until: null,
    user_id: ownerId,
    is_e2e: mail.e2e ? 1 : 0,
    // Arrived through this deployment's own route: the From address is the signed-in author (PX-12).
    origin: 'internal'
  };
}

/** A copy the browser sealed: its blobs are stored as they came. */
export function planSealed(
  mail: Mail,
  thread: Thread,
  ownerId: string,
  folder: 'sent' | 'inbox',
  bcc: string | null,
  part: SealedPart
): Planned {
  // The object name carries a random part chosen by the server and kept in the attachment row, so two requests that use the same client ids (a
  // replay, a platform retry) never write the same R2 key, and a request that fails removes only its own objects (EC-1).
  const objects = part.attachments.map((attachment) => ({
    key: em1Key(ownerId, part.id, `att/${attachment.id}/${crypto.randomUUID()}`),
    body: attachment.bytes
  }));
  const columns: SealedColumns = {
    enc_fmt: 1,
    key_id: part.keyId,
    wrapped_cek: part.wrappedCek,
    wrap_kind: 'user',
    summary_blob: part.summaryBlob,
    body_blob: part.bodyBlob,
    subject: null,
    snippet: null,
    body_text: null,
    body_html: null,
    r2_key: null
  };
  return {
    row: rowOf(mail, thread, ownerId, folder, bcc, part.id, columns, part.bytes, part.attachments.length > 0),
    attachments: part.attachments.map((attachment, index) => ({
      id: attachment.id,
      message_id: part.id,
      filename: '',
      mime_type: '',
      size: attachment.size,
      r2_key: objects[index]?.key ?? '',
      content_id: null,
      is_inline: 0,
      created_at: mail.now,
      meta_blob: attachment.metaBlob
    })),
    objects,
    sealedTo: part.keyId
  };
}

/** A copy for a person without keys: the browser sent it in the clear (over TLS), so the server seals it itself, as it does for inbound mail. */
export async function planPlain(mail: Mail, thread: Thread, ownerId: string, recipient: Recipient, plain: PlainPart): Promise<Planned> {
  const id = crypto.randomUUID();
  const contents = plain.attachments.map((attachment) => ({
    id: crypto.randomUUID(),
    filename: attachment.filename,
    mime_type: attachment.mimeType,
    content_id: null,
    bytes: attachment.bytes
  }));
  const snippet = (plain.text ?? plain.html?.replaceAll(/<[^>]+>/g, ' ') ?? '').trim().slice(0, 180);
  const sealed = await sealMessage(
    recipient,
    ownerId,
    id,
    { subject: plain.subject, snippet, text: plain.text, html: plain.html },
    null,
    contents
  );
  const size =
    new TextEncoder().encode((plain.text ?? '') + (plain.html ?? '')).byteLength +
    contents.reduce((total, item) => total + item.bytes.byteLength, 0);
  return {
    row: rowOf(mail, thread, ownerId, 'inbox', null, id, sealed.columns, size, contents.length > 0),
    attachments: sealed.attachments.map((record) => ({
      id: record.id,
      message_id: id,
      filename: '',
      mime_type: '',
      size: contents.find((item) => item.id === record.id)?.bytes.byteLength ?? 0,
      r2_key: record.r2_key,
      content_id: null,
      is_inline: 0,
      created_at: mail.now,
      meta_blob: record.meta_blob
    })),
    objects: sealed.objects,
    sealedTo: recipient.kind === 'user' ? recipient.key.keyId : null
  };
}

const MESSAGE_COLUMNS = Object.keys(getTableColumns(messages));
const ATTACHMENT_COLUMNS = Object.keys(getTableColumns(attachments));

const valuesOf = (columns: string[], record: Record<string, unknown>) =>
  sql.join(
    columns.map((name) => sql`${record[name] ?? null}`),
    sql`, `
  );

/** Drizzle writes the column list itself (schema order), so the values only have to follow it. */
const insertRowIfKeyIs = (db: Db, row: MessageRow, keyId: string): BatchQuery =>
  db
    .insert(messages)
    .select(
      sql`SELECT ${valuesOf(MESSAGE_COLUMNS, row)} WHERE EXISTS (SELECT 1 FROM ${users} WHERE ${users.id} = ${row.user_id} AND ${users.key_id} = ${keyId})`
    );

const insertAttachmentIfStored = (db: Db, row: AttachmentRow): BatchQuery =>
  db
    .insert(attachments)
    .select(
      sql`SELECT ${valuesOf(ATTACHMENT_COLUMNS, row)} WHERE EXISTS (SELECT 1 FROM ${messages} WHERE ${messages.id} = ${row.message_id})`
    );

// R2 writes in small groups: fast enough, and never hundreds of requests in flight.
const R2_CONCURRENCY = 8;

/** A row or attachment id of this request was stored by another request in the meantime (the pre-check cannot see a request in flight). */
export class IdInUseError extends Error {
  constructor() {
    super('an id is already in use');
    this.name = 'IdInUseError';
  }
}

const isIdClash = (error: unknown): boolean => /UNIQUE constraint failed: (?:messages|attachments)\.id\b/.test(errorMessage(error));

/**
 * Writes the planned copies. `true`: every row is stored. `false`: a key changed in between, so a row was not written; everything of this message
 * has been taken back (rows and objects) and the caller answers `key_changed`. Any other failure removes the objects of THIS request and throws;
 * a primary-key clash with a request that won the race throws `IdInUseError` (the caller answers `id_in_use`).
 */
export async function storeCopies(env: Env, db: Db, planned: Planned[]): Promise<boolean> {
  const written: string[] = [];
  try {
    const objects = planned.flatMap((copy) => copy.objects);
    for (let start = 0; start < objects.length; start += R2_CONCURRENCY) {
      const group = objects.slice(start, start + R2_CONCURRENCY);
      // Every key that was written is remembered even when a sibling of its group failed, so the clean-up below leaves nothing behind.
      const results = await Promise.allSettled(group.map((object) => putBlob(env, object.key, object.body)));
      for (const [index, result] of results.entries()) {
        if (result.status === 'fulfilled') {
          written.push(group[index].key);
        }
      }
      const failure = results.find((result) => result.status === 'rejected');
      if (failure !== undefined) {
        throw failure.reason instanceof Error ? failure.reason : new Error('R2 write failed');
      }
    }
    await runBatch(db, [
      ...planned.map((copy) =>
        copy.sealedTo === null ? db.insert(messages).values(copy.row) : insertRowIfKeyIs(db, copy.row, copy.sealedTo)
      ),
      ...planned.flatMap((copy) => copy.attachments.map((row) => insertAttachmentIfStored(db, row)))
    ]);
  } catch (error) {
    await deleteBlobs(env, written);
    throw isIdClash(error) ? new IdInUseError() : error;
  }
  // The batch is committed: from here nothing may remove an object that a stored row points to, except the take-back below.
  const ids = planned.map((copy) => copy.row.id);
  const stored = await db.select({ id: messages.id }).from(messages).where(inArray(messages.id, ids));
  if (stored.length === ids.length) {
    return true;
  }
  await db.delete(messages).where(inArray(messages.id, ids));
  await deleteBlobs(env, written);
  return false;
}
