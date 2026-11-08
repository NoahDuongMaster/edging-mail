import { afterEach, describe, expect, it } from 'vitest';
import { interpolate, placeholdersOf, pluralCategory, requiredPluralCategories, resolveMessage } from '../../src/shared/i18n/core';
import { makeFormatters } from '../../src/shared/i18n/format';
import { fmt, getLocale, loadCatalogue, setLocale, t, tDyn } from '../../src/shared/i18n';
import {
  LANGUAGES,
  LANGUAGE_NAMES,
  LOCALES,
  isLocale,
  localeFromBrowser,
  localeFromParam,
  type Locale
} from '../../src/shared/i18n/languages';
import { resolveLanguage } from '../../src/shared/i18n/resolve';

// A language the app does not speak, whatever languages it speaks later: the ISO 639-2 codes qaa to qtz are reserved for local use.
const UNSUPPORTED = ['qaa', 'qab'] as const;

const catalogues = (locale: Locale, active: Record<string, string>, fallback: Record<string, string>) => ({ locale, active, fallback });

describe('interpolate and placeholdersOf', () => {
  it('fills {name} and keeps a placeholder that has no value, so a mistake stays visible', () => {
    expect(interpolate('Hello {name}, you have {count} mail', { name: 'Mai', count: 3 })).toBe('Hello Mai, you have 3 mail');
    expect(interpolate('Hello {name} and {other}', { name: 'Mai' })).toBe('Hello Mai and {other}');
    expect(interpolate('No slots')).toBe('No slots');
  });

  it('lists placeholders in order of appearance', () => {
    expect(placeholdersOf('{b} then {a} then {b}')).toEqual(['b', 'a', 'b']);
    expect(placeholdersOf('plain')).toEqual([]);
  });
});

describe('plurals', () => {
  const en = { 'n#one': '{count} message', 'n#other': '{count} messages', plain: 'Plain' };

  it('uses one and other in English', () => {
    expect(resolveMessage(catalogues('en', en, en), 'n', { count: 1 })).toBe('1 message');
    expect(resolveMessage(catalogues('en', en, en), 'n', { count: 0 })).toBe('0 messages');
    expect(resolveMessage(catalogues('en', en, en), 'n', { count: 7 })).toBe('7 messages');
  });

  it('needs only other in Vietnamese and Chinese', () => {
    expect(requiredPluralCategories('en')).toEqual(expect.arrayContaining(['one', 'other']));
    expect(requiredPluralCategories('vi')).toEqual(['other']);
    expect(requiredPluralCategories('zh-CN')).toEqual(['other']);
    expect(pluralCategory('vi', 1)).toBe('other');
    expect(pluralCategory('zh-CN', 1)).toBe('other');
    const vi = { 'n#other': '{count} thư' };
    expect(resolveMessage(catalogues('vi', vi, en), 'n', { count: 1 })).toBe('1 thư');
  });

  it('does not treat a string count as a plural selector', () => {
    expect(resolveMessage(catalogues('en', en, en), 'plain', { count: '1' })).toBe('Plain');
  });
});

describe('fallback', () => {
  it('uses the English source for a key the language lacks, and the key itself when nobody has it', () => {
    const en = { a: 'Alpha', b: 'Beta' };
    const vi = { a: 'An-pha' };
    expect(resolveMessage(catalogues('vi', vi, en), 'a')).toBe('An-pha');
    expect(resolveMessage(catalogues('vi', vi, en), 'b')).toBe('Beta');
    expect(resolveMessage(catalogues('vi', vi, en), 'missing.key')).toBe('missing.key');
  });
});

describe('language choices', () => {
  it('maps ?lang= values, with zh meaning zh-CN, and ignores anything else', () => {
    expect(localeFromParam('vi')).toBe('vi');
    expect(localeFromParam('EN')).toBe('en');
    expect(localeFromParam('zh')).toBe('zh-CN');
    expect(localeFromParam('zh-CN')).toBe('zh-CN');
    expect(localeFromParam('zh-cn')).toBe('zh-CN');
    expect(localeFromParam(UNSUPPORTED[0])).toBeUndefined();
    expect(localeFromParam('')).toBeUndefined();
    expect(localeFromParam(null)).toBeUndefined();
  });

  it('maps the browser languages: vi* is vi, zh* is zh-CN, en* is en, the first match wins', () => {
    expect(localeFromBrowser([`${UNSUPPORTED[0]}-QQ`, 'vi-VN', 'en'])).toBe('vi');
    expect(localeFromBrowser(['zh-TW'])).toBe('zh-CN');
    expect(localeFromBrowser(['zh-Hans-CN', 'en-US'])).toBe('zh-CN');
    expect(localeFromBrowser(['en-GB'])).toBe('en');
    expect(localeFromBrowser([...UNSUPPORTED])).toBeUndefined();
    expect(localeFromBrowser([])).toBeUndefined();
  });

  it('resolves in the order: account, ?lang=, device choice, browser, organisation default, English', () => {
    const all = { saved: 'zh-CN', search: '?lang=vi', device: 'en', browser: ['vi'], orgDefault: 'en' };
    expect(resolveLanguage(all)).toEqual({ locale: 'zh-CN', source: 'saved' });
    expect(resolveLanguage({ ...all, saved: null })).toEqual({ locale: 'vi', source: 'link' });
    expect(resolveLanguage({ ...all, saved: null, search: '' })).toEqual({ locale: 'en', source: 'device' });
    expect(resolveLanguage({ ...all, saved: null, search: '', device: null })).toEqual({ locale: 'vi', source: 'browser' });
    expect(resolveLanguage({ saved: null, browser: [UNSUPPORTED[0]], orgDefault: 'zh-CN' })).toEqual({
      locale: 'zh-CN',
      source: 'default'
    });
    expect(resolveLanguage({})).toEqual({ locale: 'en', source: 'fallback' });
  });

  it('ignores a value that is not one of the app languages at every step', () => {
    expect(
      resolveLanguage({ saved: UNSUPPORTED[0], search: `?lang=${UNSUPPORTED[1]}`, device: 'xx', browser: [], orgDefault: 'yy' })
    ).toEqual({
      locale: 'en',
      source: 'fallback'
    });
  });
});

