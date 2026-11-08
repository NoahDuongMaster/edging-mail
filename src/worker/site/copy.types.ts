/** Shape of the landing page text. One module per language (copy.vi.ts, copy.en.ts, copy.zh.ts) fills it, one template renders it. */

/** The `lang` of each landing page: what the page's <html lang> says and what search engines call the language. */
export type LandingLang = 'vi' | 'en' | 'zh-CN';

/** Where each language lives on the site. */
export type LandingPath = '/' | '/en/' | '/zh/';

export interface Card {
  readonly title: string;
  readonly text: string;
}

export interface Question {
  readonly question: string;
  readonly answer: string;
}

export interface LandingCopy {
  readonly lang: LandingLang;
  readonly path: LandingPath;
  /** <title> and meta description. Limits in characters: vi and en 60 and 160, zh 30 and 80 (test/site checks them). */
  readonly meta: { readonly title: string; readonly description: string };
  /** Open Graph / Twitter card text. */
  readonly og: { readonly title: string; readonly description: string };
  /** Words around the page that are not marketing copy. */
  readonly chrome: { readonly skipLink: string; readonly githubLink: string; readonly licenseLink: string };
  /** The two buttons shown in the hero and again at the end. */
  readonly cta: { readonly signIn: string; readonly deploy: string; readonly deployNote?: string };
  readonly hero: { readonly h1: string; readonly subline: string; readonly mascotAlt: string };
  readonly benefits: { readonly h2: string; readonly cards: readonly Card[] };
  readonly features: { readonly h2: string; readonly cards: readonly Card[] };
  readonly how: { readonly h2: string; readonly lead: string; readonly steps: readonly Card[] };
  readonly security: {
    readonly h2: string;
    /** Each group is a titled list (h3 + bullets). */
    readonly groups: readonly { readonly title: string; readonly items: readonly string[] }[];
    /** The sentence under the groups about what encryption does not cover. */
    readonly closing: string;
  };
  readonly faq: { readonly h2: string; readonly lead: string; readonly items: readonly Question[] };
  readonly closing: { readonly h2: string; readonly text: string };
  readonly footer: { readonly text: string };
}
