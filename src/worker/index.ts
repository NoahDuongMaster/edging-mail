import { Hono } from 'hono';
import type { HonoRequest, MiddlewareHandler } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { and, asc, count, desc, eq, inArray, ne, notInArray, or, sql } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';
import type { Env, BatchActionPayload, SendEmailPayload } from './types';
import { errorMessage, getDb } from './db';
import { attachments, messages, settings } from './db/schema';
import type { Folder } from './db/schema';
import { parseAndStoreEmail } from './services/email-parser';
import { SendError, sendEmail } from './services/email-sender';
import { appName, isEmail, nonEmpty } from './utils';
import { authRoutes, requireAuth } from './auth';
import { broadcast, realtimeRoutes } from './realtime';
import { pushRoutes } from './push';
import { draftRoutes } from './drafts';
import { returnSnoozedMail } from './snooze';

// The Durable Object class must be exported from the entry module (see durable_objects in wrangler.jsonc).
export { MailHub } from './realtime';

const app = new Hono<{ Bindings: Env }>();

// Browsers always send Sec-Fetch-Site (fetch, XHR, navigation) and page scripts cannot forge it; curl and Wrangler's
// email handler send none. Only the app's own origin (or the user typing the URL) may call the API: this stops
// cross-site and same-site (sibling subdomain) requests. No CORS headers.
const isLoopbackHost = (hostname: string): boolean => ['localhost', '127.0.0.1', '[::1]'].includes(hostname);

const hostnameOf = (origin: string): string => {
  try {
    return new URL(origin).hostname;
  } catch {
    return '';
  }
};

const sameOriginOnly: MiddlewareHandler = async (c, next) => {
  const site = c.req.header('Sec-Fetch-Site');
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    return c.json({ success: false, error: 'Forbidden' }, 403);
  }
  // Chromium sends no Sec-Fetch-Site on WebSocket handshakes, only Origin: without this check a page on a sibling
  // subdomain could open the cookie-authenticated socket and read incoming mail events.
  if (c.req.header('Upgrade')?.toLowerCase() === 'websocket') {
    const origin = c.req.header('Origin');
    if (origin !== undefined) {
      const own = new URL(c.req.url);
      // Local dev reaches the worker through the Vite proxy, which keeps the page's origin (another port).
      const loopbackDev = isLoopbackHost(own.hostname) && isLoopbackHost(hostnameOf(origin));
      if (origin !== own.origin && !loopbackDev) {
        return c.json({ success: false, error: 'Forbidden' }, 403);
      }
    }
  }
  await next();
};

// JSON answers hold private mail data: never cache them. Downloads (octet-stream) and the WebSocket upgrade are left alone.
const noStoreJson: MiddlewareHandler = async (c, next) => {
  await next();
  if (c.res.headers.get('Content-Type')?.startsWith('application/json') === true) {
    c.header('Cache-Control', 'no-store');
  }
};

// secureHeaders() rewrites response headers, which workerd forbids on the 101 response of a WebSocket upgrade.
// Strict-Transport-Security belongs on https responses only (browsers ignore it over http; local dev runs on http).
const applySecureHeaders = secureHeaders();
const applySecureHeadersOverHttp = secureHeaders({ strictTransportSecurity: false });
const secureHeadersExceptUpgrade: MiddlewareHandler = (c, next) => {
  if (c.req.header('Upgrade') !== undefined) {
    return next();
  }
  return (new URL(c.req.url).protocol === 'https:' ? applySecureHeaders : applySecureHeadersOverHttp)(c, next);
};

// Global middleware
app.use('/api/*', sameOriginOnly);
app.use('/api/*', secureHeadersExceptUpgrade);
app.use('/api/*', noStoreJson);
// Every /api route needs the login cookie except /api/health and /api/auth/*, so this stays above all route registrations.
app.use('/api/*', requireAuth);

app.route('/api/auth', authRoutes);

// Realtime (WebSocket) and Web Push routes
app.route('/api/push', pushRoutes);
app.route('/api/drafts', draftRoutes);
app.route('/api', realtimeRoutes);

