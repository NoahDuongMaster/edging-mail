import { codePoints, normalizePassword } from './policy';

// The common-password check. The data is a few thousand entries bundled with the app (data/SOURCES.md); it is loaded on demand and never
// from a network. The normalisation below (NFKC, lower case, strip digits and symbols from both ends) is the one the lists were built with.

export interface PasswordData {
  /** Common words and names, 4 to 24 letters. A password that is one of them with digits and symbols at the ends is common. */
  roots: ReadonlySet<string>;
  /** Common passwords of 12 characters or more, matched whole. */
  long: ReadonlySet<string>;
  /** The passphrase word list, in order. */
  words: readonly string[];
  /** Roots and passphrase words: what the strength estimate treats as one guessable word. */
  dictionary: ReadonlySet<string>;
}

interface RawPasswordData {
  long: string;
  roots: string;
  words: string;
}

const lines = (raw: string): string[] => raw.split('\n').filter((line) => line.length > 0);

export function parsePasswordData(raw: RawPasswordData): PasswordData {
  const roots = new Set(lines(raw.roots));
  const words = lines(raw.words);
  return { roots, long: new Set(lines(raw.long)), words, dictionary: new Set([...roots, ...words]) };
}

/** The data is its own chunk: a person who never sets a password never downloads it. */
export async function loadPasswordData(): Promise<PasswordData> {
  const { rawData } = await import('./data');
  return parsePasswordData(rawData);
}

// Look-alike swaps. `1` can stand for i or l, so there are two maps; everything else is one-to-one.
const SWAPS: Record<string, string> = {
  '0': 'o',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '9': 'g',
  '@': 'a',
  $: 's',
  '!': 'i',
  '+': 't'
};
const LEET_MAPS: readonly Record<string, string>[] = [
  { ...SWAPS, '1': 'i' },
  { ...SWAPS, '1': 'l' }
];

/** The text with the look-alike characters turned into letters, and how many were turned. One entry per map. */
export function unleet(text: string): { text: string; swapped: number }[] {
  return LEET_MAPS.map((map) => {
    let swapped = 0;
    const out = codePoints(text.toLowerCase())
      .map((char) => {
        if (!Object.hasOwn(map, char)) {
          return char;
        }
        swapped += 1;
        return map[char];
      })
      .join('');
    return { text: out, swapped };
  });
}

const stripEnds = (text: string): string => text.replaceAll(/^[^a-z]+|[^a-z]+$/g, '');

/** `abcabc` -> true when `abc` is a root: one common word typed twice or more. */
function isRepeatedRoot(core: string, roots: ReadonlySet<string>): boolean {
  for (let unit = 4; unit * 2 <= core.length; unit += 1) {
    if (core.length % unit === 0 && roots.has(core.slice(0, unit)) && core === core.slice(0, unit).repeat(core.length / unit)) {
      return true;
    }
  }
  return false;
}

const MAX_TAIL = 12;
const MAX_HEAD = 6;

/**
 * The letters of a password as a guesser would try them: with 0 to 12 digits and symbols cut off the end and 0 to 6 off the front (only
 * digits and symbols are ever cut, never letters), then as typed and with the look-alike swaps undone. `p4ssw0rd123` gives `password`
 * with the tail `123` cut; `password123` is not mistaken for `passwordize` because the swaps run after the cut.
 */
function guessableCores(plain: string): Set<string> {
  const tailRun = /[^a-z]*$/.exec(plain)?.[0].length ?? 0;
  const headRun = /^[^a-z]*/.exec(plain)?.[0].length ?? 0;
  const cores = new Set<string>();
  for (let tail = 0; tail <= Math.min(tailRun, MAX_TAIL); tail += 1) {
    for (let head = 0; head <= Math.min(headRun, MAX_HEAD); head += 1) {
      const slice = plain.slice(head, plain.length - tail);
      cores.add(stripEnds(slice));
      for (const { text } of unleet(slice)) {
        cores.add(stripEnds(text));
      }
    }
  }
  return cores;
}

/** Whether the password is a common one: a listed long password, or a listed word with decoration, look-alike swaps or repetition. */
export function isCommonPassword(password: string, data: Pick<PasswordData, 'roots' | 'long'>): boolean {
  const plain = normalizePassword(password).toLowerCase();
  if (data.long.has(plain)) {
    return true;
  }
  for (const core of guessableCores(plain)) {
    if (core.length >= 4 && (data.roots.has(core) || isRepeatedRoot(core, data.roots))) {
      return true;
    }
  }
  return false;
}
