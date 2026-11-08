import { beforeAll, describe, expect, it } from 'vitest';
import { isCommonPassword, loadPasswordData } from '../../src/client/lib/password/blocklist';
import type { PasswordData } from '../../src/client/lib/password/blocklist';
import { ADMIN_MIN_LENGTH, MAX_LENGTH, MEMBER_MIN_LENGTH, contextWords, passwordLength } from '../../src/client/lib/password/policy';
import { PASSPHRASE_WORDS, generatePassphrase, generateTempPassword, randomIndex } from '../../src/client/lib/password/random';
import type { RandomFill } from '../../src/client/lib/password/random';
import { assessPassword, estimateBits } from '../../src/client/lib/password/strength';
import type { PasswordProblem, StrengthLevel } from '../../src/client/lib/password/strength';
import { levelLabel, meterValueText, problemMessage, problemMessages, rulesText } from '../../src/client/lib/password/messages';

let data: PasswordData;
beforeAll(async () => {
  data = await loadPasswordData();
});

const bits = (password: string): number => estimateBits(password, data.dictionary);

/** A generator that hands out the given values, then fails loudly. */
const fixed =
  (...values: number[]): RandomFill =>
  (array) => {
    const next = values.shift();
    if (next === undefined) {
      throw new Error('ran out of values');
    }
    array.set([next]);
    return array;
  };

describe('password rules', () => {
  it('counts code points after NFKC: 12 for members, 16 for admins, at most 256', () => {
    expect([MEMBER_MIN_LENGTH, ADMIN_MIN_LENGTH, MAX_LENGTH]).toEqual([12, 16, 256]);
    expect(passwordLength('a'.repeat(12))).toBe(12);
    expect(passwordLength('😀'.repeat(12))).toBe(12);
    // Full-width digits fold to ASCII, a ligature unfolds into two letters.
    expect(passwordLength('１２３４５６７８９０１２')).toBe(12);
    expect(passwordLength('ﬁ')).toBe(2);
    // Composed and decomposed forms of the same text have the same length.
    expect(passwordLength('\u00E9'.repeat(5))).toBe(passwordLength('e\u0301'.repeat(5)));
  });

  it('refuses a short password by role and a long one for everybody', () => {
    const eleven = 'kT7#vQ2$mL9';
    expect(assessPassword(eleven, 'member', data).problems).toEqual(['too_short']);
    expect(assessPassword(`${eleven}x`, 'member', data).ok).toBe(true);
    const fifteen = 'kT7#vQ2$mL9!pR4';
    expect(assessPassword(fifteen, 'admin', data).problems).toEqual(['too_short']);
    expect(assessPassword(`${fifteen}w`, 'admin', data).ok).toBe(true);
    expect(assessPassword('kT7#vQ2$'.repeat(33), 'member', data).problems).toEqual(['too_long']);
    expect(assessPassword('', 'member', data)).toMatchObject({ ok: false, level: 0, length: 0 });
  });

  it('takes the words of the account out of the password', () => {
    expect(contextWords('Mai.Nguyen@Acme-Corp.example', 'Mai Nguyen')).toEqual(['mai.nguyen', 'nguyen', 'acme-corp', 'acme', 'corp']);
    const words = contextWords('mai.nguyen@acme-corp.example', 'Mai Nguyen');
    expect(assessPassword('Nguyen-kT7#vQ2$mL9', 'member', data, words).problems).toEqual(['has_account_word']);
    expect(assessPassword('kT7#vQ2$mL9!pR4', 'member', data, words).ok).toBe(true);
  });
});

