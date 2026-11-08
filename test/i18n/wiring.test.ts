import { describe, expect, it } from 'vitest';
import { LOCALES } from '../../src/shared/i18n/languages';
import serverEn from '../../src/shared/i18n/locales/server/en.json';
import { pushText } from '../../src/worker/security';
import { call, createUser, signIn, userRow } from '../helpers';

// docs/i18n.md, "Adding a language": the app's language list (src/shared/i18n/languages.ts) is the list. The Worker has its own places that must know
// a language too (the settings validator, the database CHECK, the push texts). This test fails, with the language named, when one of them was
// forgotten, instead of the person finding out by getting "language must be ..." when they pick it in Settings.

const serverFiles = import.meta.glob<Record<string, string>>('../../src/shared/i18n/locales/server/*.json', {
  import: 'default',
  eager: true
});
const serverFileOf = (locale: string): Record<string, string> | undefined =>
  Object.entries(serverFiles).find(([path]) => path.endsWith(`/server/${locale}.json`))?.[1];

describe('every language of the app is a language of the Worker', () => {
  it.each(LOCALES)('%s: a person can save it in Settings, and the database keeps it', async (locale) => {
    const member = await createUser('member@example.com');
    const cookie = await signIn(member);
    const saved = await call('/api/settings', { cookie, body: { language: locale } });
    expect(
      [saved.status, saved.json.code],
      `/api/settings refused ${locale}: add it to LANGUAGES in src/worker/auth/accounts.ts and to the CHECK`
    ).toEqual([200, undefined]);
    expect((await userRow(member.id)).language).toBe(locale);
  });

  it.each(LOCALES)('%s: its push notifications are written from its own server file', (locale) => {
    const own = serverFileOf(locale);
    expect(own, `src/shared/i18n/locales/server/${locale}.json`).toBeDefined();
    const kinds = Object.keys(serverEn)
      .map((key) => /^push\.(.+)\.title$/.exec(key)?.[1])
      .filter((kind): kind is string => kind !== undefined);
    expect(kinds.length).toBeGreaterThan(5);
    for (const kind of kinds) {
      const expected = own?.[`push.${kind}.title`] ?? '';
      // A title with a placeholder is filled in by the Worker; one without must come out as the file says.
      if (expected !== '' && !expected.includes('{')) {
        const { title } = pushText(locale, kind as Parameters<typeof pushText>[1], { at: Date.UTC(2026, 10, 7, 9, 30) });
        expect(title, `push.${kind}.title in ${locale}: add the file to CATALOGUES in src/worker/security.ts`).toBe(expected);
      }
    }
  });
});
