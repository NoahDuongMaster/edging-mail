import { env } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '../src/shared/i18n/languages';
import { LANGUAGES } from '../src/worker/auth/accounts';
import { settings, users } from '../src/worker/db/schema';
import { LANGUAGE_CHOICES } from '../src/worker/errors';
import { authFor, call, createUser, db, setupKeys, signIn, userRow } from './helpers';

// Addendum 4.6 L2: the person's language is saved on the server; the organisation default is public (the sign-in screens use it).

interface SessionAnswer {
  authenticated: boolean;
  language?: string | null;
  default_language?: string;
}

describe('language', () => {
  it("shows the organisation default signed out, and the person's own choice (null until made) signed in", async () => {
    expect((await call<SessionAnswer>('/api/auth/session')).json).toMatchObject({ authenticated: false, default_language: 'en' });
    const member = await createUser('member@example.com');
    const cookie = await signIn(member);
    expect((await call<SessionAnswer>('/api/auth/session', { cookie })).json).toMatchObject({
      authenticated: true,
      language: null,
      default_language: 'en'
    });
    await db().insert(settings).values({ key: 'default_language', value: 'vi', updated_at: Date.now() });
    expect((await call<SessionAnswer>('/api/auth/session')).json.default_language).toBe('vi');
  });

  it('saves the choice with the settings, follows the person to every session, and can be cleared', async () => {
    const member = await createUser('member@example.com');
    const cookie = await signIn(member);
    const saved = await call('/api/settings', { cookie, body: { language: 'zh-CN' } });
    expect(saved.json).toMatchObject({ success: true, settings: { language: 'zh-CN', email: member.email } });
    expect((await userRow(member.id)).language).toBe('zh-CN');
    const another = await signIn(member, '198.51.100.44');
    expect((await call<SessionAnswer>('/api/auth/session', { cookie: another })).json.language).toBe('zh-CN');
    expect((await call('/api/settings', { cookie, body: { language: null } })).json).toMatchObject({ settings: { language: null } });
    expect((await userRow(member.id)).language).toBeNull();
  });

  it("offers exactly the languages of the app's list (src/shared/i18n/languages.ts), with no second list in the database", async () => {
    expect(LANGUAGES).toBe(LOCALES);
    const member = await createUser('member@example.com');
    const cookie = await signIn(member);
    for (const tag of LOCALES) {
      expect((await call('/api/settings', { cookie, body: { language: tag } })).status, tag).toBe(200);
      expect((await userRow(member.id)).language).toBe(tag);
    }
    // The column itself takes any text (no CHECK): the routes are the only check, so a new language needs no migration.
    await env.DB.prepare('UPDATE users SET language = ? WHERE id = ?').bind('qaa', member.id).run();
    expect((await userRow(member.id)).language).toBe('qaa');
  });

  it('refuses a language that is not offered, and leaves the saved one alone', async () => {
    const member = await createUser('member@example.com');
    const cookie = await signIn(member);
    await call('/api/settings', { cookie, body: { language: 'vi' } });
    for (const language of ['qaa', 'zh', 'VI', '', 1, true, ['vi']]) {
      const refused = await call('/api/settings', { cookie, body: { language } });
      expect([refused.status, refused.json.code], String(language)).toEqual([400, 'invalid_language']);
    }
    // another bad field keeps the general code
    expect((await call('/api/settings', { cookie, body: { display_name: 'a\nb' } })).json).toMatchObject({ code: 'invalid_request' });
    expect((await userRow(member.id)).language).toBe('vi');
    expect(await db().select().from(settings).where(eq(settings.key, 'default_language'))).toEqual([]);
  });

  it('answers Setup with an unsupported language by the same code, and creates nothing', async () => {
    for (const language of ['qaa', 'zh', 'EN', '', 7]) {
      const refused = await call('/api/auth/setup', {
        body: {
          setup_key: env.APP_PASSWORD,
          email: 'admin@example.com',
          display_name: 'Admin',
          auth: await authFor('admin@example.com', 'a long enough password'),
          kdf: 1,
          keys: await setupKeys('admin@example.com'),
          language
        }
      });
      expect([refused.status, refused.json.code], String(language)).toEqual([400, 'invalid_language']);
    }
    expect(await db().select().from(users)).toEqual([]);
  });

  it('names every language of the list in the three English sentences that list them, so a new language touches none of them', async () => {
    const named = (text: unknown): boolean => typeof text === 'string' && LOCALES.every((tag) => text.includes(tag));
    expect(LANGUAGE_CHOICES).toBe(`${LOCALES.slice(0, -1).join(', ')} or ${LOCALES.slice(-1).join('')}`);

    const member = await createUser('member@example.com');
    const settingsAnswer = await call('/api/settings', { cookie: await signIn(member), body: { language: 'qaa' } });
    expect(settingsAnswer.json.code).toBe('invalid_language');
    expect(named(settingsAnswer.json.error), String(settingsAnswer.json.error)).toBe(true);

    const admin = await createUser('boss@example.com', { role: 'admin' });
    const adminAnswer = await call('/api/admin/settings', {
      method: 'PUT',
      cookie: await signIn(admin),
      body: { default_language: 'qaa' }
    });
    expect(adminAnswer.json.code).toBe('invalid_language');
    expect(named(adminAnswer.json.error), String(adminAnswer.json.error)).toBe(true);
    expect(adminAnswer.json.error).toBe(`language must be ${LANGUAGE_CHOICES}`);

    const setupAnswer = await call('/api/auth/setup', {
      body: {
        setup_key: env.APP_PASSWORD,
        email: 'first@example.com',
        display_name: 'First',
        auth: await authFor('first@example.com', 'a long enough password'),
        kdf: 1,
        keys: await setupKeys('first@example.com'),
        language: 'qaa'
      }
    });
    expect(setupAnswer.json.code).toBe('invalid_language');
    expect(setupAnswer.json.error).toBe(`language must be ${LANGUAGE_CHOICES}`);
  });
});