// Health & Info
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    app: appName(c.env),
    edge: 'Cloudflare Workers',
    timestamp: Date.now()
  });
});

// Folder & Unread Stats
app.get('/api/stats', async (c) => {
  try {
    const db = getDb(c.env.DB);
    const unread = sql<number | null>`SUM(CASE WHEN ${messages.is_read} = 0 THEN 1 ELSE 0 END)`;

    const result = await db.select({ folder: messages.folder, total: count(), unread }).from(messages).groupBy(messages.folder);

    const starred = await db
      .select({ total: count(), unread })
      .from(messages)
      .where(and(eq(messages.is_starred, 1), ne(messages.folder, 'trash')))
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
    return c.json({ success: false, error: errorMessage(error) }, 500);
  }
});

// D1 refuses LIKE patterns over 50 bytes (a long search or a CJK label would be an HTTP 500), so substring tests use
// instr(): case-insensitive for ASCII like LIKE was, and %, _ and \ are ordinary characters.
const MAX_SEARCH_CHARS = 200;
const contains = (column: AnyColumn, text: string) => sql`instr(lower(${column}), lower(${text})) > 0`;

// A request body that is not a JSON object is the caller's mistake (HTTP 400), not a server failure (500).
const BAD_BODY = 'A JSON object body is required';
const jsonObject = async <T extends object>(request: HonoRequest): Promise<T | null> => {
  const body = await request.json<unknown>().catch(() => null);
  return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as T) : null;
};

// Page and limit: a non-numeric value takes the default and a huge page is capped, instead of reaching D1 as NaN or a
// float (HTTP 500). Valid values behave as before.
const intParam = (value: string | undefined, fallback: number, max: number): number => {
  const parsed = Number.parseInt(nonEmpty(value) ?? '', 10);
  return Number.isNaN(parsed) ? fallback : Math.min(max, Math.max(1, parsed));
};

// The rows of one folder view (a folder, the starred view or a label) narrowed by a search text: the list and
// "mark all as read" use the same one, so the button always means exactly what the list shows.
const viewFilter = (folder: string, search: string) => {
  const filters = [];

  if (folder === 'starred') {
    filters.push(and(eq(messages.is_starred, 1), ne(messages.folder, 'trash')));
  } else if (folder.startsWith('label:')) {
    // Labels are stored as a JSON array, so the quoted name only matches a whole label.
    filters.push(and(contains(messages.labels, `"${folder.slice(6)}"`), notInArray(messages.folder, ['trash', 'spam'])));
  } else {
    filters.push(eq(messages.folder, folder as Folder));
  }

  if (search) {
    filters.push(
      or(
        contains(messages.subject, search),
        contains(messages.from_address, search),
        contains(messages.to_address, search),
        contains(messages.snippet, search)
      )
    );
  }

  return and(...filters);
};

// List Messages with Pagination, Folder and Search filter
app.get('/api/messages', async (c) => {
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
    const results = await getDb(c.env.DB)
      .select()
      .from(messages)
      .where(viewFilter(folder, search))
      .orderBy(...order)
      .limit(sql.placeholder('limit'))
      .offset(sql.placeholder('offset'))
      .all({ limit, offset });

    return c.json({
      success: true,
      messages: results,
      page,
      limit
    });
  } catch (error) {
    return c.json({ success: false, error: errorMessage(error) }, 500);
  }
});

// Mark every unread mail of a folder view (and search) as read: the list only holds the pages loaded so far.
app.post('/api/messages/read-all', async (c) => {
  try {
    const body = await jsonObject<{ folder?: unknown; q?: unknown }>(c.req);
    if (body === null) {
      return c.json({ success: false, error: BAD_BODY }, 400);
    }
    const folder = typeof body.folder === 'string' ? (nonEmpty(body.folder) ?? 'inbox') : 'inbox';
    const search = (typeof body.q === 'string' ? body.q.trim() : '').slice(0, MAX_SEARCH_CHARS);

    const result = await getDb(c.env.DB)
      .update(messages)
      .set({ is_read: sql`1`, updated_at: Date.now() })
      .where(and(viewFilter(folder, search), eq(messages.is_read, 0)))
      .run();
    const changed = result.meta.changes;

    if (changed > 0) {
      c.executionCtx.waitUntil(broadcast(c.env, { type: 'mail.changed' }));
    }
    return c.json({ success: true, count: changed });
  } catch (error) {
    return c.json({ success: false, error: errorMessage(error) }, 500);
  }
});

