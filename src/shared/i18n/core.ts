import type { Locale } from './languages';

/** A flat catalogue: `area.item` -> text with `{name}` placeholders. Plurals are `key#one`, `key#other` and so on. */
export type Catalogue = Readonly<Partial<Record<string, string>>>;

export type Params = Readonly<Record<string, string | number>>;

const PLACEHOLDER = /\{([A-Za-z0-9_]+)\}/g;

/** The names of the placeholders in a text, in order of appearance. */
export const placeholdersOf = (text: string): string[] => Array.from(text.matchAll(PLACEHOLDER), (match) => match[1]);

/** Fills `{name}` from the params. A placeholder with no param stays as written, so a mistake is visible, not silent. */
export function interpolate(template: string, params?: Params): string {
  if (params === undefined) {
    return template;
  }
  return template.replaceAll(PLACEHOLDER, (whole, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : whole));
}

const pluralRules = new Map<Locale, Intl.PluralRules>();

/** The plural category of a count in a language (en: one or other; vi and zh-CN: other only). */
export function pluralCategory(locale: Locale, count: number): Intl.LDMLPluralRule {
  let rules = pluralRules.get(locale);
  if (rules === undefined) {
    rules = new Intl.PluralRules(locale);
    pluralRules.set(locale, rules);
  }
  return rules.select(count);
}

/** The categories a language needs for every plural key (checked by test/i18n). */
export const requiredPluralCategories = (locale: Locale): readonly Intl.LDMLPluralRule[] => [
  ...new Set([0, 1, 2, 3, 5, 11, 21, 100, 1.5].map((count) => pluralCategory(locale, count)))
];

/** The catalogue key of a plural form. */
export const pluralKey = (key: string, category: Intl.LDMLPluralRule): string => `${key}#${category}`;

function lookup(catalogue: Catalogue, locale: Locale, key: string, count: number | undefined): string | undefined {
  if (count !== undefined) {
    const form = catalogue[pluralKey(key, pluralCategory(locale, count))] ?? catalogue[pluralKey(key, 'other')];
    if (form !== undefined) {
      return form;
    }
  }
  return catalogue[key];
}

export interface Catalogues {
  readonly locale: Locale;
  readonly active: Catalogue;
  readonly fallback: Catalogue;
}

/**
 * The text of a key: the active language, else the English source, else the key itself (so a missing key shows up on the
 * screen and in the tests, never as an empty label). A numeric `count` param selects the plural form.
 */
export function resolveMessage(catalogues: Catalogues, key: string, params?: Params): string {
  const count = typeof params?.count === 'number' ? params.count : undefined;
  const template = lookup(catalogues.active, catalogues.locale, key, count) ?? lookup(catalogues.fallback, 'en', key, count) ?? key;
  return interpolate(template, params);
}
