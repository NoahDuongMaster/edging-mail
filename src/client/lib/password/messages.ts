import { tr, type MessageKey } from '../i18n';
import { ADMIN_MIN_LENGTH, MAX_LENGTH, MEMBER_MIN_LENGTH } from './policy';
import type { PasswordProblem, StrengthLevel } from './strength';

// What the password screens say, as catalogue keys. The tables hold KEYS and the functions translate when called: the language can
// change while the app is open, and every number in a sentence is a parameter taken from the constants of the rules.

/** The strength levels that have a label; 0 means nothing typed. */
const LEVEL_KEYS: Readonly<Record<Exclude<StrengthLevel, 0>, MessageKey>> = {
  1: 'password.level_weak',
  2: 'password.level_fair',
  3: 'password.level_good',
  4: 'password.level_strong'
};

/** Why a password is refused, except `too_short` (it depends on how many characters are missing). */
const PROBLEM_KEYS: Readonly<Record<Exclude<PasswordProblem, 'too_short'>, MessageKey>> = {
  too_long: 'password.problem_too_long',
  common: 'password.problem_common',
  predictable: 'password.problem_predictable',
  has_account_word: 'password.problem_has_account_word'
};

/** The strength label shown under the field; an empty text when nothing is typed. */
export const levelLabel = (level: StrengthLevel): string => (level === 0 ? '' : tr(LEVEL_KEYS[level]));

/** What the strength meter says to a screen reader: the label, or that nothing was entered. */
export const meterValueText = (level: StrengthLevel): string => (level === 0 ? tr('password.meter_empty') : tr(LEVEL_KEYS[level]));

/** The password rules in one sentence (the Product Owner's text), for a field that is still empty. */
export const rulesText = (): string => tr('password.rules', { min: MEMBER_MIN_LENGTH, adminMin: ADMIN_MIN_LENGTH });

/** One reason a password is refused. `length` is what is typed (as the rules count it) and `min` the minimum for this account. */
export function problemMessage(problem: PasswordProblem, length: number, min: number): string {
  if (problem === 'too_short') {
    return length === 0 ? rulesText() : tr('password.problem_too_short', { count: min - length, min });
  }
  return tr(PROBLEM_KEYS[problem], problem === 'too_long' ? { max: MAX_LENGTH } : undefined);
}

/** Every reason, one after the other, in the order the rules list them. */
export const problemMessages = (problems: readonly PasswordProblem[], length: number, min: number): string =>
  problems.map((problem) => problemMessage(problem, length, min)).join(' ');