// Get Single Message Detail + Attachments + Mark Read (`?peek=1` skips the mark-read: background refreshes of an open message)
app.get('/api/messages/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const db = getDb(c.env.DB);
    const message = await db.select().from(messages).where(eq(messages.id, id)).get();

    if (!message) {
      return c.json({ success: false, error: 'Message not found' }, 404);
    }

    // Mark as read
    if (message.is_read === 0 && c.req.query('peek') !== '1') {
      await db.update(messages).set({ is_read: 1, updated_at: Date.now() }).where(eq(messages.id, id));
      message.is_read = 1;
    }

    // Fetch attachments
    const attachmentRows = await db.select().from(attachments).where(eq(attachments.message_id, id)).orderBy(asc(attachments.created_at));

    return c.json({
      success: true,
      message,
      attachments: attachmentRows
    });
  } catch (error) {
    return c.json({ success: false, error: errorMessage(error) }, 500);
  }
});

// Batch Actions (read, unread, star, unstar, trash, archive, restore, move, snooze, delete)
const MIN_SNOOZE_MS = 60 * 1000;
const MAX_SNOOZE_MS = 366 * 24 * 60 * 60 * 1000;
app.post('/api/messages/batch', async (c) => {
  try {
    const body = await jsonObject<BatchActionPayload>(c.req);
    if (body === null) {
      return c.json({ success: false, error: BAD_BODY }, 400);
    }
    const { message_ids, action } = body;

    if (!message_ids || !Array.isArray(message_ids) || message_ids.length === 0) {
      return c.json({ success: false, error: 'message_ids array is required' }, 400);
    }

    const now = Date.now();
    const db = getDb(c.env.DB);
    const targets = inArray(messages.id, message_ids);
    // `count` in the answer: the ids sent, except for snooze, which counts the rows it really moved.
    let changed = message_ids.length;

    // Fixed values stay inline in the SQL (not bound parameters): D1 allows 100 bound
    // variables per statement, so this keeps the id capacity per call unchanged.
    switch (action) {
      case 'read': {
        await db
          .update(messages)
          .set({ is_read: sql`1`, updated_at: now })
          .where(targets);
        break;
      }
      case 'unread': {
        await db
          .update(messages)
          .set({ is_read: sql`0`, updated_at: now })
          .where(targets);
        break;
      }
      case 'star': {
        await db
          .update(messages)
          .set({ is_starred: sql`1`, updated_at: now })
          .where(targets);
        break;
      }
      case 'unstar': {
        await db
          .update(messages)
          .set({ is_starred: sql`0`, updated_at: now })
          .where(targets);
        break;
      }
      case 'trash': {
        await db
          .update(messages)
          .set({ folder: sql`'trash'`, snoozed_until: sql`NULL`, updated_at: now })
          .where(targets);
        break;
      }
      case 'archive': {
        await db
          .update(messages)
          .set({ folder: sql`'archive'`, snoozed_until: sql`NULL`, updated_at: now })
          .where(targets);
        break;
      }
      case 'restore': {
        await db
          .update(messages)
          .set({ folder: sql`'inbox'`, snoozed_until: sql`NULL`, updated_at: now })
          .where(targets);
        break;
      }
      case 'move': {
        const target = body.folder;
        if (target === 'snoozed') {
          return c.json({ success: false, error: 'Use the snooze action to snooze mail' }, 400);
        }
        // 'drafts' stays allowed: undoing the trashing of a draft moves it back.
        const allowed = ['inbox', 'archive', 'trash', 'spam', 'sent', 'drafts'];
        if (!target || !allowed.includes(target)) {
          return c.json({ success: false, error: 'Valid folder is required for move' }, 400);
        }
        await db
          .update(messages)
          .set({ folder: target, snoozed_until: sql`NULL`, updated_at: now })
          .where(targets);
        break;
      }
      case 'snooze': {
        const { until } = body;
        if (typeof until !== 'number' || !Number.isInteger(until) || until < now + MIN_SNOOZE_MS || until > now + MAX_SNOOZE_MS) {
          return c.json({ success: false, error: 'until must be between 1 minute and 1 year from now' }, 400);
        }
        // Mail that is not the owner's incoming mail (drafts, sent) cannot be snoozed: it would return to the inbox as unread.
        // `until` is a checked integer, so it goes inline like the other fixed values.
        const snoozed = await db
          .update(messages)
          .set({ folder: sql`'snoozed'`, snoozed_until: sql.raw(String(until)), updated_at: now })
          .where(and(targets, sql`${messages.folder} NOT IN ('drafts', 'sent')`))
          .returning({ id: messages.id });
        changed = snoozed.length;
        break;
      }
      case 'delete': {
        // Permanent deletion: clean up attachments & R2 keys
        const atts = await db.select({ r2_key: attachments.r2_key }).from(attachments).where(inArray(attachments.message_id, message_ids));
        const msgs = await db.select({ r2_key: messages.r2_key }).from(messages).where(targets);

        const keysToDelete = [...atts.map((a) => a.r2_key).filter(Boolean), ...msgs.map((m) => m.r2_key).filter(Boolean)] as string[];
        await Promise.allSettled(keysToDelete.map((k) => c.env.BUCKET.delete(k)));

        await db.batch([db.delete(attachments).where(inArray(attachments.message_id, message_ids)), db.delete(messages).where(targets)]);
        break;
      }
      default: {
        return c.json({ success: false, error: 'Invalid action' }, 400);
      }
    }

    c.executionCtx.waitUntil(broadcast(c.env, { type: 'mail.changed' }));
    return c.json({ success: true, count: changed });
  } catch (error) {
    return c.json({ success: false, error: errorMessage(error) }, 500);
  }
});

