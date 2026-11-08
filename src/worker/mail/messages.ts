import { Hono } from 'hono';
import { and, asc, count, desc, eq, getTableColumns, inArray, ne, sql } from 'drizzle-orm';
import { currentUser } from '../auth/middleware';
import { deleteBlobs, MAX_SEARCH_CHARS } from '../content';
import { getDb } from '../db';
import type { Db } from '../db';
import { attachments, messages } from '../db/schema';
import type { Folder } from '../db/schema';
import { broadcast } from '../realtime';
import type { AppEnv, BatchActionPayload, Env } from '../types';
import { jsonObject, nonEmpty } from '../utils';
import { intParam, ownedBy, viewFilter, withFromHosted } from './view';
import { apiError, failed } from '../errors';

export const messageRoutes = new Hono<AppEnv>();

// A list never carries a body: the summary (subject and snippet, encrypted) and the wrapped key are enough to draw a row.
const BODY_COLUMNS = new Set(['body_text', 'body_html', 'body_blob']);
const LIST_COLUMNS = Object.fromEntries(Object.entries(getTableColumns(messages)).filter(([name]) => !BODY_COLUMNS.has(name))) as Omit<
  ReturnType<typeof getTableColumns<typeof messages>>,
  'body_text' | 'body_html' | 'body_blob'
>;

// Folder & Unread Stats (of the signed-in user only)
messageRoutes.get('/stats', async (c) => {
  try {
    const userId = currentUser(c).id;
    const db = getDb(c.env.DB);
    const unread = sql<number | null>`SUM(CASE WHEN ${messages.is_read} = 0 THEN 1 ELSE 0 END)`;

    const result = await db
      .select({ folder: messages.folder, total: count(), unread })
      .from(messages)
      .where(ownedBy(userId))
      .groupBy(messages.folder);

    const starred = await db
      .select({ total: count(), unread })
      .from(messages)
      .where(and(ownedBy(userId), eq(messages.is_starred, 1), ne(messages.folder, 'trash')))
      .get();

    const folderStats: Record<string, { total: number; unread: number } | undefined> = {
      inbox: { total: 0, unread: 0 },
      sent: { total: 0, unread: 0 },
      starred: { total: starred?.total ?? 0, unread: starred?.unread ?? 0 },
      archive: { total: 0, unread: 0 },
      spam: { total: 0, unread: 0 },
      trash: { total: 0, unread: 0 },
      drafts: { total: 0, unread: 0 },
      snoozed: { total: 0, unread: 0 }
    };

    for (const row of result) {
      if (folderStats[row.folder]) {
        folderStats[row.folder] = {
          total: row.total || 0,
          // a draft is never unread
          unread: row.folder === 'drafts' ? 0 : (row.unread ?? 0)
        };
      }
    }

    return c.json({ success: true, stats: folderStats });
  } catch (error) {
    return failed(c, error);
  }
});

// List Messages with Pagination, Folder and Search filter
messageRoutes.get('/messages', async (c) => {
  try {
    const folder = nonEmpty(c.req.query('folder')) ?? 'inbox';
    const search = (c.req.query('q')?.trim() ?? '').slice(0, MAX_SEARCH_CHARS);
    const page = intParam(c.req.query('page'), 1, 100_000);
    const limit = intParam(c.req.query('limit'), 30, 100);
    const offset = (page - 1) * limit;

    // Newest first, equal dates in arrival order (rowid). Drafts: last edited first. Snoozed: the one due soonest first.
    const order =
      folder === 'drafts'
        ? [desc(messages.updated_at), sql`rowid DESC`]
        : folder === 'snoozed'
          ? [asc(messages.snoozed_until), sql`rowid ASC`]
          : [desc(messages.created_at), sql`rowid DESC`];

    // limit/offset go in as placeholders (bound at execution), as before.
    const db = getDb(c.env.DB);
    const results = await db
      .select(LIST_COLUMNS)
      .from(messages)
      .where(viewFilter(currentUser(c).id, folder, search))
      .orderBy(...order)
      .limit(sql.placeholder('limit'))
      .offset(sql.placeholder('offset'))
      .all({ limit, offset });

    return c.json({
      success: true,
      messages: await withFromHosted(db, results),
      page,
      limit
    });
  } catch (error) {
    return failed(c, error);
  }
});

// Mark every unread mail of a folder view (and search) as read: the list only holds the pages loaded so far.
messageRoutes.post('/messages/read-all', async (c) => {
  try {
    const userId = currentUser(c).id;
    const body = await jsonObject<{ folder?: unknown; q?: unknown }>(c.req, ['folder', 'q']);
    if (body === null) {
      return apiError(c, 'invalid_body');
    }
    const folder = typeof body.folder === 'string' ? (nonEmpty(body.folder) ?? 'inbox') : 'inbox';
    const search = (typeof body.q === 'string' ? body.q.trim() : '').slice(0, MAX_SEARCH_CHARS);

    const result = await getDb(c.env.DB)
      .update(messages)
      .set({ is_read: sql`1`, updated_at: Date.now() })
      .where(and(viewFilter(userId, folder, search), eq(messages.is_read, 0)))
      .run();
    const changed = result.meta.changes;

    if (changed > 0) {
      c.executionCtx.waitUntil(broadcast(c.env, userId, { type: 'mail.changed' }));
    }
    return c.json({ success: true, count: changed });
  } catch (error) {
    return failed(c, error);
  }
});

