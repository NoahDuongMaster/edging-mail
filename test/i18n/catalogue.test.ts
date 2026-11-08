import { describe, expect, it } from 'vitest';
import { placeholdersOf, requiredPluralCategories } from '../../src/shared/i18n/core';
import { DEFAULT_LOCALE, LOCALES, type Locale } from '../../src/shared/i18n/languages';
import en from '../../src/shared/i18n/locales/en.json';
import glossary from '../../src/shared/i18n/glossary.json';
import notesFile from '../../src/shared/i18n/notes.json';

interface Note {
  context: string;
  security: boolean;
  max?: number;
}
const notes = notesFile as Readonly<Partial<Record<string, Note>>>;

// The checks every catalogue has to pass (design.md section 20.1 and 20.5). They read JSON only, so they run with the rest of
// `npm test`. The scans of the source code are in test/static.

// A catalogue is asked for keys that may not be there (a plural form a language does not use), so a lookup can be undefined.
type Flat = Readonly<Partial<Record<string, string>>>;
// Every file of the two folders, found by name, so a new language is checked as soon as its files exist (and is reported as missing when only
// its row in languages.ts does). `vi.json` is the language `vi`.
const byTag = (files: Readonly<Record<string, Flat>>): Readonly<Partial<Record<string, Flat>>> =>
  Object.fromEntries(Object.entries(files).map(([path, flat]) => [path.slice(path.lastIndexOf('/') + 1, -'.json'.length), flat]));
const APP_FILES = byTag(import.meta.glob<Flat>('../../src/shared/i18n/locales/*.json', { import: 'default', eager: true }));
const SERVER_FILES = byTag(import.meta.glob<Flat>('../../src/shared/i18n/locales/server/*.json', { import: 'default', eager: true }));
const tableOf = (files: Readonly<Partial<Record<string, Flat>>>): Readonly<Record<Locale, Flat>> =>
  Object.fromEntries(LOCALES.map((locale) => [locale, files[locale] ?? {}])) as Readonly<Record<Locale, Flat>>;
const APP = tableOf(APP_FILES);
const SERVER = tableOf(SERVER_FILES);
const vi = APP.vi;
const zhCN = APP['zh-CN'];
/** The languages that are translations of the source. */
const TRANSLATIONS = LOCALES.filter((locale) => locale !== DEFAULT_LOCALE);
const baseOf = (key: string): string => (key.includes('#') ? key.slice(0, key.indexOf('#')) : key);
/** A status shown on an account ("Disabled"): "Đã khóa" is how it reads, and the glossary's "Khóa tài khoản" rule is about the action. Marketing to confirm. */
const STATUS_LABELS = new Set(['users.status_disabled']);
const categoryOf = (key: string): string | undefined => (key.includes('#') ? key.slice(key.indexOf('#') + 1) : undefined);
const entries = (flat: Flat): [string, string][] => Object.entries(flat) as [string, string][];
const noteOf = (key: string): Note | undefined => notes[key] ?? notes[baseOf(key)];
const noteEntries = (): [string, Note][] => Object.entries(notes) as [string, Note][];
const signature = (text: string): string => [...new Set(placeholdersOf(text))].toSorted().join(',');

/** A button: a key under action., a key named like one, or a note that says so. */
function isButton(key: string): boolean {
  const context = noteOf(key)?.context ?? '';
  return key.startsWith('action.') || /(^|[._])(btn|button|cta)([._]|$)/.test(key) || /^(?:[\w-]+ ){0,2}button\b/i.test(context);
}
const BUTTON_KEYS = Object.keys(en).filter(isButton);

function parity(sets: Readonly<Record<Locale, Flat>>): string[] {
  const problems: string[] = [];
  const bases = (flat: Flat): Set<string> => new Set(Object.keys(flat).map(baseOf));
  const source = bases(sets.en);
  for (const locale of LOCALES) {
    const own = bases(sets[locale]);
    for (const key of source) {
      if (!own.has(key)) {
        problems.push(`${locale} lacks ${key}`);
      }
    }
    for (const key of own) {
      if (!source.has(key)) {
        problems.push(`${locale} has ${key}, which en does not`);
      }
    }
  }
  return problems;
}