describe('common-password blocklist', () => {
  it('ships a few thousand entries and a 2048-word list', () => {
    expect(data.roots.size).toBe(2000);
    expect(data.long.size).toBe(1500);
    expect(data.words).toHaveLength(2048);
    expect(data.words.at(0)).toBe('abandon');
    expect(data.words.at(-1)).toBe('zoo');
    // The BIP-39 property the passphrase relies on: the first four letters tell two words apart.
    expect(new Set(data.words.map((word) => word.slice(0, 4))).size).toBe(2048);
    expect(data.roots.has('password')).toBe(true);
    expect([...data.long].every((entry) => entry.length >= 12 && !/\s/.test(entry))).toBe(true);
  });

  it.each([
    'password123456',
    'Password123456!',
    'PASSWORD-2024!!',
    'P@ssw0rd2024!!',
    'p4ssw0rd1234',
    '$$$Dragon$$$2024',
    'iloveyouiloveyou',
    'qwertyuiop12',
    '1qaz2wsx3edc',
    'Q1W2E3R4T5Y6',
    '１２３ｑｗｅａｓｄｚｘｃ'
  ])('refuses %s as a common password', (password) => {
    expect(isCommonPassword(password, data)).toBe(true);
  });

  it.each([
    'correct horse battery staple',
    'kT7#vQ2$mL9!pR4',
    // A common word followed by random letters is not "a common word with decoration": only digits and symbols are stripped.
    'monkeyxqzpvbwtkj',
    'purple elephant dancing in rain',
    'abandon-ability-able-about-above-absent'
  ])('does not refuse %s', (password) => {
    expect(isCommonPassword(password, data)).toBe(false);
  });
});

describe('strength estimate', () => {
  it.each([
    ['123456789012', 'member'],
    ['aaaaaaaaaaaa', 'member'],
    ['abcdefghijkl', 'member'],
    ['😀😀😀😀😀😀😀😀😀😀😀😀', 'member'],
    ['correct-horse', 'member'],
    ['qwertyasdfgh', 'member']
  ] as const)('refuses %s as predictable', (password, role) => {
    const result = assessPassword(password, role, data);
    expect(result.problems).toContain('predictable');
    expect(result.ok).toBe(false);
    expect(result.level).toBe(1);
  });

  it('rates words, runs and random characters in the order a guesser would', () => {
    expect(bits('aaaaaaaaaaaa')).toBeLessThan(bits('abcdefghijkl') + 1);
    expect(bits('correct horse battery staple')).toBeGreaterThan(bits('correct horse'));
    expect(bits('kT7#vQ2$mL9!pR4')).toBeGreaterThan(bits('correct horse battery'));
    // A look-alike swap hardly helps: p@ssw0rd is the word with two swaps, not eight random characters.
    expect(bits('p@ssw0rd')).toBeLessThan(20);
    // One more character, one more guess: never cheaper.
    expect(bits('kT7#vQ2$mL9!pR4x')).toBeGreaterThan(bits('kT7#vQ2$mL9!pR4'));
  });

  it('puts a generated passphrase and a random password at the top of the scale', () => {
    const words = generatePassphrase(data.words);
    expect(assessPassword(words, 'admin', data)).toMatchObject({ ok: true, level: 4 });
    expect(assessPassword('xK9#mQ2$vL7!pR4wZ', 'admin', data)).toMatchObject({ ok: true, level: 4 });
    expect(assessPassword('Tr0ub4dor&3xx', 'member', data).level).toBeLessThan(4);
  });
});