// Get Single Message Detail + Attachments + Mark Read (`?peek=1` skips the mark-read: background refreshes of an open message)
messageRoutes.get('/messages/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const db = getDb(c.env.DB);
    // Someone else's mail is "not found", exactly like an id that does not exist.
    const message = await db
      .select()
      .from(messages)
      .where(and(eq(messages.id, id), ownedBy(currentUser(c).id)))
      .get();

    if (!message) {
      return apiError(c, 'message_not_found');
    }

    // Mark as read
    if (message.is_read === 0 && c.req.query('peek') !== '1') {
      await db.update(messages).set({ is_read: 1, updated_at: Date.now() }).where(eq(messages.id, id));
      message.is_read = 1;
    }

    // Fetch attachments
    const attachmentRows = await db.select().from(attachments).where(eq(attachments.message_id, id)).orderBy(asc(attachments.created_at));

    const [shown] = await withFromHosted(db, [message]);
    return c.json({
      success: true,
      message: shown,
      attachments: attachmentRows
    });
  } catch (error) {
    return failed(c, error);
  }
});

// Batch Actions (read, unread, star, unstar, trash, archive, restore, move, snooze, delete)
const MIN_SNOOZE_MS = 60 * 1000;
const MAX_SNOOZE_MS = 366 * 24 * 60 * 60 * 1000;
// D1 allows 100 bound variables per statement: ids go to it in chunks, next to the owner and the other values.
const BATCH_CHUNK = 80;

// Fixed values stay inline in the SQL (not bound parameters) to leave room for the ids.
const SIMPLE_CHANGES = {
  read: { is_read: sql`1` },
  unread: { is_read: sql`0` },
  star: { is_starred: sql`1` },
  unstar: { is_starred: sql`0` },
  trash: { folder: sql`'trash'`, snoozed_until: sql`NULL` },
  archive: { folder: sql`'archive'`, snoozed_until: sql`NULL` },
  restore: { folder: sql`'inbox'`, snoozed_until: sql`NULL` }
};
const simpleChange = (action: string) =>
  Object.hasOwn(SIMPLE_CHANGES, action) ? SIMPLE_CHANGES[action as keyof typeof SIMPLE_CHANGES] : undefined;

// Permanent deletion of the user's mails among `ids`, with their attachments and R2 objects. Returns how many mails were deleted.
async function deleteMessages(env: Env, db: Db, userId: string, ids: string[]): Promise<number> {
  const owned = await db
    .select({ id: messages.id, r2_key: messages.r2_key })
    .from(messages)
    .where(and(ownedBy(userId), inArray(messages.id, ids)));
  if (owned.length === 0) {
    return 0;
  }
  const ownedIds = owned.map((row) => row.id);
  const atts = await db.select({ r2_key: attachments.r2_key }).from(attachments).where(inArray(attachments.message_id, ownedIds));
  await deleteBlobs(
    env,
    [...atts.map((a) => a.r2_key), ...owned.map((m) => m.r2_key)].filter((key): key is string => key !== null && key !== '')
  );
  await db.batch([
    db.delete(attachments).where(inArray(attachments.message_id, ownedIds)),
    db.delete(messages).where(inArray(messages.id, ownedIds))
  ]);
  return ownedIds.length;
}

