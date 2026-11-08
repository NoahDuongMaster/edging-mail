import { Hono } from 'hono';
import { and, eq, getTableColumns } from 'drizzle-orm';
import { currentUser } from '../auth/middleware';
import { getBlob } from '../content';
import { getDb } from '../db';
import { attachments, messages, users } from '../db/schema';
import { userRecipient } from './recipient';
import { broadcast } from '../realtime';
import { SendError, sendEmail } from '../services/email-sender';
import type { AppEnv, SendEmailPayload } from '../types';
import { errorClass, jsonObject, nonEmpty } from '../utils';
import { ownedBy } from './view';
import { apiError, failed, statusError } from '../errors';

export const transferRoutes = new Hono<AppEnv>();

// Outbound Send Email. The sender is always the signed-in user: their primary address and display name. A request that names
// another From address is refused and nothing is sent or stored; naming their own address (or none) is fine.
transferRoutes.post('/messages/send', async (c) => {
  try {
    const user = currentUser(c);
    const body = await jsonObject<SendEmailPayload>(c.req, [
      'from',
      'to',
      'cc',
      'bcc',
      'reply_to',
      'in_reply_to',
      'references',
      'draft_id',
      'subject',
      'text',
      'html',
      'attachments'
    ]);
    if (body === null) {
      return apiError(c, 'invalid_body');
    }
    const requestedFrom = typeof body.from === 'string' ? body.from.trim() : '';
    if (requestedFrom !== '' && requestedFrom.toLowerCase() !== user.email) {
      return apiError(c, 'from_not_allowed');
    }
    if ((!Array.isArray(body.to) && !body.to) || !body.subject) {
      return apiError(c, 'invalid_request', { error: 'to and subject are required' });
    }

    // The user's own key seals the copy kept in Sent. A signed-in user always has one (the key setup gate), so none is a server fault.
    const row = await getDb(c.env.DB).select({ public_key: users.public_key }).from(users).where(eq(users.id, user.id)).get();
    const recipient = await userRecipient(row?.public_key ?? null);
    if (recipient === undefined) {
      return apiError(c, 'key_setup_required');
    }
    const res = await sendEmail(body, c.env, { address: user.email, name: nonEmpty(user.display_name) ?? null }, user.id, recipient);
    c.executionCtx.waitUntil(broadcast(c.env, user.id, { type: 'mail.changed' }));
    return c.json({ success: true, message: res.message, note: res.note });
  } catch (error) {
    if (error instanceof SendError) {
      return statusError(c, error.status, error.message);
    }
    return failed(c, error);
  }
});

// Download Attachment from R2
const DOWNLOAD_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Cache-Control': 'private, no-store'
};
transferRoutes.get('/attachments/:id', async (c) => {
  try {
    const id = c.req.param('id');
    // Ownership is decided in D1 (through the mail the attachment belongs to) before R2 is touched.
    const attachment = await getDb(c.env.DB)
      .select(getTableColumns(attachments))
      .from(attachments)
      .innerJoin(messages, eq(messages.id, attachments.message_id))
      .where(and(eq(attachments.id, id), ownedBy(currentUser(c).id)))
      .get();

    if (!attachment || attachment.r2_key === '') {
      return c.text('Attachment not found', 404);
    }

    const object = await getBlob(c.env, attachment.r2_key);
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
    console.error('[edging-mail] Could not read an attachment:', errorClass(error));
    return c.text('Attachment could not be read', 500);
  }
});

// Download Raw EML from R2
transferRoutes.get('/raw/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const message = await getDb(c.env.DB)
      .select({ r2_key: messages.r2_key, enc_fmt: messages.enc_fmt })
      .from(messages)
      .where(and(eq(messages.id, id), ownedBy(currentUser(c).id)))
      .get();

    const r2Key = nonEmpty(message?.r2_key);
    if (r2Key === undefined) {
      return c.text('Raw email not found', 404);
    }

    const object = await getBlob(c.env, r2Key);
    if (!object) {
      return c.text('EML object not found in storage', 404);
    }

    const headers = new Headers(DOWNLOAD_HEADERS);
    // An encrypted copy is opaque bytes; only a legacy plaintext one is still a mail the browser can recognise.
    headers.set('Content-Type', message?.enc_fmt === 0 ? 'message/rfc822' : 'application/octet-stream');
    headers.set('Content-Disposition', `attachment; filename="email-${id}.eml"`);
    return new Response(object.body, { headers });
  } catch (error) {
    console.error('[edging-mail] Could not read a raw message:', errorClass(error));
    return c.text('Raw message could not be read', 500);
  }
});