// Set Labels On A Message
const LABEL_PATTERN = /^[\p{L}\p{N} _-]{1,30}$/u;
const MAX_LABELS = 20;
const isLabel = (value: unknown): value is string => typeof value === 'string' && LABEL_PATTERN.test(value);

// Distinct label names in use by mail that is not in trash or spam (malformed labels JSON counts as no labels)
app.get('/api/labels', async (c) => {
  try {
    const rows = await getDb(c.env.DB).all<{ name: string }>(sql`
      SELECT DISTINCT j.value AS name
      FROM messages m,
        json_each(CASE WHEN json_valid(m.labels) THEN CASE WHEN json_type(m.labels) = 'array' THEN m.labels ELSE '[]' END ELSE '[]' END) j
      WHERE m.folder NOT IN ('trash', 'spam') AND j.type = 'text' AND trim(j.value) <> ''
      ORDER BY j.value`);
    const labels = rows.map((row) => row.name).toSorted((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    return c.json({ success: true, labels });
  } catch (error) {
    return c.json({ success: false, error: errorMessage(error) }, 500);
  }
});

app.post('/api/messages/labels', async (c) => {
  try {
    const body = await jsonObject<{ id: string; labels: unknown[] }>(c.req);
    if (body === null) {
      return c.json({ success: false, error: BAD_BODY }, 400);
    }
    if (!body.id || !Array.isArray(body.labels)) {
      return c.json({ success: false, error: 'id and labels[] are required' }, 400);
    }
    const trimmed = body.labels.map((l) => (typeof l === 'string' ? l.trim() : l));
    // A name exists once, whatever its case (the label folder filter matches case-insensitively); the first spelling wins.
    const labels = trimmed.filter(
      (l, i) =>
        typeof l !== 'string' || trimmed.findIndex((other) => typeof other === 'string' && other.toLowerCase() === l.toLowerCase()) === i
    );
    if (labels.length > MAX_LABELS) {
      return c.json({ success: false, error: `At most ${MAX_LABELS} labels per message` }, 400);
    }
    if (!labels.every(isLabel)) {
      return c.json({ success: false, error: 'Labels must be 1-30 letters, numbers, spaces, "_" or "-"' }, 400);
    }
    await getDb(c.env.DB)
      .update(messages)
      .set({ labels: JSON.stringify(labels), updated_at: Date.now() })
      .where(eq(messages.id, body.id));
    c.executionCtx.waitUntil(broadcast(c.env, { type: 'mail.changed' }));
    return c.json({ success: true, labels });
  } catch (error) {
    return c.json({ success: false, error: errorMessage(error) }, 500);
  }
});

// Outbound Send Email
app.post('/api/messages/send', async (c) => {
  try {
    const body = await jsonObject<SendEmailPayload>(c.req);
    if (body === null) {
      return c.json({ success: false, error: BAD_BODY }, 400);
    }
    if ((!Array.isArray(body.to) && !body.to) || !body.subject) {
      return c.json({ success: false, error: 'to and subject are required' }, 400);
    }

    const identity = await loadSettings(c.env);
    const from = nonEmpty(body.from?.trim()) ?? nonEmpty(identity.default_from);
    if (from === undefined) {
      return c.json({ success: false, error: 'No sender address configured' }, 400);
    }

    const res = await sendEmail(body, c.env, { address: from, name: nonEmpty(identity.display_name) ?? null });
    c.executionCtx.waitUntil(broadcast(c.env, { type: 'mail.changed' }));
    return c.json({ success: true, message: res.message, note: res.note });
  } catch (error) {
    if (error instanceof SendError) {
      return c.json({ success: false, error: error.message }, error.status);
    }
    return c.json({ success: false, error: errorMessage(error) }, 500);
  }
});

// Download Attachment from R2
const DOWNLOAD_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Cache-Control': 'private, no-store'
};
app.get('/api/attachments/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const attachment = await getDb(c.env.DB).select().from(attachments).where(eq(attachments.id, id)).get();

    if (!attachment || attachment.r2_key === '') {
      return c.text('Attachment not found', 404);
    }

    const object = await c.env.BUCKET.get(attachment.r2_key);
    if (!object) {
      return c.text('Attachment file not found in storage', 404);
    }

    // Sender-controlled bytes must never run as a page on this origin (the client only offers a download link):
    // always a download with an opaque type, no sniffing, and sandboxed in case it is opened anyway.
    const filename = nonEmpty(attachment.filename) ?? 'attachment';
    const asciiName = filename.replaceAll(/["\\\r\n]/g, '').replaceAll(/[^\u0020-\u007E]/g, '_');
    const encodedName = encodeURIComponent(filename).replaceAll(
      /['()*]/g,
      (ch) => `%${ch.codePointAt(0)?.toString(16).toUpperCase() ?? ''}`
    );
    const headers = new Headers(DOWNLOAD_HEADERS);
    headers.set('Content-Type', 'application/octet-stream');
    headers.set('Content-Disposition', `attachment; filename="${asciiName}"; filename*=UTF-8''${encodedName}`);
    return new Response(object.body, { headers });
  } catch (error) {
    return c.text(`Error: ${errorMessage(error)}`, 500);
  }
});

// Download Raw EML from R2
app.get('/api/raw/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const message = await getDb(c.env.DB)
      .select({ r2_key: messages.r2_key, subject: messages.subject })
      .from(messages)
      .where(eq(messages.id, id))
      .get();

    const r2Key = nonEmpty(message?.r2_key);
    if (r2Key === undefined) {
      return c.text('Raw email not found', 404);
    }

    const object = await c.env.BUCKET.get(r2Key);
    if (!object) {
      return c.text('EML object not found in storage', 404);
    }

    const headers = new Headers(DOWNLOAD_HEADERS);
    headers.set('Content-Type', 'message/rfc822');
    headers.set('Content-Disposition', `attachment; filename="email-${id}.eml"`);
    return new Response(object.body, { headers });
  } catch (error) {
    return c.text(`Error: ${errorMessage(error)}`, 500);
  }
});