function placeholderProblems(sets: Readonly<Record<Locale, Flat>>): string[] {
  const problems: string[] = [];
  for (const [key, text] of entries(sets.en)) {
    const expected = signature(text);
    for (const locale of LOCALES) {
      // A plural form that a language does not have is checked against the form it does have.
      const own = sets[locale][key] ?? sets[locale][`${baseOf(key)}#other`];
      if (own === undefined) {
        continue;
      }
      const actual = signature(own);
      if (actual !== expected && !(categoryOf(key) === 'one' && actual === signature(sets.en[`${baseOf(key)}#other`] ?? ''))) {
        problems.push(`${locale} ${key}: {${actual}} instead of {${expected}}`);
      }
    }
  }
  return problems;
}

function pluralProblems(sets: Readonly<Record<Locale, Flat>>): string[] {
  const problems: string[] = [];
  for (const locale of LOCALES) {
    const pluralBases = new Set(
      Object.keys(sets[locale])
        .filter((key) => key.includes('#'))
        .map(baseOf)
    );
    for (const base of pluralBases) {
      for (const category of requiredPluralCategories(locale)) {
        if (!(`${base}#${category}` in sets[locale])) {
          problems.push(`${locale} ${base} lacks #${category}`);
        }
      }
      if (base in sets[locale] && `${base}#other` in sets[locale]) {
        problems.push(`${locale} ${base} is both plural and plain`);
      }
    }
    // A key that is plural in English is plural in every language (so a count always finds a form).
    for (const base of new Set(
      Object.keys(sets.en)
        .filter((key) => key.includes('#'))
        .map(baseOf)
    )) {
      if (!pluralBases.has(base)) {
        problems.push(`${locale} ${base} is plural in en only`);
      }
    }
  }
  return problems;
}

describe('the language list and the files', () => {
  it('has a catalogue file and a server file for every language, and none for a language that is not in languages.ts', () => {
    expect(Object.keys(APP_FILES).toSorted(), 'src/shared/i18n/locales/<tag>.json').toEqual([...LOCALES].toSorted());
    expect(Object.keys(SERVER_FILES).toSorted(), 'src/shared/i18n/locales/server/<tag>.json').toEqual([...LOCALES].toSorted());
  });

  it('has a column in every glossary row for every language, and for none that is not listed', () => {
    for (const row of glossary.rows) {
      const columns = Object.keys(row).filter((name) => !['id', 'appKeys', 'landing', 'note'].includes(name));
      expect(columns.toSorted(), `glossary row ${row.id}`).toEqual([...LOCALES].toSorted());
    }
  });
});

describe.each([
  ['the app catalogues', APP],
  ['the server catalogues', SERVER]
] as const)('%s', (_name, sets) => {
  it('hold the same keys in every language (plural forms count as one key)', () => {
    expect(parity(sets)).toEqual([]);
  });

  it('use the same placeholders in every language', () => {
    expect(placeholderProblems(sets)).toEqual([]);
  });

  it('have every plural form the language needs (en: one + other; vi, zh-CN: other)', () => {
    expect(pluralProblems(sets)).toEqual([]);
  });

  it('hold no empty text and no HTML', () => {
    for (const locale of LOCALES) {
      for (const [key, text] of entries(sets[locale])) {
        expect(text.trim(), `${locale} ${key} is empty`).not.toBe('');
        expect(text, `${locale} ${key} holds markup`).not.toMatch(/<\/?[a-z][^>]*>/i);
      }
    }
  });
});

