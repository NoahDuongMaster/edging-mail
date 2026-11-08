/** The first character of a word, upper-cased (a whole character, not half of a surrogate pair). */
const firstLetter = (word: string): string => String.fromCodePoint(word.codePointAt(0) ?? 63).toUpperCase();

/**
 * The letters shown in an avatar for a name or an address: the first letter of the first and of the last word ("Noah Duong" is "ND"),
 * one letter for a single word, the part before the @ for an address (dots, dashes and underscores split words), and the first
 * character for names written without spaces. A name with nothing to show gives "?".
 */
export function initialsOf(name: string): string {
  const base = name.includes('@') ? name.slice(0, name.indexOf('@')) : name;
  const words = base.split(/[\s._-]+/u).filter((word) => word !== '');
  const first = words.at(0);
  const last = words.at(-1);
  if (first === undefined || last === undefined) {
    return '?';
  }
  return words.length === 1 ? firstLetter(first) : firstLetter(first) + firstLetter(last);
}
