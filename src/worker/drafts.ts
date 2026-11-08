import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, eq } from 'drizzle-orm';
import { currentUser } from './auth/middleware';
import { getDb } from './db';
import { messages, users } from './db/schema';
import { parseContentBlob, parseWrappedCekFor } from './mail/blobs';
import { ownedBy } from './mail/view';
import { broadcast } from './realtime';
import type { AppEnv } from './types';
import { errorClass, nonEmpty } from './utils';
import { apiError, statusError } from './errors';

// A draft is a `messages` row with folder = 'drafts' (no attachments, never unread). The compose window autosaves it with PUT, so the body
// is the whole compose state and a missing field means empty. Subject and body arrive ENCRYPTED (EM1, a fresh content key on every save, the
// draft id as the row id): `summary_blob`, `body_blob`, `wrapped_cek` and the `key_id` it is sealed to. Recipients stay plaintext like on
// every other mail row. A draft is an ordinary encrypted row: sending it deletes it.

const DRAFT_ID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;
const MESSAGE_ID = /^<[^\s<>]+>$/;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_BLOB_BYTES = 2 * 1024 * 1024;
const MAX_SUMMARY_BLOB_BYTES = 8 * 1024;
const MAX_RECIPIENTS = 100;
const MAX_ADDRESS_CHARS = 320;
const MAX_MESSAGE_ID_CHARS = 998;
const KEYS = new Set(['from', 'to', 'cc', 'bcc', 'in_reply_to', 'summary_blob', 'body_blob', 'wrapped_cek', 'key_id']);

interface DraftInput {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  inReplyTo: string | undefined;
  summaryBlob: string;
  bodyBlob: string;
  wrappedCek: string;
  keyId: string;
}

const bad = (message: string, status: 400 | 413 | 409 = 400): HTTPException => new HTTPException(status, { message });

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

// null counts as absent: a client that clears a field may send either.
function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key] ?? undefined;
  if (value !== undefined && typeof value !== 'string') {
    throw bad(`${key} must be a string`);
  }
  return value;
}

function recipients(body: Record<string, unknown>, key: string): string[] {
  const value = body[key] ?? [];
  if (!Array.isArray(value)) {
    throw bad(`${key} must be an array of addresses`);
  }
  if (value.length > MAX_RECIPIENTS) {
    throw bad(`${key} has more than ${MAX_RECIPIENTS} recipients`);
  }
  const addresses: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length > MAX_ADDRESS_CHARS) {
      throw bad(`${key} must contain strings of at most ${MAX_ADDRESS_CHARS} characters`);
    }
    // Drafts may be incomplete, so no address syntax check (sending validates); blank entries are just dropped.
    if (item.trim() !== '') {
      addresses.push(item.trim());
    }
  }
  return addresses;
}

function parseDraft(body: unknown, currentKeyId: string | null): DraftInput {
  if (!isRecord(body) || !Object.keys(body).every((key) => KEYS.has(key))) {
    throw bad('Request body must be a JSON object with only the documented fields');
  }
  const from = optionalString(body, 'from')?.trim() ?? '';
  const inReplyTo = optionalString(body, 'in_reply_to');
  if (from.length > MAX_ADDRESS_CHARS) {
    throw bad(`from must be at most ${MAX_ADDRESS_CHARS} characters`);
  }
  if (inReplyTo !== undefined && (inReplyTo.length > MAX_MESSAGE_ID_CHARS || !MESSAGE_ID.test(inReplyTo))) {
    throw bad('in_reply_to must be a Message-ID in angle brackets');
  }
  const summaryBlob = parseContentBlob(body.summary_blob, MAX_SUMMARY_BLOB_BYTES);
  const bodyBlob = parseContentBlob(body.body_blob, MAX_BLOB_BYTES);
  if (summaryBlob === null || bodyBlob === null) {
    throw bad('summary_blob and body_blob must be encrypted blobs within the size limits');
  }
  // The content key must be sealed to the user's CURRENT key: otherwise the draft could never be opened.
  const wrappedCek =
    typeof body.key_id === 'string' && body.key_id === currentKeyId ? parseWrappedCekFor(body.wrapped_cek, currentKeyId) : null;
  if (wrappedCek === null || currentKeyId === null) {
    throw bad('wrapped_cek and key_id must be sealed to your current key', 409);
  }
  return {
    from,
    to: recipients(body, 'to'),
    cc: recipients(body, 'cc'),
    bcc: recipients(body, 'bcc'),
    inReplyTo,
    summaryBlob,
    bodyBlob,
    wrappedCek,
    keyId: currentKeyId
  };
}

const joinAddresses = (addresses: string[]): string | null => (addresses.length > 0 ? addresses.join(', ') : null);

