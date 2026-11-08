/**
 * The languages of the app: one row each. Adding a language starts here (docs/i18n.md): a row, a catalogue file `locales/<tag>.json`, a server set
 * `locales/server/<tag>.json`, a column in glossary.json, and a loader line in index.ts. The landing pages have their own list
 * (src/worker/site/languages.ts) because they also carry a path.
 */
interface LanguageRow {
  /** What the app and `<html lang>` call it, and what the server stores for a person. */
  tag: string;
  /** Its own name, as the language pickers show it. Never translated. */
  name: string;
  /** The values of `?lang=` that choose it (lower case). */
  params: readonly string[];
  /** The first part of a browser language that it covers (`zh-TW` and `zh-Hans-CN` are both `zh`). */
  browser: readonly string[];
}

export const LANGUAGES = [
  { tag: 'en', name: 'English', params: ['en'], browser: ['en'] },
  { tag: 'vi', name: 'Tiếng Việt', params: ['vi'], browser: ['vi'] },
  { tag: 'zh-CN', name: '简体中文', params: ['zh', 'zh-cn'], browser: ['zh'] }
] as const satisfies readonly LanguageRow[];

/** A language tag of the app (also what `<html lang>` says). */
export type Locale = (typeof LANGUAGES)[number]['tag'];

export const LOCALES: readonly Locale[] = LANGUAGES.map((language) => language.tag);

/** The source language and the fallback for any key a catalogue lacks. */
export const DEFAULT_LOCALE: Locale = 'en';

/** Each language's own name, as the language pickers show it. Never translated. */
export const LANGUAGE_NAMES = Object.fromEntries(LANGUAGES.map((language) => [language.tag, language.name])) as Readonly<
  Record<Locale, string>
>;

export const isLocale = (value: unknown): value is Locale => typeof value === 'string' && (LOCALES as readonly string[]).includes(value);

const includes = (list: readonly string[], value: string): boolean => list.includes(value);

/** The value of `?lang=` on a link: vi, en, zh or zh-CN (any case). Anything else is not a choice. */
export function localeFromParam(value: string | null | undefined): Locale | undefined {
  const param = value?.trim().toLowerCase();
  return param === undefined ? undefined : LANGUAGES.find((language) => includes(language.params, param))?.tag;
}

/** The first of the browser's languages that the app speaks: vi* is vi, zh* is zh-CN, en* is en. */
export function localeFromBrowser(languages: readonly string[]): Locale | undefined {
  for (const language of languages) {
    const primary = language.trim().toLowerCase().split('-', 1)[0] ?? '';
    const found = LANGUAGES.find((row) => includes(row.browser, primary));
    if (found !== undefined) {
      return found.tag;
    }
  }
  return undefined;
}