// Settings: the sender identity. Stored per key in D1, with defaults filled in when nothing is saved.
const SETTING_KEYS = ['display_name', 'signature', 'default_from'] as const;
type SettingKey = (typeof SETTING_KEYS)[number];
type EffectiveSettings = Record<SettingKey, string>;

const isSettingKey = (key: string): key is SettingKey => (SETTING_KEYS as readonly string[]).includes(key);

async function loadSettings(env: Env): Promise<EffectiveSettings> {
  const rows = await getDb(env.DB)
    .select({ key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, [...SETTING_KEYS]));
  const stored = new Map(rows.map((row) => [row.key, row.value]));
  return {
    display_name: stored.get('display_name') ?? '',
    signature: stored.get('signature') ?? '',
    default_from: nonEmpty(stored.get('default_from')) ?? nonEmpty(env.DEFAULT_FROM) ?? ''
  };
}

// Returns the validated update, or the reason it was rejected.
function parseSettingsUpdate(body: unknown): Partial<EffectiveSettings> | string {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return 'Body must be an object of settings';
  }
  const update: Partial<EffectiveSettings> = {};
  for (const [key, raw] of Object.entries(body)) {
    if (!isSettingKey(key)) {
      return `Unknown setting: ${key}`;
    }
    if (typeof raw !== 'string') {
      return `${key} must be a string`;
    }
    const value = key === 'signature' ? raw : raw.trim();
    if (key === 'display_name' && (value.length > 100 || /[\r\n]/.test(value))) {
      return 'display_name must be a single line of at most 100 characters';
    }
    if (key === 'signature' && value.length > 2000) {
      return 'signature must be at most 2000 characters';
    }
    if (key === 'default_from' && value !== '' && !isEmail(value)) {
      return 'default_from must be an email address';
    }
    update[key] = value;
  }
  return update;
}

