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

/** A box of the security diagram: what the part is called, the one line about what it does with the mail, and its short tag. */
export interface DiagramNode {
  readonly title: string;
  readonly text: string;
  /** What the part can do with the key or the mail, in a few words (holds the key, can seal but cannot open, stores ciphertext). */
  readonly tag: string;
}

/**
 * The sample senders of the product fragments (sample data: the names are the same in every language, only their subjects are
 * translated). Sam, who owns the mailbox of the fragments, is not one of them.
 */
export type SampleSender =
  'lena' | 'daniel' | 'hana' | 'marco' | 'aisha' | 'omar' | 'grace' | 'ben' | 'elena' | 'lucas' | 'jonas' | 'priya' | 'tom';

/**
 * The small words of the page design that are not marketing copy: navigation, section labels, the captions of the diagram and of
 * the code block, and the product words inside the decorative fragments of the app (folder names and buttons as the glossary
 * writes them, test/i18n/landing-glossary.test.ts checks them). People's names in the fragments are sample data and never change.
 */
export interface LandingUi {
  /** The section links of the top bar (and of its phone menu). `label` names that navigation for screen readers. */
  readonly nav: {
    readonly label: string;
    readonly features: string;
    readonly security: string;
    readonly how: string;
    readonly faq: string;
    readonly menu: string;
  };
  /** The small label above each section heading. */
  readonly eyebrows: {
    readonly benefits: string;
    readonly features: string;
    readonly how: string;
    readonly security: string;
    readonly faq: string;
  };
  /** The two facts in pills above the headline (licence, platform). */
  readonly heroPills: readonly [string, string];
  /** The label in front of the Cloudflare products under the hero. */
  readonly builtOn: string;
  /** The example domain the copy itself uses (yourcompany.com, congty.com): addresses in the fragments are on it. */
  readonly sampleDomain: string;
  /**
   * Sample subjects of the message rows in the fragments, one per sample sender. Each fragment shows other people and other mail
   * (the mailbox, the reply window, the notification, the phone and the admin table are not one inbox seen five times), and none
   * of them repeats the product screenshot. Sample UI only, not a claim.
   */
  readonly sampleSubjects: Readonly<Record<SampleSender, string>>;
  /** The opening lines of Lena's open message to Sam in the mailbox fragment, and Sam's reply to Aisha in the reply window (sample UI). */
  readonly sampleBody: string;
  readonly sampleReply: string;
  /** Folder names in the fragments, exactly the glossary's. */
  readonly folders: {
    readonly inbox: string;
    readonly starred: string;
    readonly snoozed: string;
    readonly sent: string;
    readonly drafts: string;
    readonly archive: string;
    readonly spam: string;
    readonly trash: string;
  };
  /** Words of the app inside the fragments (buttons and labels as the glossary writes them, plus a few captions). */
  readonly words: {
    readonly compose: string;
    readonly reply: string;
    readonly forward: string;
    readonly send: string;
    readonly to: string;
    readonly subject: string;
    readonly attachments: string;
    readonly search: string;
    readonly alias: string;
    readonly admin: string;
    readonly member: string;
    readonly auditLog: string;
    readonly adminConsole: string;
    readonly name: string;
    readonly address: string;
    readonly role: string;
    readonly newMail: string;
    readonly yourKey: string;
    readonly encryptedWithKey: string;
    readonly cloudflareAccount: string;
    /** The audit-log line of the admin fragment: "<name> added an alias <address>". */
    readonly aliasAdded: string;
    /** What a company does not have to run: mail server, container, queue (the benefit card's own words). */
    readonly notNeeded: readonly [string, string, string];
  };
  /** The deploy commands block: its tab title, one comment per group of commands, and the link to the guide under it. */
  readonly code: {
    readonly title: string;
    /** The line above the terminal that places it before step 1 (the IT person's deploy). */
    readonly caption: string;
    readonly comments: readonly [string, string, string, string];
    readonly guideLink: string;
  };
  /** The security diagram: its caption and the three parts the mail goes through. */
  readonly diagram: {
    readonly caption: string;
    readonly browser: DiagramNode;
    readonly worker: DiagramNode;
    readonly storage: DiagramNode;
  };
  /** Names of the two marks in the security lists: a guarantee (check) and a limit (info). */
  readonly legend: { readonly protected: string; readonly limit: string };
  /** Column titles and the guide link of the footer (the language column reuses `chrome.languageLabel`). */
  readonly footer: { readonly product: string; readonly project: string; readonly deployGuide: string };
}

export interface LandingCopy {
  readonly lang: LandingLang;
  readonly path: LandingPath;
  /** <title> and meta description. Limits in characters: vi and en 60 and 160, zh 30 and 80 (test/site checks them). */
  readonly meta: { readonly title: string; readonly description: string };
  /** Open Graph / Twitter card text. `imageAlt` describes the card image (public/og-image.png), not anything on the page. */
  readonly og: { readonly title: string; readonly description: string; readonly imageAlt: string };
  /** Words around the page that are not marketing copy. `languageLabel` names the language switcher for screen readers. */
  readonly chrome: { readonly skipLink: string; readonly githubLink: string; readonly licenseLink: string; readonly languageLabel: string };
  /** The two buttons shown in the hero and again at the end (the header repeats the sign-in button). */
  readonly cta: { readonly signIn: string; readonly deploy: string; readonly deployNote?: string };
  /** `screenshotAlt` is the text alternative of the product screenshot under the headline. */
  readonly hero: { readonly h1: string; readonly subline: string; readonly screenshotAlt: string };
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
  /** Navigation, section labels and the words inside the product fragments (see LandingUi). */
  readonly ui: LandingUi;
}
