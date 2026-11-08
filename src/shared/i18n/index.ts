import { resolveMessage, type Catalogue, type Params } from './core';
import { makeFormatters } from './format';
import { DEFAULT_LOCALE, type Locale } from './languages';
import en from './locales/en.json';

export { DEFAULT_LOCALE, LANGUAGE_NAMES, LOCALES, isLocale, localeFromBrowser, localeFromParam, type Locale } from './languages';
export type { Catalogue, Params } from './core';
export { resolveLanguage, type LanguageInputs, type LanguageSource } from './resolve';
export { BRAND_NAME, MASCOT_NAME } from './brand';

/** The key of every text the app shows: the keys of en.json, with the plural suffix (`key#one`, `key#other`) removed. */
type PluralBase<K> = K extends `${infer Base}#${'zero' | 'one' | 'two' | 'few' | 'many' | 'other'}` ? Base : K;
export type MessageKey = PluralBase<keyof typeof en>;

export type TFunction = (key: MessageKey, params?: Params) => string;

/** `en` is bundled (it is the fallback and the source); the other languages are separate chunks fetched before first render. */
const loaders: Readonly<Record<Locale, () => Promise<{ default: Catalogue }>>> = {
  en: () => Promise.resolve({ default: en }),
  vi: () => import('./locales/vi.json'),
  'zh-CN': () => import('./locales/zh-CN.json')
};

const loaded = new Map<Locale, Catalogue>([[DEFAULT_LOCALE, en]]);
const listeners = new Set<() => void>();
let current: Locale = DEFAULT_LOCALE;

/** Fetches a language's catalogue once. Rejects when the chunk cannot be loaded (offline and never cached). */
export async function loadCatalogue(locale: Locale): Promise<Catalogue> {
  const known = loaded.get(locale);
  if (known !== undefined) {
    return known;
  }
  const loader = await loaders[locale]();
  const catalogue = loader.default;
  loaded.set(locale, catalogue);
  return catalogue;
}

export const getLocale = (): Locale => current;

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Switches the UI language: loads the catalogue first, so nothing is ever shown half in one language, then tells every
 * subscriber and sets `<html lang>`. A catalogue that cannot be loaded leaves the current language in place and throws.
 */
export async function setLocale(locale: Locale): Promise<void> {
  await loadCatalogue(locale);
  if (locale === current) {
    return;
  }
  current = locale;
  if (typeof document !== 'undefined') {
    document.documentElement.lang = locale;
  }
  for (const listener of listeners) {
    listener();
  }
}

function catalogues(locale: Locale) {
  return { locale, active: loaded.get(locale) ?? en, fallback: en };
}

const translators = new Map<Locale, TFunction>();

/** The translate function of a language, with a stable identity (what `useT()` hands to components). */
export function translatorFor(locale: Locale): TFunction {
  let translate = translators.get(locale);
  if (translate === undefined) {
    translate = (key, params) => resolveMessage(catalogues(locale), key, params);
    translators.set(locale, translate);
  }
  return translate;
}

/** The text of a key in the UI language, `{name}` placeholders filled from `params`, a numeric `count` choosing the plural form. */
export const t: TFunction = (key, params) => translatorFor(current)(key, params);

/**
 * The text of a key built at run time (the dynamic families of families.ts, such as `err.<code>`), or undefined when no
 * catalogue has it, so the caller can show a generic text instead of the bare key.
 */
export function tDyn(key: string, params?: Params): string | undefined {
  const active = loaded.get(current) ?? en;
  const known = key in active || key in en || `${key}#other` in active || `${key}#other` in en;
  return known ? resolveMessage(catalogues(current), key, params) : undefined;
}

/** Dates, times, relative times and numbers in the UI language (never a bare `toLocaleString()`). */
export const fmt = makeFormatters(getLocale);
