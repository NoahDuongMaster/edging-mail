import type { LandingLang, LandingPath } from './copy.types';

/**
 * The languages of the public site, in the order the language switch lists them. `label` is the language's own name (the
 * switch never translates it), `locale` the Open Graph locale, `app` the value of `?lang=` that the sign-in button hands to
 * the app (the app's own language list is vi / en / zh).
 */
export interface Language {
  readonly lang: LandingLang;
  readonly path: LandingPath;
  readonly label: string;
  readonly locale: string;
  readonly app: 'vi' | 'en' | 'zh';
}

export const LANGUAGES: readonly Language[] = [
  { lang: 'vi', path: '/', label: 'Tiếng Việt', locale: 'vi_VN', app: 'vi' },
  { lang: 'en', path: '/en/', label: 'English', locale: 'en_US', app: 'en' },
  { lang: 'zh-CN', path: '/zh/', label: '简体中文', locale: 'zh_CN', app: 'zh' }
];

export function languageOf(lang: LandingLang): Language {
  const found = LANGUAGES.find((language) => language.lang === lang);
  if (found === undefined) {
    throw new Error(`Unknown landing language ${lang}`);
  }
  return found;
}
