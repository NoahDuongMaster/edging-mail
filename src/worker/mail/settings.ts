import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { isLanguage } from '../auth/accounts';
import type { Language } from '../auth/accounts';
import { currentUser } from '../auth/middleware';
import { getDb } from '../db';
import { users } from '../db/schema';
import { apiError } from '../errors';
import { LOCALES } from '../../shared/i18n/languages';
import type { AppEnv } from '../types';
import { errorClass, jsonObject } from '../utils';

export const settingsRoutes = new Hono<AppEnv>();

// Settings are the signed-in person's own: display name, signature, language and the spam filter switch (stored on the user row), plus their primary address,
// which is read-only (it is the sign-in name and the only From address; an admin cannot change it here either). `language` is one of the app's languages
// or null (no choice: the organisation's default applies); it also decides the language of the push notices sent to this person. `spam_filter` is a boolean
// (stored as 1 or 0): on, mail that arrives by email and looks like spam is delivered to the Spam folder.
const FIELDS = ['display_name', 'signature', 'language', 'spam_filter'];
const LANGUAGE_REASON = `language must be ${LOCALES.join(', ')} or null`;

interface Update {
  display_name?: string;
  signature?: string;
  language?: Language | null;
  spam_filter?: 0 | 1;
}

// Returns the validated update, or the reason it was rejected.
function parseSettingsUpdate(body: Record<string, unknown>): Update | string {
  const update: Update = {};
  if (body.display_name !== undefined) {
    const value = typeof body.display_name === 'string' ? body.display_name.trim() : undefined;
    if (value === undefined || value.length > 100 || /[\r\n]/.test(value)) {
      return 'display_name must be a single line of at most 100 characters';
    }
    update.display_name = value;
  }
  if (body.signature !== undefined) {
    if (typeof body.signature !== 'string' || body.signature.length > 2000) {
      return 'signature must be at most 2000 characters';
    }
    update.signature = body.signature;
  }
  if (body.language !== undefined) {
    if (body.language !== null && !isLanguage(body.language)) {
      return LANGUAGE_REASON;
    }
    update.language = body.language;
  }
  if (body.spam_filter !== undefined) {
    if (typeof body.spam_filter !== 'boolean') {
      return 'spam_filter must be true or false';
    }
    update.spam_filter = body.spam_filter ? 1 : 0;
  }
  return update;
}

async function readSettings(db: ReturnType<typeof getDb>, userId: string) {
  const row = await db
    .select({
      display_name: users.display_name,
      signature: users.signature,
      email: users.email,
      language: users.language,
      spam_filter: users.spam_filter
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  return row === undefined ? undefined : { ...row, spam_filter: row.spam_filter === 1 };
}

settingsRoutes.get('/settings', async (c) => {
  try {
    const settings = await readSettings(getDb(c.env.DB), currentUser(c).id);
    return settings === undefined ? apiError(c, 'unauthorized') : c.json({ success: true, settings });
  } catch (error) {
    console.error('[edging-mail] Settings read failed:', errorClass(error));
    return apiError(c, 'server_error');
  }
});

settingsRoutes.post('/settings', async (c) => {
  try {
    const userId = currentUser(c).id;
    const body = await jsonObject<Record<string, unknown>>(c.req, FIELDS);
    if (body === null) {
      return apiError(c, 'invalid_body');
    }
    const update = parseSettingsUpdate(body);
    if (typeof update === 'string') {
      // An unsupported language has its own code, so the client shows its own text for it.
      return apiError(c, update === LANGUAGE_REASON ? 'invalid_language' : 'invalid_request', { error: update });
    }
    const db = getDb(c.env.DB);
    if (Object.keys(update).length > 0) {
      await db
        .update(users)
        .set({ ...update, updated_at: Date.now() })
        .where(eq(users.id, userId));
    }
    const settings = await readSettings(db, userId);
    return settings === undefined ? apiError(c, 'unauthorized') : c.json({ success: true, settings });
  } catch (error) {
    console.error('[edging-mail] Settings save failed:', errorClass(error));
    return apiError(c, 'server_error');
  }
});
