import { describe, expect, it } from 'vitest';
import en from '../../src/shared/i18n/locales/en.json';
import vi from '../../src/shared/i18n/locales/vi.json';
import zhCN from '../../src/shared/i18n/locales/zh-CN.json';
import { OTHER_REASON, SHOWN_REASONS, SPAM_REASON_KEYS, explainSpam, parseSpamReasons, reasonKey } from '../../src/client/lib/spamReasons';

// Why a message is in Spam: the Worker's rule ids (a JSON array as text) turned into plain sentences. The column is never trusted: an older row has
// none, a newer Worker may name a rule this client does not know, and a damaged value must never break the reader.

/** The ids the Worker's filter may report (the contract with the Worker), one sentence each. */
const CONTRACT_IDS = [
  'block_listed',
  'auth_failed',
  'auth_missing_pass',
  'spoofs_own_domain',
  'reply_to_differs',
  'display_name_mismatch',
  'no_message_id',
  'no_date',
  'no_subject',
  'link_text_mismatch',
  'link_ip_address',
  'link_shortener',
  'hidden_text',
  'image_only',
  'many_links',
  'shouting_subject',
  'spam_phrases',
  'phishing_phrases',
  'risky_attachment',
  'html_attachment',
  'macro_attachment'
];

const raw = (...ids: unknown[]): string => JSON.stringify(ids);

describe('parseSpamReasons', () => {
  it('reads a JSON array of ids, in order, without repeats or blanks', () => {
    expect(parseSpamReasons(raw('spam_phrases', 'auth_failed'))).toEqual(['spam_phrases', 'auth_failed']);
    expect(parseSpamReasons(raw('a', 'b', 'a', '  ', ' c '))).toEqual(['a', 'b', 'c']);
  });

  it('gives none for null, undefined, empty, malformed or not an array (the screen never throws)', () => {
    for (const value of [null, undefined, '', ' '.repeat(3), '[', '{"a":1}', '"spam_phrases"', 'null', 'true', '42', '[[', 7, {}, []]) {
      expect(parseSpamReasons(value), `${typeof value} ${JSON.stringify(value)}`).toEqual([]);
    }
  });

  it('keeps only the strings of a mixed array', () => {
    expect(parseSpamReasons(raw(1, null, 'no_date', { id: 'x' }, ['y'], true))).toEqual(['no_date']);
  });

  it('stops at 50 ids (a column that long is not a filter decision)', () => {
    const many = Array.from({ length: 80 }, (_, index) => `rule_${index}`);
    expect(parseSpamReasons(JSON.stringify(many))).toHaveLength(50);
  });
});

describe('reasonKey', () => {
  it('names the sentence of every rule of the contract, and no two rules share one', () => {
    const keys = CONTRACT_IDS.map((id) => reasonKey(id));
    expect(new Set(keys).size).toBe(CONTRACT_IDS.length);
    for (const id of CONTRACT_IDS) {
      expect(reasonKey(id)).toBe(`spam.reason.${id}`);
    }
    expect(Object.keys(SPAM_REASON_KEYS).toSorted()).toEqual(CONTRACT_IDS.toSorted());
  });

  it('answers the general sentence for any id it does not know, also one that is a property of every object', () => {
    for (const id of ['', 'new_rule', 'BLOCK_LISTED', 'constructor', 'toString', '__proto__', 'hasOwnProperty']) {
      expect(reasonKey(id), id).toBe(OTHER_REASON);
    }
  });
});

describe('explainSpam', () => {
  it('shows the first three reasons and keeps the rest for "See all"', () => {
    const ids = ['block_listed', 'auth_failed', 'spam_phrases', 'many_links', 'image_only'];
    const { shown, more } = explainSpam({ spam_reasons: JSON.stringify(ids), spam_score: 9 });
    expect(SHOWN_REASONS).toBe(3);
    expect(shown).toEqual(['spam.reason.block_listed', 'spam.reason.auth_failed', 'spam.reason.spam_phrases']);
    expect(more).toEqual(['spam.reason.many_links', 'spam.reason.image_only']);
  });

  it('has nothing for "See all" up to three reasons', () => {
    expect(explainSpam({ spam_reasons: raw('no_date', 'no_subject', 'hidden_text'), spam_score: 4 }).more).toEqual([]);
    expect(explainSpam({ spam_reasons: raw('no_date'), spam_score: 4 })).toEqual({ shown: ['spam.reason.no_date'], more: [] });
  });

  it('says several unknown rules once, as the general sentence, where the first of them stood', () => {
    const { shown, more } = explainSpam({ spam_reasons: raw('x_new', 'spam_phrases', 'y_new', 'z_new'), spam_score: 5 });
    expect(shown).toEqual([OTHER_REASON, 'spam.reason.spam_phrases']);
    expect(more).toEqual([]);
  });

  it('says the general sentence when the filter scored the message but its reasons cannot be read', () => {
    for (const spam_reasons of ['{bad json', '[]', null, undefined, '"x"']) {
      expect(explainSpam({ spam_reasons, spam_score: 6 }), String(spam_reasons)).toEqual({ shown: [OTHER_REASON], more: [] });
    }
  });

  it('has no reason for a message the filter did not score (one the person moved themselves, or older than the filter)', () => {
    for (const message of [
      {},
      { spam_reasons: null, spam_score: null },
      { spam_reasons: '[]', spam_score: null },
      { spam_reasons: '{bad', spam_score: null }
    ]) {
      expect(explainSpam(message), JSON.stringify(message)).toEqual({ shown: [], more: [] });
    }
  });

  it('takes another limit when asked', () => {
    expect(explainSpam({ spam_reasons: raw('no_date', 'no_subject'), spam_score: 1 }, 1)).toEqual({
      shown: ['spam.reason.no_date'],
      more: ['spam.reason.no_subject']
    });
  });
});

describe('the sentences', () => {
  const CATALOGUES = { en, vi, 'zh-CN': zhCN } as Record<string, Record<string, string>>;
  const keys = [...CONTRACT_IDS, 'other'].map((id) => `spam.reason.${id}`);

  it('exist in en, vi and zh-CN for every rule of the contract and for the general one', () => {
    for (const [language, catalogue] of Object.entries(CATALOGUES)) {
      expect(
        keys.filter((key) => (catalogue[key] ?? '').trim() === ''),
        language
      ).toEqual([]);
    }
  });

  it('are plain words: no protocol names or mail jargon, in any language (they are read by people who do not work with mail)', () => {
    const protocols = /DMARC|SPF|DKIM|\bARC\b|Message-ID|Reply-To|\bMIME\b|\bSMTP\b/i;
    for (const [language, catalogue] of Object.entries(CATALOGUES)) {
      for (const key of keys) {
        expect(catalogue[key], `${language} ${key}`).not.toMatch(protocols);
      }
    }
    for (const key of keys) {
      expect(en[key as keyof typeof en], key).not.toMatch(/header|\bIP\b|authenticat|domain name|record/i);
    }
  });

  it('are one short line each, so a phone wraps them at most a little (the longest English one is under 80 characters)', () => {
    for (const key of keys) {
      const text = en[key as keyof typeof en];
      expect(text.length, key).toBeLessThanOrEqual(80);
      expect(text.endsWith('.'), key).toBe(true);
    }
  });
});