describe('the language list (src/shared/i18n/languages.ts)', () => {
  it('has one row per language, with a unique tag and a name in its own language', () => {
    const tags = LANGUAGES.map((row) => row.tag);
    expect(new Set(tags).size).toBe(tags.length);
    expect(LOCALES).toEqual(tags);
    expect(tags[0]).toBe('en');
    for (const row of LANGUAGES) {
      expect(LANGUAGE_NAMES[row.tag], row.tag).toBe(row.name);
      expect(row.name.trim(), row.tag).not.toBe('');
      expect(isLocale(row.tag), row.tag).toBe(true);
    }
  });

  it('lets every row be chosen: by its tag, by each ?lang= value (any case), and by its browser language, and no two rows share one', () => {
    const seen = new Map<string, string>();
    for (const row of LANGUAGES) {
      expect(localeFromParam(row.tag), `?lang=${row.tag}`).toBe(row.tag);
      for (const param of row.params) {
        expect(localeFromParam(param.toUpperCase()), `?lang=${param}`).toBe(row.tag);
        expect(seen.get(`param:${param}`), `?lang=${param} is two languages`).toBeUndefined();
        seen.set(`param:${param}`, row.tag);
      }
      for (const primary of row.browser) {
        expect(localeFromBrowser([`${primary}-XX`]), primary).toBe(row.tag);
        expect(seen.get(`browser:${primary}`), `${primary} is two languages`).toBeUndefined();
        seen.set(`browser:${primary}`, row.tag);
      }
    }
  });
});

describe('formatters follow the language they are given', () => {
  const at = Date.UTC(2026, 10, 7, 9, 30);

  it.each(LOCALES)('formats like Intl does in %s', (locale) => {
    const format = makeFormatters(() => locale);
    expect(format.date(at, { dateStyle: 'long', timeZone: 'UTC' })).toBe(
      new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(at)
    );
    expect(format.time(at, { timeStyle: 'short', timeZone: 'UTC' })).toBe(
      new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone: 'UTC' }).format(at)
    );
    expect(format.number(1_234_567.891)).toBe(new Intl.NumberFormat(locale).format(1_234_567.891));
    expect(format.relative(at - 3 * 3_600_000, at)).toBe(new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-3, 'hour'));
    expect(format.relative(at + 2 * 86_400_000, at)).toBe(new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(2, 'day'));
  });

  it('accepts a Date and an ISO string as well as epoch milliseconds', () => {
    const format = makeFormatters(() => 'en');
    const options = { dateStyle: 'medium', timeZone: 'UTC' } as const;
    expect(format.date(new Date(at), options)).toBe(format.date(at, options));
    expect(format.date(new Date(at).toISOString(), options)).toBe(format.date(at, options));
  });

  it('reads the language at every call', () => {
    let locale: Locale = 'en';
    const format = makeFormatters(() => locale);
    const english = format.number(1234.5);
    locale = 'vi';
    expect(format.number(1234.5)).toBe(new Intl.NumberFormat('vi').format(1234.5));
    expect(format.number(1234.5)).not.toBe(english);
  });
});

describe('the store', () => {
  afterEach(async () => {
    await setLocale('en');
  });

  it('starts in English and switches only after the catalogue is loaded', async () => {
    expect(getLocale()).toBe('en');
    expect(t('folder.inbox')).toBe('Inbox');
    await setLocale('vi');
    expect(getLocale()).toBe('vi');
    expect(t('folder.inbox')).toBe('Hộp thư đến');
    await setLocale('zh-CN');
    expect(t('folder.inbox')).toBe('收件箱');
  });

  it('loads each catalogue once', async () => {
    expect(await loadCatalogue('vi')).toBe(await loadCatalogue('vi'));
  });

  it('puts the language of the screen on <html lang> after its catalogue is loaded (L2)', async () => {
    const page = { lang: 'en' };
    // The tests run in workerd, which has no `document`: a stand-in with the one property the store sets.
    Object.defineProperty(globalThis, 'document', { value: { documentElement: page }, configurable: true });
    try {
      await setLocale('vi');
      expect(page.lang).toBe('vi');
      await setLocale('zh-CN');
      expect(page.lang).toBe('zh-CN');
      await setLocale('en');
      expect(page.lang).toBe('en');
    } finally {
      Reflect.deleteProperty(globalThis, 'document');
    }
  });

  it('answers undefined for a dynamic key nobody has, so the caller can show a generic text', () => {
    expect(tDyn('err.no_such_code_anywhere')).toBeUndefined();
    expect(tDyn('folder.inbox')).toBe('Inbox');
  });

  it('formats with the UI language through fmt', async () => {
    const at = Date.UTC(2026, 10, 7, 9, 30);
    await setLocale('vi');
    expect(fmt.number(1234.5)).toBe(new Intl.NumberFormat('vi').format(1234.5));
    expect(fmt.date(at, { dateStyle: 'long', timeZone: 'UTC' })).toBe(
      new Intl.DateTimeFormat('vi', { dateStyle: 'long', timeZone: 'UTC' }).format(at)
    );
  });
});
