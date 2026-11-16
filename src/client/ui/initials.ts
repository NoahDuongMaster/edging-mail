/** The first character of a word, upper-cased (a whole character, not half of a surrogate pair). */
const firstLetter = (word: string): string => String.fromCodePoint(word.codePointAt(0) ?? 63).toUpperCase();

/** Han (Chinese characters, kanji), kana and Hangul: scripts where a name's initial is one whole character, not a letter. */
const CJK = /^[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

/** Do these initials (or this name) start with a CJK character? Such an avatar shows ONE character, a little larger (ui.css). */
export const isCjk = (text: string): boolean => CJK.test(text);

/**
 * The letters shown in an avatar for a name or an address, the same rule on every avatar of the app: the first letter of the first and of
 * the last word ("Noah Duong" is "ND"), one letter for a single word, the part before the @ for an address (dots, dashes and underscores
 * split words). A name in Chinese, Japanese or Korean script gives ONE character, its first ("李明" and "李 明" are "李"): two
 * characters do not fit a 32px circle legibly. A name with nothing to show gives "?".
 */
export function initialsOf(name: string): string {
  const base = name.includes('@') ? name.slice(0, name.indexOf('@')) : name;
  const words = base.split(/[\s._-]+/u).filter((word) => word !== '');
  const first = words.at(0);
  const last = words.at(-1);
  if (first === undefined || last === undefined) {
    return '?';
  }
  return words.length === 1 || isCjk(first) ? firstLetter(first) : firstLetter(first) + firstLetter(last);
}
