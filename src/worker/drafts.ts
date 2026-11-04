import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { and, eq } from 'drizzle-orm';
import { errorMessage, getDb } from './db';
import { messages } from './db/schema';
import { broadcast } from './realtime';
import type { Env } from './types';
import { nonEmpty } from './utils';

// A draft is a `messages` row with folder = 'drafts' (no attachments, never unread). The compose window autosaves it
// with PUT, so the body is the whole compose state and a missing field means empty.

const DRAFT_ID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/;
const MESSAGE_ID = /^<[^\s<>]+>$/;
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const MAX_HTML_CHARS = 200_000;
const MAX_TEXT_CHARS = 100_000;
const MAX_RECIPIENTS = 100;
const MAX_ADDRESS_CHARS = 320;
const MAX_SUBJECT_CHARS = 500;
const MAX_MESSAGE_ID_CHARS = 998;
const SNIPPET_CHARS = 160;

interface DraftInput {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  html: string;
  inReplyTo: string | undefined;
}

const bad = (message: string, status: 400 | 413 = 400): HTTPException => new HTTPException(status, { message });

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

function parseDraft(body: unknown): DraftInput {
  if (!isRecord(body)) {
    throw bad('Request body must be a JSON object');
  }
  const from = optionalString(body, 'from')?.trim() ?? '';
  const subject = optionalString(body, 'subject') ?? '';
  const text = optionalString(body, 'text') ?? '';
  const html = optionalString(body, 'html') ?? '';
  const inReplyTo = optionalString(body, 'in_reply_to');

  if (from.length > MAX_ADDRESS_CHARS) {
    throw bad(`from must be at most ${MAX_ADDRESS_CHARS} characters`);
  }
  if (subject.length > MAX_SUBJECT_CHARS || /[\r\n]/.test(subject)) {
    throw bad(`subject must be a single line of at most ${MAX_SUBJECT_CHARS} characters`);
  }
  if (inReplyTo !== undefined && (inReplyTo.length > MAX_MESSAGE_ID_CHARS || !MESSAGE_ID.test(inReplyTo))) {
    throw bad('in_reply_to must be a Message-ID in angle brackets');
  }
  const input = {
    from,
    to: recipients(body, 'to'),
    cc: recipients(body, 'cc'),
    bcc: recipients(body, 'bcc'),
    subject,
    text,
    html,
    inReplyTo
  };
  if (html.length > MAX_HTML_CHARS || text.length > MAX_TEXT_CHARS) {
    throw bad(`html is limited to ${MAX_HTML_CHARS} characters and text to ${MAX_TEXT_CHARS}`, 413);
  }
  return input;
}

const joinAddresses = (addresses: string[]): string | null => (addresses.length > 0 ? addresses.join(', ') : null);

// Addresses are stored joined by ", " (like every other mail row).
const splitAddresses = (value: string | null): string[] =>
  (value ?? '')
    .split(',')
    .map((address) => address.trim())
    .filter((address) => address !== '');

function makeSnippet(text: string, html: string): string {
  const source = text.trim() === '' ? html.replaceAll(/<[^>]+>/g, ' ') : text;
  return source.trim().replaceAll(/\s+/g, ' ').slice(0, SNIPPET_CHARS);
}

export const draftRoutes = new Hono<{ Bindings: Env }>();

draftRoutes.onError((error, c) => {
  if (error instanceof HTTPException) {
    return c.json({ success: false, error: error.message }, error.status);
  }
  // errorMessage drops the SQL parameters (draft content) that a raw Drizzle error carries.
  console.error('[edging-mail] drafts route failed:', errorMessage(error));
  return c.json({ success: false, error: errorMessage(error) }, 500);
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
  const draft = parseDraft(body);

  const db = getDb(c.env.DB);
  // A reply draft joins the thread of the mail it answers when that mail is stored; otherwise it starts its own.
  const parent =
    draft.inReplyTo === undefined
      ? undefined
      : await db.select({ thread_id: messages.thread_id }).from(messages).where(eq(messages.message_id, draft.inReplyTo)).get();
  const now = Date.now();
  const fields = {
    thread_id: nonEmpty(parent?.thread_id) ?? id,
    from_address: draft.from,
    to_address: draft.to.join(', '),
    cc: joinAddresses(draft.cc),
    bcc: joinAddresses(draft.bcc),
    subject: draft.subject,
    snippet: makeSnippet(draft.text, draft.html),
    body_text: draft.text,
    body_html: draft.html,
    in_reply_to: draft.inReplyTo ?? null,
    size: new TextEncoder().encode(draft.text + draft.html).byteLength,
    updated_at: now
  };
  // One statement: insert, or update only while the row is still a draft. A row of any other folder is never
  // overwritten (nothing is returned then), even if the id turns up between a check and the write.
  const saved = await db
    .insert(messages)
    .values({ ...fields, id, folder: 'drafts', is_read: 1, is_starred: 0, has_attachments: 0, created_at: now })
    .onConflictDoUpdate({ target: messages.id, set: fields, setWhere: eq(messages.folder, 'drafts') })
    .returning({ id: messages.id });
  if (saved.length === 0) {
    return c.json({ success: false, error: 'This id belongs to a message that is not a draft' }, 409);
  }

  c.executionCtx.waitUntil(broadcast(c.env, { type: 'mail.changed' }));
  return c.json({ success: true, id, saved_at: now });
});

draftRoutes.get('/:id', async (c) => {
  const row = await getDb(c.env.DB)
    .select()
    .from(messages)
    .where(and(eq(messages.id, c.req.param('id')), eq(messages.folder, 'drafts')))
    .get();
  if (!row) {
    return c.json({ success: false, error: 'Draft not found' }, 404);
  }
  return c.json({
    success: true,
    draft: {
      id: row.id,
      from: row.from_address,
      to: splitAddresses(row.to_address),
      cc: splitAddresses(row.cc),
      bcc: splitAddresses(row.bcc),
      subject: row.subject ?? '',
      text: row.body_text ?? '',
      html: row.body_html ?? '',
      in_reply_to: row.in_reply_to ?? undefined
    }
  });
});

draftRoutes.delete('/:id', async (c) => {
  const deleted = await getDb(c.env.DB)
    .delete(messages)
    .where(and(eq(messages.id, c.req.param('id')), eq(messages.folder, 'drafts')))
    .returning({ id: messages.id });
  if (deleted.length === 0) {
    return c.json({ success: false, error: 'Draft not found' }, 404);
  }
  c.executionCtx.waitUntil(broadcast(c.env, { type: 'mail.changed' }));
  return c.json({ success: true });
});