// Addresses are stored joined by ", " (like every other mail row).
const splitAddresses = (value: string | null): string[] =>
  (value ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter((address) => address !== '');

export const draftRoutes = new Hono<AppEnv>();

draftRoutes.onError((error, c) => {
  if (error instanceof HTTPException) {
    return statusError(c, error.status, error.message);
  }
  // Only the class is logged: a raw Drizzle error carries the SQL parameters, and any message can carry addresses or file names.
  console.error('[edging-mail] drafts route failed:', errorClass(error));
  return apiError(c, 'server_error', { error: 'The draft could not be saved' });
});

draftRoutes.put('/:id', async (c) => {
  const id = c.req.param('id');
  if (!DRAFT_ID.test(id)) {
    throw bad('Invalid draft id');
  }
  if (Number(c.req.header('Content-Length') ?? 0) > MAX_BODY_BYTES) {
    throw bad('Request body too large', 413);
  }
  const body = await c.req.json<unknown>().catch(() => {
    throw bad('Request body must be valid JSON');
  });
  const userId = currentUser(c).id;
  const db = getDb(c.env.DB);
  const owner = await db.select({ key_id: users.key_id }).from(users).where(eq(users.id, userId)).get();
  const draft = parseDraft(body, owner?.key_id ?? null);

  // A reply draft joins the thread of the mail it answers when that mail is stored (the user's own mail); otherwise it starts its own.
  const parent =
    draft.inReplyTo === undefined
      ? undefined
      : await db
          .select({ thread_id: messages.thread_id })
          .from(messages)
          .where(and(eq(messages.message_id, draft.inReplyTo), ownedBy(userId)))
          .get();
  const now = Date.now();
  const fields = {
    thread_id: nonEmpty(parent?.thread_id) ?? id,
    from_address: draft.from,
    to_address: draft.to.join(', '),
    cc: joinAddresses(draft.cc),
    bcc: joinAddresses(draft.bcc),
    subject: null,
    snippet: null,
    body_text: null,
    body_html: null,
    enc_fmt: 1,
    key_id: draft.keyId,
    wrapped_cek: draft.wrappedCek,
    wrap_kind: 'user' as const,
    summary_blob: draft.summaryBlob,
    body_blob: draft.bodyBlob,
    in_reply_to: draft.inReplyTo ?? null,
    size: draft.summaryBlob.length + draft.bodyBlob.length,
    updated_at: now
  };
  // One statement: insert, or update only while the row is still the caller's own draft. Any other row with this id (a mail of the
  // caller, or anything of somebody else) is never overwritten (nothing is returned then), even if the id turns up between a check and the write.
  const saved = await db
    .insert(messages)
    .values({ ...fields, id, user_id: userId, folder: 'drafts', is_read: 1, is_starred: 0, has_attachments: 0, created_at: now })
    .onConflictDoUpdate({ target: messages.id, set: fields, setWhere: and(eq(messages.folder, 'drafts'), ownedBy(userId)) })
    .returning({ id: messages.id });
  if (saved.length === 0) {
    // The caller's own non-draft mail is a conflict; an id that belongs to someone else is "not found", like an id that does not exist.
    const own = await db
      .select({ id: messages.id })
      .from(messages)
      .where(and(eq(messages.id, id), ownedBy(userId)))
      .get();
    return own === undefined ? apiError(c, 'draft_not_found') : apiError(c, 'not_a_draft');
  }

  c.executionCtx.waitUntil(broadcast(c.env, userId, { type: 'mail.changed' }));
  return c.json({ success: true, id, saved_at: now });
});

draftRoutes.get('/:id', async (c) => {
  const row = await getDb(c.env.DB)
    .select()
    .from(messages)
    .where(and(eq(messages.id, c.req.param('id')), eq(messages.folder, 'drafts'), ownedBy(currentUser(c).id)))
    .get();
  if (!row) {
    return apiError(c, 'draft_not_found');
  }
  return c.json({
    success: true,
    draft: {
      id: row.id,
      from: row.from_address,
      to: splitAddresses(row.to_address),
      cc: splitAddresses(row.cc),
      bcc: splitAddresses(row.bcc),
      in_reply_to: row.in_reply_to ?? undefined,
      enc_fmt: row.enc_fmt,
      key_id: row.key_id,
      wrapped_cek: row.wrapped_cek,
      wrap_kind: row.wrap_kind,
      summary_blob: row.summary_blob,
      body_blob: row.body_blob,
      // A plaintext draft from before the upgrade, until the encryption job has converted it
      ...(row.enc_fmt === 0 ? { subject: row.subject ?? '', text: row.body_text ?? '', html: row.body_html ?? '' } : {})
    }
  });
});

draftRoutes.delete('/:id', async (c) => {
  const userId = currentUser(c).id;
  const deleted = await getDb(c.env.DB)
    .delete(messages)
    .where(and(eq(messages.id, c.req.param('id')), eq(messages.folder, 'drafts'), ownedBy(userId)))
    .returning({ id: messages.id });
  if (deleted.length === 0) {
    return apiError(c, 'draft_not_found');
  }
  c.executionCtx.waitUntil(broadcast(c.env, userId, { type: 'mail.changed' }));
  return c.json({ success: true });
});
