import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, Message, BatchActionPayload, SendEmailPayload } from './types';
import { parseAndStoreEmail } from './services/email-parser';
import { sendEmail } from './services/email-sender';

const app = new Hono<{ Bindings: Env }>();

// Global middleware
app.use('/api/*', cors());

// Health & Info
app.get('/api/health', (c) => {
  return c.json({
    status: 'ok',
    app: c.env.APP_NAME || 'Edging Mail',
    edge: 'Cloudflare Workers',
    timestamp: Date.now()
  });
});

// Folder & Unread Stats
app.get('/api/stats', async (c) => {
  try {
    const result = await c.env.DB.prepare(`
      SELECT folder, COUNT(*) as total, SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread
      FROM messages
      GROUP BY folder
    `).all();

    const starred = await c.env.DB.prepare(`
      SELECT COUNT(*) as total, SUM(CASE WHEN is_read = 0 THEN 1 ELSE 0 END) as unread
      FROM messages
      WHERE is_starred = 1 AND folder != 'trash'
    `).first();

    const folderStats: Record<string, { total: number; unread: number }> = {
      inbox: { total: 0, unread: 0 },
      sent: { total: 0, unread: 0 },
      starred: { total: Number(starred?.total || 0), unread: Number(starred?.unread || 0) },
      archive: { total: 0, unread: 0 },
      spam: { total: 0, unread: 0 },
      trash: { total: 0, unread: 0 }
    };

    if (result.results) {
      for (const row of result.results as any[]) {
        if (folderStats[row.folder]) {
          folderStats[row.folder] = {
            total: Number(row.total || 0),
            unread: Number(row.unread || 0)
          };
        }
      }
    }

    return c.json({ success: true, stats: folderStats });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// List Messages with Pagination, Folder and Search filter
app.get('/api/messages', async (c) => {
  try {
    const folder = c.req.query('folder') || 'inbox';
    const search = c.req.query('q')?.trim() || '';
    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '30', 10)));
    const offset = (page - 1) * limit;

    let query = 'SELECT * FROM messages WHERE ';
    const params: any[] = [];

    if (folder === 'starred') {
      query += "is_starred = 1 AND folder != 'trash'";
    } else {
      query += 'folder = ?';
      params.push(folder);
    }

    if (search) {
      query += ' AND (subject LIKE ? OR from_address LIKE ? OR to_address LIKE ? OR snippet LIKE ?)';
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern, pattern);
    }

    query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const { results } = await c.env.DB.prepare(query).bind(...params).all();

    return c.json({
      success: true,
      messages: results || [],
      page,
      limit
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Get Single Message Detail + Attachments + Mark Read
app.get('/api/messages/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const message = await c.env.DB.prepare(
      'SELECT * FROM messages WHERE id = ?'
    ).bind(id).first<Message>();

    if (!message) {
      return c.json({ success: false, error: 'Message not found' }, 404);
    }

    // Mark as read
    if (message.is_read === 0) {
      await c.env.DB.prepare(
        'UPDATE messages SET is_read = 1, updated_at = ? WHERE id = ?'
      ).bind(Date.now(), id).run();
      message.is_read = 1;
    }

    // Fetch attachments
    const { results: attachments } = await c.env.DB.prepare(
      'SELECT * FROM attachments WHERE message_id = ? ORDER BY created_at ASC'
    ).bind(id).all();

    return c.json({
      success: true,
      message,
      attachments: attachments || []
    });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Batch Actions (read, unread, star, unstar, trash, archive, restore, delete)
app.post('/api/messages/batch', async (c) => {
  try {
    const body = await c.req.json<BatchActionPayload>();
    const { message_ids, action } = body;

    if (!message_ids || !Array.isArray(message_ids) || message_ids.length === 0) {
      return c.json({ success: false, error: 'message_ids array is required' }, 400);
    }

    const now = Date.now();
    const placeholders = message_ids.map(() => '?').join(',');

    switch (action) {
      case 'read':
        await c.env.DB.prepare(
          `UPDATE messages SET is_read = 1, updated_at = ? WHERE id IN (${placeholders})`
        ).bind(now, ...message_ids).run();
        break;
      case 'unread':
        await c.env.DB.prepare(
          `UPDATE messages SET is_read = 0, updated_at = ? WHERE id IN (${placeholders})`
        ).bind(now, ...message_ids).run();
        break;
      case 'star':
        await c.env.DB.prepare(
          `UPDATE messages SET is_starred = 1, updated_at = ? WHERE id IN (${placeholders})`
        ).bind(now, ...message_ids).run();
        break;
      case 'unstar':
        await c.env.DB.prepare(
          `UPDATE messages SET is_starred = 0, updated_at = ? WHERE id IN (${placeholders})`
        ).bind(now, ...message_ids).run();
        break;
      case 'trash':
        await c.env.DB.prepare(
          `UPDATE messages SET folder = 'trash', updated_at = ? WHERE id IN (${placeholders})`
        ).bind(now, ...message_ids).run();
        break;
      case 'archive':
        await c.env.DB.prepare(
          `UPDATE messages SET folder = 'archive', updated_at = ? WHERE id IN (${placeholders})`
        ).bind(now, ...message_ids).run();
        break;
      case 'restore':
        await c.env.DB.prepare(
          `UPDATE messages SET folder = 'inbox', updated_at = ? WHERE id IN (${placeholders})`
        ).bind(now, ...message_ids).run();
        break;
      case 'delete':
        // Permanent deletion: clean up attachments & R2 keys
        const { results: atts } = await c.env.DB.prepare(
          `SELECT r2_key FROM attachments WHERE message_id IN (${placeholders})`
        ).bind(...message_ids).all();
        const { results: msgs } = await c.env.DB.prepare(
          `SELECT r2_key FROM messages WHERE id IN (${placeholders})`
        ).bind(...message_ids).all();

        if (c.env.BUCKET) {
          const keysToDelete = [
            ...(atts || []).map((a: any) => a.r2_key).filter(Boolean),
            ...(msgs || []).map((m: any) => m.r2_key).filter(Boolean)
          ];
          await Promise.allSettled(keysToDelete.map(k => c.env.BUCKET.delete(k)));
        }

        await c.env.DB.prepare(
          `DELETE FROM attachments WHERE message_id IN (${placeholders})`
        ).bind(...message_ids).run();
        await c.env.DB.prepare(
          `DELETE FROM messages WHERE id IN (${placeholders})`
        ).bind(...message_ids).run();
        break;
      default:
        return c.json({ success: false, error: 'Invalid action' }, 400);
    }

    return c.json({ success: true, count: message_ids.length });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Outbound Send Email
app.post('/api/messages/send', async (c) => {
  try {
    const body = await c.req.json<SendEmailPayload>();
    if (!body.to || !body.from || !body.subject) {
      return c.json({ success: false, error: 'to, from, and subject are required' }, 400);
    }

    const res = await sendEmail(body, c.env);
    return c.json({ success: true, message: res.message, note: res.note });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Download Attachment from R2
app.get('/api/attachments/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const attachment = await c.env.DB.prepare(
      'SELECT * FROM attachments WHERE id = ?'
    ).bind(id).first<any>();

    if (!attachment || !attachment.r2_key) {
      return c.text('Attachment not found', 404);
    }

    const object = await c.env.BUCKET.get(attachment.r2_key);
    if (!object) {
      return c.text('Attachment file not found in storage', 404);
    }

    const headers = new Headers();
    headers.set('Content-Type', attachment.mime_type || 'application/octet-stream');
    headers.set(
      'Content-Disposition',
      `inline; filename="${encodeURIComponent(attachment.filename)}"`
    );
    return new Response(object.body as any, { headers });
  } catch (error: any) {
    return c.text(`Error: ${error.message}`, 500);
  }
});

// Download Raw EML from R2
app.get('/api/raw/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const message = await c.env.DB.prepare(
      'SELECT r2_key, subject FROM messages WHERE id = ?'
    ).bind(id).first<any>();

    if (!message || !message.r2_key) {
      return c.text('Raw email not found', 404);
    }

    const object = await c.env.BUCKET.get(message.r2_key);
    if (!object) {
      return c.text('EML object not found in storage', 404);
    }

    const headers = new Headers();
    headers.set('Content-Type', 'message/rfc822');
    headers.set('Content-Disposition', `attachment; filename="email-${id}.eml"`);
    return new Response(object.body as any, { headers });
  } catch (error: any) {
    return c.text(`Error: ${error.message}`, 500);
  }
});

// Settings endpoints
app.get('/api/settings', async (c) => {
  try {
    const { results } = await c.env.DB.prepare('SELECT key, value FROM settings').all();
    const settings: Record<string, string> = {};
    for (const r of (results || []) as any[]) {
      settings[r.key] = r.value;
    }
    return c.json({ success: true, settings });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

app.post('/api/settings', async (c) => {
  try {
    const body = await c.req.json<Record<string, string>>();
    const now = Date.now();
    for (const [key, value] of Object.entries(body)) {
      await c.env.DB.prepare(
        'INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
      ).bind(key, value, now).run();
    }
    return c.json({ success: true });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Simulate Inbound Email (for local dev / demo without live MX records)
app.post('/api/debug/simulate-inbound', async (c) => {
  try {
    const body = await c.req.json<{
      from: string;
      from_name?: string;
      to: string;
      subject: string;
      body_text?: string;
      body_html?: string;
    }>();

    const id = crypto.randomUUID();
    const now = Date.now();
    const fromAddr = body.from || 'test@cloudflare.com';
    const fromName = body.from_name || 'Cloudflare Dev';
    const toAddr = body.to || 'me@edgingmail.internal';
    const subject = body.subject || 'Hello from the Edge!';
    const text = body.body_text || 'This email was generated on Cloudflare Edge using edging-mail.';
    const html = body.body_html || `<div style="font-family: sans-serif; padding: 20px;">
      <h2 style="color: #f6821f;">⚡ Welcome to edging-mail!</h2>
      <p>This is a simulated incoming email stored in Cloudflare D1 and R2.</p>
      <p>${text}</p>
      <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
      <p style="color: #888; font-size: 12px;">Running 100% on Cloudflare Workers, D1, R2, and Email Routing.</p>
    </div>`;

    const snippet = text.slice(0, 160);
    const rawKey = `raw/${id}.eml`;
    const rawEml = `From: "${fromName}" <${fromAddr}>\r\nTo: <${toAddr}>\r\nSubject: ${subject}\r\nDate: ${new Date().toUTCString()}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${html}`;

    if (c.env.BUCKET) {
      await c.env.BUCKET.put(rawKey, rawEml, {
        httpMetadata: { contentType: 'message/rfc822' }
      });
    }

    const message: Message = {
      id,
      message_id: `<${id}@simulation>`,
      thread_id: id,
      from_address: fromAddr,
      from_name: fromName,
      to_address: toAddr,
      cc: null,
      bcc: null,
      reply_to: null,
      subject,
      snippet,
      body_text: text,
      body_html: html,
      r2_key: rawKey,
      folder: 'inbox',
      is_read: 0,
      is_starred: 0,
      has_attachments: 0,
      size: rawEml.length,
      created_at: now,
      updated_at: now
    };

    await c.env.DB.prepare(`
      INSERT INTO messages (
        id, message_id, thread_id, from_address, from_name, to_address, cc, bcc,
        reply_to, subject, snippet, body_text, body_html, r2_key, folder,
        is_read, is_starred, has_attachments, size, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      message.id, message.message_id, message.thread_id, message.from_address, message.from_name,
      message.to_address, message.cc, message.bcc, message.reply_to, message.subject,
      message.snippet, message.body_text, message.body_html, message.r2_key, message.folder,
      message.is_read, message.is_starred, message.has_attachments, message.size,
      message.created_at, message.updated_at
    ).run();

    return c.json({ success: true, message });
  } catch (error: any) {
    return c.json({ success: false, error: error.message }, 500);
  }
});

// Cloudflare Worker Export with both fetch (Web API/UI) and email (Cloudflare Email Routing)
export default {
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

    return new Response('Edging Mail Backend Ready. Build client to see Web UI.', {
      headers: { 'Content-Type': 'text/plain' }
    });
  },

  // Inbound Email Routing Handler (triggers automatically on incoming emails)
  async email(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext): Promise<void> {
    try {
      console.log(`[edging-mail] Incoming email from ${message.from} to ${message.to}`);
      await parseAndStoreEmail(message.raw, env, {
        envelopeFrom: message.from,
        envelopeTo: message.to
      });
      console.log('[edging-mail] Inbound email successfully processed and stored in D1 & R2');
    } catch (err) {
      console.error('[edging-mail] Failed to process inbound email:', err);
      // Set email message reject if desired, or let it fail
      message.setReject(`Failed to process message on edge: ${(err as Error).message}`);
    }
  }
};
