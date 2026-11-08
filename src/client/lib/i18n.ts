import { useEffect } from 'react';
import { DEFAULT_LOCALE, isLocale, resolveLanguage, setLocale, type Locale } from '../../shared/i18n';

// The one door of the client to the i18n infrastructure (src/shared/i18n). Components and libraries import from here:
//   const tr = useT();            // in a component (`t` is the theme there, so the translator is `tr`)
//   import { tr } from './i18n';  // in plain code that runs at call time (never at module load: the language can change)
export { t as tr, tDyn, fmt, getLocale, LANGUAGE_NAMES, LOCALES, type Locale, type MessageKey, type TFunction } from '../../shared/i18n';
export { useT, useLocale, useI18n, tRich } from '../../shared/i18n/react';

/** The only localStorage key of the language: the device choice (picker), mirrored from the account language once known. */
export const LANGUAGE_STORAGE_KEY = 'lang';

export function readDeviceLanguage(): string | null {
  try {
    return window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
  } catch {
    // storage blocked (private mode on some browsers): no device choice
    return null;
  }
}

function rememberDeviceLanguage(locale: Locale): void {
  try {
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  } catch {
    // storage blocked: the choice lasts until the page closes
  }
}

/**
 * Before the first render: pick the language from `?lang=`, the device choice and the browser (the account and the organisation
 * default are not known yet) and load its catalogue, so nothing flashes in the wrong language. A catalogue that cannot be
 * loaded (offline, never cached) leaves English in place and the app starts anyway.
 */
export async function initLanguage(): Promise<void> {
  const { locale } = resolveLanguage({ search: window.location.search, device: readDeviceLanguage(), browser: navigator.languages });
  document.documentElement.lang = DEFAULT_LOCALE;
  try {
    await setLocale(locale);
  } catch (error) {
    console.error('Language catalogue not loaded, staying in English', error);
  }
}

/** The picker or Settings chose a language: apply it now and remember it on this device. Resolves false when it could not be loaded. */
export async function chooseLanguage(locale: Locale): Promise<boolean> {
  try {
    await setLocale(locale);
  } catch (error) {
    console.error('Language catalogue not loaded', error);
    return false;
  }
  rememberDeviceLanguage(locale);
  return true;
}

/** What the session says about language (GET /api/auth/session: the account's own, and the organisation default). */
export interface SessionLanguage {
  readonly language?: string | null;
  readonly default_language?: string | null;
}

/**
 * Once the session is known: the account language wins over everything; the organisation default is the last resort. The
 * account language is mirrored to the device so the next start has no flash.
 */
export function useLanguageSync(session: SessionLanguage | undefined): void {
  const saved = session?.language;
  const orgDefault = session?.default_language;
  useEffect(() => {
    if (session === undefined) {
      return;
    }
    const { locale } = resolveLanguage({
      saved,
      search: window.location.search,
      device: readDeviceLanguage(),
      browser: navigator.languages,
      orgDefault
    });
    void setLocale(locale).then(
      () => {
        if (isLocale(saved)) {
          rememberDeviceLanguage(saved);
        }
      },
      (error: unknown) => console.error('Language catalogue not loaded', error)
    );
  }, [session === undefined, saved, orgDefault]); // eslint-disable-line react-hooks/exhaustive-deps -- `session` itself is only a presence check
}
