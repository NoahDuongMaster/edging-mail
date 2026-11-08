import { isCommonPassword, unleet } from './blocklist';
import type { PasswordData } from './blocklist';
import { MAX_LENGTH, codePoints, minLengthFor, normalizePassword, passwordLength } from './policy';
import type { PasswordRole } from './policy';

// How hard a password is to guess, in bits, from what a guesser would try first: dictionary words (one cheap pick each), digits and
// symbols at the ends, repeats and runs (aaaa, 1234, qwerty) and look-alike swaps. It is an estimate for the meter, deliberately simple
// and on the cautious side, not a proof. The rules that block a password are in assessPassword; the bar on screen is only advice.

const DIGIT_BITS = Math.log2(10);
const LETTER_BITS = Math.log2(26);
const SYMBOL_BITS = 5;
const OTHER_BITS = 8;
const REPEAT_BITS = 1;
const PATTERN_BITS = 1.5;
const SEPARATOR_BITS = 2;
const YEAR_BITS = 7;
const SWAP_BITS = 1;
const MIN_WORD = 3;
const MAX_WORD = 24;
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890'];

/** Below this a password is refused as predictable (about 2^28 guesses: seconds against a stolen copy of the data). */
export const MIN_BITS = 28;

/** The next character costs `base`, unless it repeats the last one or carries on a run (abc, 321, a keyboard row). */
function stepBits(previous: string, current: string, base: number): number {
  if (previous === '') {
    return base;
  }
  if (current === previous) {
    return REPEAT_BITS;
  }
  const inRun = Math.abs((current.codePointAt(0) ?? 0) - (previous.codePointAt(0) ?? 0)) === 1;
  const onRow = ROWS.some((row) => {
    const gap = row.indexOf(current) - row.indexOf(previous);
    return row.includes(current) && row.includes(previous) && Math.abs(gap) === 1;
  });
  return inRun || onRow ? PATTERN_BITS : base;
}

const isUpper = (char: string): boolean => char !== char.toLowerCase();

function caseBits(run: string): number {
  const chars = codePoints(run);
  const upper = chars.filter((char) => isUpper(char)).length;
  if (upper === 0) {
    return 0;
  }
  // Capital first letter or all capitals: one choice. Capitals anywhere else: one choice each.
  return (upper === 1 && isUpper(chars.at(0) ?? '')) || upper === chars.length ? 1 : upper;
}

/** A run of letters is the cheaper of "these characters one by one" and "this dictionary word, then the rest". */
function letterBits(run: string, dictionary: ReadonlySet<string>): number {
  const lower = run.toLowerCase();
  const wordBits = Math.log2(Math.max(2, dictionary.size));
  const best = Array.from({ length: lower.length + 1 }, () => Number.POSITIVE_INFINITY);
  best[0] = 0;
  for (let end = 1; end <= lower.length; end += 1) {
    best[end] = (best[end - 1] ?? 0) + stepBits(lower.charAt(end - 2), lower.charAt(end - 1), LETTER_BITS);
    for (let length = MIN_WORD; length <= Math.min(end, MAX_WORD); length += 1) {
      if (dictionary.has(lower.slice(end - length, end))) {
        best[end] = Math.min(best[end] ?? 0, (best[end - length] ?? 0) + wordBits);
      }
    }
  }
  return (best[lower.length] ?? 0) + caseBits(run);
}

function digitBits(run: string): number {
  if (/^(?:19|20)\d\d$/.test(run)) {
    return YEAR_BITS;
  }
  const chars = codePoints(run);
  return chars.reduce((sum, char, index) => sum + stepBits(chars[index - 1] ?? '', char, DIGIT_BITS), 0);
}

function otherBits(run: string, isBetweenWords: boolean): number {
  if (isBetweenWords && run.length === 1 && ' -_.'.includes(run)) {
    return SEPARATOR_BITS;
  }
  // Code points, not UTF-16 units: an emoji is one character and `😀😀😀` is a repeat.
  const chars = codePoints(run);
  return chars.reduce((sum, char, index) => {
    const base = (char.codePointAt(0) ?? 0) > 126 ? OTHER_BITS : SYMBOL_BITS;
    return sum + stepBits(chars[index - 1] ?? '', char, base);
  }, 0);
}

function runsBits(text: string, dictionary: ReadonlySet<string>): number {
  const runs = text.match(/[A-Za-z]+|\d+|[^A-Za-z\d]+/g) ?? [];
  return runs.reduce((sum, run, index) => {
    if (/^[A-Za-z]/.test(run)) {
      return sum + letterBits(run, dictionary);
    }
    if (/^\d/.test(run)) {
      return sum + digitBits(run);
    }
    const isBetweenWords = /^[A-Za-z]/.test(runs[index - 1] ?? '') && /^[A-Za-z]/.test(runs[index + 1] ?? '');
    return sum + otherBits(run, isBetweenWords);
  }, 0);
}

/** The estimate in bits: the lowest of the password as typed and with its look-alike swaps undone (each swap costs a bit). */
export function estimateBits(password: string, dictionary: ReadonlySet<string>): number {
  const plain = normalizePassword(password);
  const variants = unleet(plain)
    .filter(({ swapped }) => swapped > 0)
    .map(({ text, swapped }) => runsBits(text, dictionary) + swapped * SWAP_BITS);
  return Math.min(runsBits(plain, dictionary), ...variants);
}

export type PasswordProblem = 'too_short' | 'too_long' | 'common' | 'predictable' | 'has_account_word';

/** 0 = nothing typed, 1 = weak or refused, 2 = fair, 3 = good, 4 = strong. */
export type StrengthLevel = 0 | 1 | 2 | 3 | 4;

export interface Assessment {
  /** The password may be set: it meets every rule. */
  ok: boolean;
  problems: PasswordProblem[];
  bits: number;
  level: StrengthLevel;
  /** Characters as the rules count them. */
  length: number;
  /** The minimum for this role. */
  min: number;
}

const levelFor = (bits: number): StrengthLevel => {
  if (bits < 36) {
    return 1;
  }
  if (bits < 50) {
    return 2;
  }
  return bits < 64 ? 3 : 4;
};

/**
 * The rules, in the order a person fixes them: long enough (members 12, admins 16, at most 256, after NFKC), not a common password, not
 * predictable, no word from the account in it. A password that is too short is only told that, so the other messages do not pile up on
 * the way there. `accountWords` come from contextWords().
 */
export function assessPassword(password: string, role: PasswordRole, data: PasswordData, accountWords: readonly string[] = []): Assessment {
  const length = passwordLength(password);
  const min = minLengthFor(role);
  if (length === 0) {
    return { ok: false, problems: ['too_short'], bits: 0, level: 0, length, min };
  }
  const bits = estimateBits(password, data.dictionary);
  const problems: PasswordProblem[] = [];
  if (length < min) {
    problems.push('too_short');
  } else if (length > MAX_LENGTH) {
    problems.push('too_long');
  } else {
    const lower = normalizePassword(password).toLowerCase();
    if (isCommonPassword(password, data)) {
      problems.push('common');
    }
    if (bits < MIN_BITS) {
      problems.push('predictable');
    }
    if (accountWords.some((word) => lower.includes(word))) {
      problems.push('has_account_word');
    }
  }
  const level = levelFor(bits);
  return {
    ok: problems.length === 0,
    problems,
    bits,
    level: problems.length > 0 ? (Math.min(level, 1) as StrengthLevel) : level,
    length,
    min
  };
}
