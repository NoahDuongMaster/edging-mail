import { DEFAULT_LOCALE, isLocale, localeFromBrowser, localeFromParam, type Locale } from './languages';

/** Where the language of the screen came from, in the order that wins (design.md section 20.1). */
export type LanguageSource = 'saved' | 'link' | 'device' | 'browser' | 'default' | 'fallback';

export interface LanguageInputs {
  /** `user.language` of the signed-in account. */
  readonly saved?: string | null;
  /** The query string of the page (`?lang=`). */
  readonly search?: string;
  /** The device choice from the picker, kept in localStorage under the key `lang`. */
  readonly device?: string | null;
  /** navigator.languages. */
  readonly browser?: readonly string[];
  /** The organisation default from GET /api/auth/session (`default_language`). */
  readonly orgDefault?: string | null;
}

export interface ResolvedLanguage {
  readonly locale: Locale;
  readonly source: LanguageSource;
}

/**
 * Account language, then an explicit `?lang=` link, then the device choice, then the browser, then the organisation default,
 * then English. A `?lang=` link alone is never saved; the picker's choice is the device choice.
 */
export function resolveLanguage(inputs: LanguageInputs): ResolvedLanguage {
  if (isLocale(inputs.saved)) {
    return { locale: inputs.saved, source: 'saved' };
  }
  const link = localeFromParam(new URLSearchParams(inputs.search ?? '').get('lang'));
  if (link !== undefined) {
    return { locale: link, source: 'link' };
  }
  if (isLocale(inputs.device)) {
    return { locale: inputs.device, source: 'device' };
  }
  const browser = localeFromBrowser(inputs.browser ?? []);
  if (browser !== undefined) {
    return { locale: browser, source: 'browser' };
  }
  if (isLocale(inputs.orgDefault)) {
    return { locale: inputs.orgDefault, source: 'default' };
  }
  return { locale: DEFAULT_LOCALE, source: 'fallback' };
}
