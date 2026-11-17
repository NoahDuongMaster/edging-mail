import { Hono } from 'hono';
import { and, eq } from 'drizzle-orm';
import { currentUser } from './auth/middleware';
import { getDb } from './db';
import { senderPictures, userAvatars } from './db/schema';
import type { AvatarMime } from './db/schema';
import { apiError, failed } from './errors';
import { isUuid } from '../shared/crypto/server';
import { matchesMime, MAX_SENDER_PICTURE_BYTES } from './picture-lookup';
import type { AppEnv } from './types';
import { jsonObject } from './utils';

// Profile pictures. A person has at most one, a small JPEG or WebP the browser made (cropped and scaled) and sent as base64 JSON: no multipart, no
// lookup anywhere else for these, and no SVG (it can carry script). The picture is served from this origin only, by an id that is new at every
// upload, so a browser can keep it for good and an id found in somebody's mail never leads to a later picture of theirs. The same route also serves
// the pictures of outside senders that the Worker looked up while an admin had the `outside_pictures` setting on (pictures.ts; none are looked up
// otherwise). Which mail shows a picture is decided where mail is read (mail/view.ts `withFromAvatar`).

export const avatarRoutes = new Hono<AppEnv>();

/** The most bytes a picture can have. Its base64 text (16000 characters) fits the 16 KiB body cap of the API. */
export const MAX_AVATAR_BYTES = 12_000;

const STANDARD_BASE64 = /^[\d+/A-Za-z]*={0,2}$/;

/** Standard (padded) base64 in its one canonical spelling, as bytes; null for anything else (another alphabet, bad padding, stray bits, too long). */
function decodeBase64(value: string, maxBytes = MAX_AVATAR_BYTES): Uint8Array<ArrayBuffer> | null {
  // The base64 of the most bytes allowed is 16000 characters (a person's own picture): a longer text is refused before anything is decoded.
  if (value.length > Math.ceil(maxBytes / 3) * 4 || value.length % 4 !== 0 || !STANDARD_BASE64.test(value)) {
    return null;
  }
  let bytes: Uint8Array<ArrayBuffer>;
  try {
    bytes = Uint8Array.from(atob(value), (char) => char.codePointAt(0) ?? 0);
  } catch {
    return null;
  }
  return btoa(String.fromCodePoint(...bytes)) === value ? bytes : null;
}

const isAvatarMime = (value: unknown): value is AvatarMime => value === 'image/webp' || value === 'image/jpeg';

// Replaces the caller's picture (a new id every time, also for the same image).
avatarRoutes.put('/avatar', async (c) => {
  try {
    const body = await jsonObject<{ mime?: unknown; data?: unknown }>(c.req, ['mime', 'data']);
    if (body === null) {
      return apiError(c, 'invalid_body');
    }
    const { mime, data } = body;
    const bytes = typeof data === 'string' ? decodeBase64(data) : null;
    if (
      !isAvatarMime(mime) ||
      typeof data !== 'string' ||
      bytes === null ||
      bytes.length === 0 ||
      bytes.length > MAX_AVATAR_BYTES ||
      !matchesMime(mime, bytes)
    ) {
      return apiError(c, 'invalid_avatar');
    }
    const id = crypto.randomUUID();
    const row = { id, mime, data, created_at: Date.now() };
    await getDb(c.env.DB)
      .insert(userAvatars)
      .values({ ...row, user_id: currentUser(c).id })
      .onConflictDoUpdate({ target: userAvatars.user_id, set: row });
    return c.json({ success: true, avatar: id });
  } catch (error) {
    return failed(c, error);
  }
});

// Removes it; nothing to remove is not an error.
avatarRoutes.delete('/avatar', async (c) => {
  try {
    await getDb(c.env.DB)
      .delete(userAvatars)
      .where(eq(userAvatars.user_id, currentUser(c).id));
    return c.json({ success: true, avatar: null });
  } catch (error) {
    return failed(c, error);
  }
});

// Any signed-in person can fetch a picture whose id they know: a person's own picture, or (only while an admin has `outside_pictures` on, otherwise
// the rows are gone) the picture of an outside sender that the Worker looked up. Ids are capabilities: nothing lists them, they cannot be guessed,
// and a person learns one only from their own account or from a message they received. A malformed id and an unknown one answer alike.
avatarRoutes.get('/avatars/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const db = getDb(c.env.DB);
    const own = isUuid(id)
      ? await db.select({ mime: userAvatars.mime, data: userAvatars.data }).from(userAvatars).where(eq(userAvatars.id, id)).get()
      : undefined;
    const outside =
      isUuid(id) && own === undefined
        ? await db
            .select({ mime: senderPictures.mime, data: senderPictures.data })
            .from(senderPictures)
            .where(and(eq(senderPictures.id, id), eq(senderPictures.found, 1)))
            .get()
        : undefined;
    const mime = own?.mime ?? outside?.mime;
    const data = own?.data ?? outside?.data;
    const bytes =
      data === null || data === undefined ? null : decodeBase64(data, own === undefined ? MAX_SENDER_PICTURE_BYTES : MAX_AVATAR_BYTES);
    if (mime === null || mime === undefined || bytes === null) {
      return apiError(c, 'not_found');
    }
    // The id never names other bytes (a new upload, or a changed picture, gets a new id), so the browser can keep the picture for a year. It is an
    // image and nothing else: no sniffing, no script or frame of its own, same-origin only.
    return c.body(bytes, 200, {
      'Content-Type': mime,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Content-Disposition': 'inline'
    });
  } catch (error) {
    return failed(c, error);
  }
});
