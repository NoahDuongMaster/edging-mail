// Random choices for the password screens: an unbiased index, the admin passphrase and the one-time password of a new account.
// Randomness comes from crypto.getRandomValues, and every pick rejects the values that would make some answers likelier than others.

/** Fills the array with random 32-bit values. Replaced in tests; the browser's generator in the app. */
export type RandomFill = (array: Uint32Array<ArrayBuffer>) => Uint32Array<ArrayBuffer>;

const browserFill: RandomFill = (array) => crypto.getRandomValues(array);

/** A uniform integer in [0, n). The 2^32 values are cut at the largest multiple of n and the rest is rejected, so there is no modulo bias. */
export function randomIndex(n: number, fill: RandomFill = browserFill): number {
  if (!Number.isInteger(n) || n < 1 || n > 2 ** 32) {
    throw new RangeError('randomIndex needs an integer from 1 to 2^32');
  }
  const limit = Math.floor(2 ** 32 / n) * n;
  const buffer = new Uint32Array(1);
  for (;;) {
    const value = fill(buffer).at(0) ?? limit;
    if (value < limit) {
      return value % n;
    }
  }
}

export const PASSPHRASE_WORDS = 6;

/** Words from the list, each picked independently and uniformly, joined with hyphens. With 2048 words that is 11 bits a word. */
export function generatePassphrase(words: readonly string[], count = PASSPHRASE_WORDS, fill?: RandomFill): string {
  if (words.length < 2) {
    throw new RangeError('generatePassphrase needs a word list of at least 2 words');
  }
  return Array.from({ length: count }, () => words[randomIndex(words.length, fill)]).join('-');
}

// No 0/O, 1/l/I: the admin reads this out or types it from a screen, and the member types it from what they were told.
const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
const TEMP_GROUPS = 4;
const TEMP_GROUP_LENGTH = 5;

/** One-time password for a new account: 20 characters (about 117 bits) in four groups of five, e.g. `Kq7mP-x3RtN-w9HcA-e2VbZ`. */
export function generateTempPassword(fill?: RandomFill): string {
  const group = () => Array.from({ length: TEMP_GROUP_LENGTH }, () => TEMP_ALPHABET[randomIndex(TEMP_ALPHABET.length, fill)]).join('');
  return Array.from({ length: TEMP_GROUPS }, group).join('-');
}