describe('what the meter and the rules say', () => {
  const PROBLEMS: readonly PasswordProblem[] = ['too_short', 'too_long', 'common', 'predictable', 'has_account_word'];

  it('says the rules in the words the Product Owner fixed, the numbers coming from the constants', () => {
    expect(rulesText()).toBe('At least 12 characters (16 for admins), common passwords are rejected.');
    expect(rulesText()).toContain(`${MEMBER_MIN_LENGTH} characters (${ADMIN_MIN_LENGTH} for admins)`);
    // An empty field is told the rules, whoever types in it.
    for (const role of ['member', 'admin'] as const) {
      const empty = assessPassword('', role, data);
      expect(problemMessages(empty.problems, empty.length, empty.min)).toBe(rulesText());
    }
  });

  it('counts what is still missing, with the plural of the language', () => {
    expect(problemMessage('too_short', 11, 12)).toBe('1 more character needed (at least 12).');
    expect(problemMessage('too_short', 8, 12)).toBe('4 more characters needed (at least 12).');
    const fifteen = assessPassword('kT7#vQ2$mL9!pR4', 'admin', data);
    expect(problemMessages(fifteen.problems, fifteen.length, fifteen.min)).toBe('1 more character needed (at least 16).');
  });

  it('has a sentence for every reason, never a bare key or an open placeholder', () => {
    for (const problem of PROBLEMS) {
      const text = problemMessage(problem, 5, 12);
      expect(text, problem).not.toMatch(/^[a-z0-9_]+\.[a-z0-9_.]+$/);
      expect(text, problem).not.toContain('{');
    }
    expect(problemMessage('too_long', 300, 12)).toBe(`At most ${MAX_LENGTH} characters.`);
    expect(problemMessages(['common', 'predictable'], 14, 12)).toBe(
      `${problemMessage('common', 14, 12)} ${problemMessage('predictable', 14, 12)}`
    );
  });

  it('names every strength level for the bar and for a screen reader', () => {
    const labels: Record<StrengthLevel, string> = { 0: '', 1: 'Weak', 2: 'Fair', 3: 'Good', 4: 'Strong' };
    for (const level of [0, 1, 2, 3, 4] as const) {
      expect(levelLabel(level)).toBe(labels[level]);
      expect(meterValueText(level)).toBe(level === 0 ? 'Nothing entered' : labels[level]);
    }
  });
});

describe('random choices', () => {
  it('rejects the values that would make some indexes likelier (no modulo bias)', () => {
    // n = 3: the largest multiple of 3 below 2^32 is 4294967295, so that value and above are refused and the next draw is used.
    expect(randomIndex(3, fixed(0xff_ff_ff_ff, 7))).toBe(1);
    expect(randomIndex(3, fixed(4_294_967_294))).toBe(2);
    expect(randomIndex(1, fixed(123))).toBe(0);
    // A power of two never rejects.
    expect(randomIndex(2048, fixed(0xff_ff_ff_ff))).toBe(2047);
    expect(() => randomIndex(0)).toThrow(RangeError);
    expect(() => randomIndex(1.5)).toThrow(RangeError);
  });

  it('covers every index about equally with the browser generator', () => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    const draws = 70_000;
    for (let index = 0; index < draws; index += 1) {
      counts[randomIndex(counts.length)] += 1;
    }
    for (const count of counts) {
      // 10,000 expected; a fair generator lands within 5% about every time (5 standard deviations is ~5%).
      expect(Math.abs(count - draws / counts.length)).toBeLessThan(500);
    }
  });

  it('makes a passphrase of six listed words', () => {
    const passphrase = generatePassphrase(data.words);
    const picked = passphrase.split('-');
    expect(picked).toHaveLength(PASSPHRASE_WORDS);
    expect(picked.every((word) => data.words.includes(word))).toBe(true);
    expect(generatePassphrase(data.words, 3, fixed(0, 1, 2047))).toBe('abandon-ability-zoo');
    expect(generatePassphrase(data.words)).not.toBe(passphrase);
  });

  it('makes a one-time password without look-alike characters, in four groups', () => {
    const seen = new Set<string>();
    for (let index = 0; index < 200; index += 1) {
      const password = generateTempPassword();
      expect(password).toMatch(/^[A-HJ-NP-Za-km-z2-9]{5}(?:-[A-HJ-NP-Za-km-z2-9]{5}){3}$/);
      seen.add(password);
    }
    expect(seen.size).toBe(200);
    expect(passwordLength(generateTempPassword())).toBeGreaterThanOrEqual(ADMIN_MIN_LENGTH);
  });
});