app.get('/api/settings', async (c) => {
  try {
    return c.json({ success: true, settings: await loadSettings(c.env) });
  } catch (error) {
    return c.json({ success: false, error: errorMessage(error) }, 500);
  }
});

app.post('/api/settings', async (c) => {
  try {
    const update = parseSettingsUpdate(await c.req.json<unknown>().catch(() => null));
    if (typeof update === 'string') {
      return c.json({ success: false, error: update }, 400);
    }
    const now = Date.now();
    const db = getDb(c.env.DB);
    for (const [key, value] of Object.entries(update)) {
      await db
        .insert(settings)
        .values({ key, value, updated_at: now })
        .onConflictDoUpdate({ target: settings.key, set: { value, updated_at: now } });
    }
    return c.json({ success: true, settings: await loadSettings(c.env) });
  } catch (error) {
    return c.json({ success: false, error: errorMessage(error) }, 500);
  }
});

// Cloudflare Worker Export with both fetch (Web API/UI) and email (Cloudflare Email Routing)
export default {
  // Cron Trigger (every minute, see wrangler.jsonc): snoozed mail whose time has come returns to the inbox.
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): void {
    ctx.waitUntil(returnSnoozedMail(env));
  },

  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Serve API routes with Hono
    if (url.pathname.startsWith('/api')) {
      return app.fetch(request, env, ctx);
    }

    // Serve Static SPA Assets (Vite Client build)
    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response(`${appName(env)} Backend Ready. Build client to see Web UI.`, {
      headers: { 'Content-Type': 'text/plain' }
    });
  },

  // Inbound Email Routing Handler (triggers automatically on incoming emails)
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    try {
      console.log('[edging-mail] Incoming email');
      await parseAndStoreEmail(message.raw, env, {
        envelopeFrom: message.from,
        envelopeTo: message.to
      });
      console.log('[edging-mail] Inbound email successfully processed and stored in D1 & R2');
    } catch (error) {
      // errorMessage drops the SQL parameters (addresses, subject) that a raw Drizzle error carries.
      console.error('[edging-mail] Failed to process inbound email:', errorMessage(error));
      // The sender's server sees this text: no internal details.
      message.setReject('Message could not be processed');
    }
  }
};