describe('the glossary', () => {
  it('has a text in every language for every row', () => {
    for (const row of glossary.rows) {
      for (const locale of LOCALES) {
        expect(row[locale].trim(), `${row.id} ${locale}`).not.toBe('');
      }
    }
  });

  it('is what the catalogue says wherever a key carries a glossary term', () => {
    const problems: string[] = [];
    for (const row of glossary.rows) {
      for (const key of row.appKeys) {
        for (const locale of LOCALES) {
          if (APP[locale][key] !== row[locale]) {
            problems.push(`${locale} ${key}: "${String(APP[locale][key])}" instead of "${row[locale]}"`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('keeps the unchanged names identical in every language', () => {
    const problems: string[] = [];
    for (const [key, text] of entries(en)) {
      for (const name of glossary.unchangedNames) {
        if (!new RegExp(String.raw`\b${name}\b`).test(text)) {
          continue;
        }
        for (const locale of TRANSLATIONS) {
          const own = APP[locale][key] ?? APP[locale][`${baseOf(key)}#other`] ?? '';
          if (!own.includes(name)) {
            problems.push(`${locale} ${key} lost "${name}"`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('the wording rules of the glossary', () => {
  // One row per language that has a word to forbid; a language without a row is not checked by this rule (add one when you add the language).
  const FORBIDDEN: readonly [Locale, RegExp][] = [
    ['en', /conversation/i],
    ['vi', /cuộc hội thoại|hội thoại/i],
    ['zh-CN', /对话/]
  ];

  it('never names a message thread a conversation', () => {
    for (const [locale, pattern] of FORBIDDEN) {
      for (const [key, text] of entries(APP[locale])) {
        expect(text, `${locale} ${key}`).not.toMatch(pattern);
      }
    }
  });

  it('uses the Chinese word for a session only for a sign-in session', () => {
    for (const [key, text] of entries(zhCN)) {
      expect(text.replaceAll('登录会话', ''), `zh-CN ${key}`).not.toContain('会话');
    }
  });

  it('keeps the recovery key and the recovery codes apart', () => {
    // Per language: how it names the recovery key and the recovery codes. A language without an entry is not checked by this rule.
    const KEY_TERMS: Readonly<Partial<Record<Locale, RegExp>>> = { en: /recovery key/i, vi: /khóa khôi phục/i, 'zh-CN': /恢复密钥/ };
    const CODE_TERMS: Readonly<Partial<Record<Locale, RegExp>>> = { en: /recovery codes?/i, vi: /mã khôi phục/i, 'zh-CN': /恢复码/ };
    for (const locale of LOCALES) {
      const keyTerm = KEY_TERMS[locale];
      const codeTerm = CODE_TERMS[locale];
      if (keyTerm === undefined || codeTerm === undefined) {
        continue;
      }
      for (const [key, text] of entries(APP[locale])) {
        if (/recovery_codes?/.test(key)) {
          expect(text, `${locale} ${key} mentions the recovery key`).not.toMatch(keyTerm);
        }
        if (key.includes('recovery_key')) {
          expect(text, `${locale} ${key} mentions the recovery codes`).not.toMatch(codeTerm);
        }
      }
    }
  });

  it('never writes a bare "Khóa" or "Mở khóa" for the disable and enable actions', () => {
    for (const [key, text] of entries(vi)) {
      // The Unlock button of the unlock screen (the person's own mail) is the one place where the bare word is right: it is no account action.
      if (key === 'keys.unlock') {
        continue;
      }
      expect(['Khóa', 'Mở khóa'], `vi ${key}`).not.toContain(text.trim());
    }
  });

  it('uses "end-to-end encrypted" only on the badge keys (e2e.badge*)', () => {
    // Per language: how it says "end-to-end encrypted". A language without an entry is not checked by this rule.
    const TERM: Readonly<Partial<Record<Locale, RegExp>>> = { en: /end-to-end encrypted/i, vi: /mã hóa đầu cuối/i, 'zh-CN': /端到端加密/ };
    for (const locale of LOCALES) {
      const term = TERM[locale];
      if (term === undefined) {
        continue;
      }
      for (const [key, text] of entries(APP[locale])) {
        // vi and zh-CN have one phrase for "end-to-end" and for "end-to-end encrypted" (CAT-17): where the English says only "end-to-end" (the
        // dialog titles, the quiet line under the recipients) the phrase is the same one as on the badge.
        const english: Readonly<Record<string, string>> = en;
        const sameAsEnglish = locale !== 'en' && /end-to-end/i.test(english[key] ?? '');
        if (!key.startsWith('e2e.badge') && !sameAsEnglish) {
          expect(text, `${locale} ${key}`).not.toMatch(term);
        }
      }
    }
  });

  it('names the recovery key and the recovery codes the same way in all three languages, never the one for the other', () => {
    const KEY = { en: /recovery key/i, vi: /khóa khôi phục/i, 'zh-CN': /恢复密钥/ } as const;
    const CODES = { en: /recovery codes?/i, vi: /mã khôi phục/i, 'zh-CN': /恢复码/ } as const;
    const problems: string[] = [];
    for (const [key, text] of entries(en)) {
      for (const locale of ['vi', 'zh-CN'] as const) {
        const own = APP[locale][key] ?? APP[locale][`${baseOf(key)}#other`] ?? '';
        if (own === text) {
          continue;
        } // still the English stand-in
        if (KEY.en.test(text) !== KEY[locale].test(own)) {
          problems.push(`${locale} ${key}: the recovery key is named in one language only`);
        }
        if (CODES.en.test(text) !== CODES[locale].test(own)) {
          problems.push(`${locale} ${key}: the recovery codes are named in one language only`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('writes the Vietnamese disable and enable actions with their object (Khóa tài khoản, Mở lại tài khoản), never a bare Khóa or Mở khóa', () => {
    const problems: string[] = [];
    for (const [key, text] of entries(en)) {
      const own = APP.vi[key] ?? '';
      if (own === text) {
        continue;
      }
      if (/mở khóa/i.test(own) && !/unlock/i.test(text)) {
        problems.push(`vi ${key}: "Mở khóa" for something that is not an unlock`);
      }
      if (/(?<!\p{L})khóa(?!\p{L})/iu.test(own) && /disabl|enabl/i.test(text) && !/tài khoản/i.test(own) && !STATUS_LABELS.has(key)) {
        problems.push(`vi ${key}: Khóa without its object (tài khoản)`);
      }
    }
    expect(problems).toEqual([]);
  });

  it('calls the audit log "Nhật ký hoạt động" in Vietnamese, never "Nhật ký kiểm tra" (PO decision)', () => {
    for (const [key, text] of entries(vi)) {
      expect(text, `vi ${key}`).not.toMatch(/nhật ký kiểm tra/i);
    }
  });

  it('spells the Vietnamese words with the tone on the o (hóa, khóa, xóa), as on the landing', () => {
    for (const [key, text] of entries(vi)) {
      expect(text, `vi ${key}`).not.toMatch(/(?<!\p{L})(?:h|kh|x)o[àáảãạ](?!\p{L})/iu);
    }
  });

  describe('buttons', () => {
    it('are verbs with no final punctuation, in every language', () => {
      for (const key of BUTTON_KEYS) {
        for (const locale of LOCALES) {
          const text = APP[locale][key] ?? APP[locale][`${baseOf(key)}#other`] ?? '';
          expect(text, `${locale} ${key}`).not.toMatch(/[.。!！?？:：]$/);
        }
      }
    });

    it('use sentence case in Vietnamese (only a folder name or a product name keeps its capitals)', () => {
      const names = [...glossary.rows.filter((row) => row.id.startsWith('folder.')).map((row) => row.vi), ...glossary.unchangedNames];
      for (const key of BUTTON_KEYS) {
        let rest = APP.vi[key] ?? '';
        for (const name of names) {
          rest = rest.replaceAll(name, '');
        }
        for (const word of rest.trim().split(/\s+/).slice(1)) {
          if (word === word.toUpperCase()) {
            continue;
          } // an acronym (URL, PDF)
          expect(word.slice(0, 1), `vi ${key}: "${word}"`).toBe(word.slice(0, 1).toLowerCase());
        }
      }
    });
  });

  it('puts a space between a placeholder or Latin text and Chinese characters', () => {
    for (const [key, text] of entries(zhCN)) {
      expect(text, `zh-CN ${key}`).not.toMatch(/[\u4E00-\u9FFF][A-Za-z0-9{]|[A-Za-z0-9}][\u4E00-\u9FFF]/);
    }
  });

  it('does not end a Chinese button with a full stop', () => {
    for (const [key, text] of entries(zhCN)) {
      if (/(^|\.)(button|btn|action|cta)(\.|$)/.test(key)) {
        expect(text, `zh-CN ${key}`).not.toMatch(/。$/);
      }
    }
  });
});

describe('the translators\u2019 notes (src/shared/i18n/notes.json)', () => {
  const glossaryKeys = new Set(glossary.rows.flatMap((row) => row.appKeys));
  const enBases = new Set(Object.keys(en).map(baseOf));
  const SECURITY_NAMESPACE = /^(security|recovery|twofa|auth|e2e|keys)\./;
  const SECURITY_TEXT = /encrypt|recovery (key|code)|two-factor|authenticator|password|private key|sign-in session|who can read/i;

  it('has a note only for a key that exists in en.json', () => {
    const problems = Object.keys(notes).filter((key) => !enBases.has(baseOf(key)));
    expect(problems).toEqual([]);
  });

  it('has a context for every key that is not a glossary term', () => {
    const problems: string[] = [];
    for (const key of Object.keys(en)) {
      if (glossaryKeys.has(key)) {
        continue;
      }
      const note = noteOf(key);
      if (note === undefined || note.context.trim() === '' || typeof note.security !== 'boolean') {
        problems.push(key);
      }
    }
    expect(problems).toEqual([]);
  });

  it('flags as security-related every key of the security namespaces and every key about encryption, recovery, two-factor or passwords', () => {
    const problems: string[] = [];
    for (const [key, text] of entries(en)) {
      if (glossaryKeys.has(key)) {
        continue;
      }
      if ((SECURITY_NAMESPACE.test(key) || SECURITY_TEXT.test(text)) && noteOf(key)?.security !== true) {
        problems.push(key);
      }
    }
    expect(problems).toEqual([]);
  });
});

describe('length limits', () => {
  // The limit is in columns: a letter counts 1 and a Chinese character 2 (it is about twice as wide), so one number is fair in all
  // three languages; a {placeholder} counts 4 (a number or a short word). It applies to the longest of the three, and to the
  // English text of a stand-in.
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE6F\uFF00-\uFF60\uFFE0-\uFFE6]/u;
  const columns = (text: string): number => {
    let total = 0;
    for (const { segment } of segmenter.segment(text.replaceAll(/\{[A-Za-z0-9_]+\}/g, '0000'))) {
      total += WIDE.test(segment) ? 2 : 1;
    }
    return total;
  };

  it('hold in every language (the limit applies to the longest of them)', () => {
    const problems: string[] = [];
    for (const [key, note] of noteEntries()) {
      const max = note.max;
      if (max === undefined) {
        continue;
      }
      for (const locale of LOCALES) {
        const forms = Object.keys(APP[locale]).filter((candidate) => baseOf(candidate) === baseOf(key));
        if (forms.length === 0) {
          problems.push(`${key} is not in ${locale}`);
        }
        for (const form of forms) {
          const width = columns(APP[locale][form] ?? '');
          if (width > max) {
            problems.push(`${locale} ${form}: ${width} columns > ${max}`);
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

// Until Marketing's vi and zh-CN files replace the stand-ins, a value equal to the English one is not translated.
// These stay the same in every language on purpose: a keyboard key name, the file-type word HTML, a sample address, Bcc (glossary), and the
// names of the screens and the action of the Cloudflare dashboard that the setup guides point to (the dashboard is shown in English).
const IDENTICAL_BY_DESIGN = new Set([
  'compose.key_ctrl',
  'compose.key_enter',
  'compose.from_placeholder',
  'domains.guide_settings',
  'domains.guide_subdomains',
  'domains.guide_action_worker',
  'domains.guide_path_routing',
  'domains.guide_path_sending',
  // Product names of the Cloudflare parts (the docs tab headings): the same in every language.
  'docs.arch_cron_title',
  'docs.arch_d1_title',
  'docs.arch_push_title',
  'domains.name_placeholder',
  'users.alias_placeholder',
  'reader.view_html',
  'term.bcc',
  'term.cc'
]);
const NOT_A_SENTENCE = (text: string): boolean =>
  !/[A-Za-z]{3,}/.test(
    text.replaceAll(/\{[A-Za-z0-9_]+\}/g, '').replaceAll(/Edging Mail|Edgar|Cloudflare|PWA|TOTP|DNS|MX|IMAP|POP|SMTP|Outlook|Gmail/g, '')
  );

describe('translation status', () => {
  // This test lists the stand-ins; it fails only when I18N_REQUIRE_TRANSLATED=1 (the release check).
  const strict = typeof process !== 'undefined' && process.env.I18N_REQUIRE_TRANSLATED === '1';

  it.each(TRANSLATIONS)('lists the %s values that are still the English text', (locale) => {
    const untranslated = entries(en)
      .filter(([key, text]) => APP[locale][key] === text && !NOT_A_SENTENCE(text) && !IDENTICAL_BY_DESIGN.has(key))
      .map(([key]) => key);
    if (strict) {
      expect(untranslated).toEqual([]);
    } else {
      expect(untranslated.length).toBeGreaterThanOrEqual(0);
    }
  });
});