messageRoutes.post('/messages/batch', async (c) => {
  try {
    const userId = currentUser(c).id;
    const body = await jsonObject<BatchActionPayload>(c.req, ['message_ids', 'action', 'folder', 'until']);
    if (body === null) {
      return apiError(c, 'invalid_body');
    }
    const { message_ids: rawIds, action } = body;

    if (!rawIds || !Array.isArray(rawIds) || rawIds.length === 0 || !rawIds.every((id) => typeof id === 'string')) {
      return apiError(c, 'invalid_request', { error: 'message_ids array is required' });
    }
    const ids = [...new Set(rawIds)];

    const now = Date.now();
    const db = getDb(c.env.DB);
    const change = simpleChange(action);
    let target: string | undefined;
    let until = 0;
    if (action === 'move') {
      target = body.folder;
      if (target === 'snoozed') {
        return apiError(c, 'invalid_request', { error: 'Use the snooze action to snooze mail' });
      }
      // 'drafts' stays allowed: undoing the trashing of a draft moves it back.
      if (target === undefined || !['inbox', 'archive', 'trash', 'spam', 'sent', 'drafts'].includes(target)) {
        return apiError(c, 'invalid_request', { error: 'Valid folder is required for move' });
      }
    } else if (action === 'snooze') {
      if (
        typeof body.until !== 'number' ||
        !Number.isInteger(body.until) ||
        body.until < now + MIN_SNOOZE_MS ||
        body.until > now + MAX_SNOOZE_MS
      ) {
        return apiError(c, 'invalid_request', { error: 'until must be between 1 minute and 1 year from now' });
      }
      until = body.until;
    } else if (change === undefined && action !== 'delete') {
      return apiError(c, 'invalid_request', { error: 'Invalid action' });
    }

    // Only the caller's own rows are ever matched: a list that mixes in somebody else's ids changes (and counts) just the caller's.
    let changed = 0;
    for (let start = 0; start < ids.length; start += BATCH_CHUNK) {
      const chunk = ids.slice(start, start + BATCH_CHUNK);
      const mine = and(ownedBy(userId), inArray(messages.id, chunk));
      if (action === 'delete') {
        changed += await deleteMessages(c.env, db, userId, chunk);
      } else if (action === 'move' && target !== undefined) {
        const moved = await db
          .update(messages)
          .set({ folder: target as Folder, snoozed_until: sql`NULL`, updated_at: now })
          .where(mine)
          .run();
        changed += moved.meta.changes;
      } else if (action === 'snooze') {
        // Mail that is not the owner's incoming mail (drafts, sent) cannot be snoozed: it would return to the inbox as unread.
        // `until` is a checked integer, so it goes inline like the other fixed values.
        const snoozed = await db
          .update(messages)
          .set({ folder: sql`'snoozed'`, snoozed_until: sql.raw(String(until)), updated_at: now })
          .where(and(mine, sql`${messages.folder} NOT IN ('drafts', 'sent')`))
          .returning({ id: messages.id });
        changed += snoozed.length;
      } else if (change !== undefined) {
        const updated = await db
          .update(messages)
          .set({ ...change, updated_at: now })
          .where(mine)
          .run();
        changed += updated.meta.changes;
      }
    }

    c.executionCtx.waitUntil(broadcast(c.env, userId, { type: 'mail.changed' }));
    return c.json({ success: true, count: changed });
  } catch (error) {
    return failed(c, error);
  }
});

// Set Labels On A Message
const LABEL_PATTERN = /^[\p{L}\p{N} _-]{1,30}$/u;
const MAX_LABELS = 20;
const isLabel = (value: unknown): value is string => typeof value === 'string' && LABEL_PATTERN.test(value);

// Distinct label names in use by the user's mail that is not in trash or spam (malformed labels JSON counts as no labels)
messageRoutes.get('/labels', async (c) => {
  try {
    const userId = currentUser(c).id;
    const rows = await getDb(c.env.DB).all<{ name: string }>(sql`
      SELECT DISTINCT j.value AS name
      FROM messages m,
        json_each(CASE WHEN json_valid(m.labels) THEN CASE WHEN json_type(m.labels) = 'array' THEN m.labels ELSE '[]' END ELSE '[]' END) j
      WHERE m.user_id = ${userId} AND m.folder NOT IN ('trash', 'spam') AND j.type = 'text' AND trim(j.value) <> ''
      ORDER BY j.value`);
    const labels = rows.map((row) => row.name).toSorted((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return c.json({ success: true, labels });
  } catch (error) {
    return failed(c, error);
  }
});

messageRoutes.post('/messages/labels', async (c) => {
  try {
    const userId = currentUser(c).id;
    const body = await jsonObject<{ id: string; labels: unknown[] }>(c.req, ['id', 'labels']);
    if (body === null) {
      return apiError(c, 'invalid_body');
    }
    if (!body.id || !Array.isArray(body.labels)) {
      return apiError(c, 'invalid_request', { error: 'id and labels[] are required' });
    }
    const trimmed = body.labels.map((l) => (typeof l === 'string' ? l.trim() : l));
    // A name exists once, whatever its case (the label folder filter matches case-insensitively); the first spelling wins.
    const labels = trimmed.filter(
      (l, i) =>
        typeof l !== 'string' || trimmed.findIndex((other) => typeof other === 'string' && other.toLowerCase() === l.toLowerCase()) === i
    );
    if (labels.length > MAX_LABELS) {
      return apiError(c, 'invalid_request', { error: `At most ${MAX_LABELS} labels per message` });
    }
    if (!labels.every(isLabel)) {
      return apiError(c, 'invalid_request', { error: 'Labels must be 1-30 letters, numbers, spaces, "_" or "-"' });
    }
    const result = await getDb(c.env.DB)
      .update(messages)
      .set({ labels: JSON.stringify(labels), updated_at: Date.now() })
      .where(and(eq(messages.id, body.id), ownedBy(userId)))
      .run();
    if (result.meta.changes === 0) {
      return apiError(c, 'message_not_found');
    }
    c.executionCtx.waitUntil(broadcast(c.env, userId, { type: 'mail.changed' }));
    return c.json({ success: true, labels });
  } catch (error) {
    return failed(c, error);
  }
});
