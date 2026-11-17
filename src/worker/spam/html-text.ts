// Text as it reads on a screen: entities decoded, the characters that print nothing removed, blanks collapsed. Used on the text of a mail and on what the HTML
// scanner finds between tags. Every pattern here is linear (alternatives start with different characters, repeats are bounded).

// The named entities mail actually uses; an unknown name stands for one printed character.
const NAMED: ReadonlyMap<string, string> = new Map([
  ['nbsp', ' '],
  ['ensp', ' '],
  ['emsp', ' '],
  ['thinsp', ' '],
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
  ['zwnj', ''],
  ['zwj', ''],
  ['shy', ''],
  ['lrm', ''],
  ['rlm', ''],
  ['copy', '©'],
  ['reg', '®'],
  ['trade', '™'],
  ['hellip', '…'],
  ['mdash', '—'],
  ['ndash', '–'],
  ['lsquo', '‘'],
  ['rsquo', '’'],
  ['ldquo', '“'],
  ['rdquo', '”'],
  ['bull', '•'],
  ['middot', '·'],
  ['euro', '€'],
  ['pound', '£']
]);

const ENTITY = /&(?:#(\d{1,7})|#x([\da-f]{1,6})|([a-z][\da-z]{1,31}));/gi;
// Zero-width and other format characters, and the fillers mail uses as invisible padding (a preheader padded with U+034F or U+3164).
const INVISIBLE = /[\p{Cf}\u034F\u115F\u1160\u3164\uFFA0]/gu;

function fromCodePoint(code: number): string {
  // 0 and the surrogate range are not characters; past U+10FFFF there is nothing.
  return code === 0 || code > 0x10_ff_ff || (code >= 0xd8_00 && code <= 0xdf_ff) ? '' : String.fromCodePoint(code);
}

/** `&amp;`, `&#38;` and `&#x26;` decoded. An entity that is not known stands for one character. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) {
    return text;
  }
  return text.replaceAll(ENTITY, (_whole, decimal: string | undefined, hex: string | undefined, name: string | undefined) => {
    if (decimal !== undefined) {
      return fromCodePoint(Number.parseInt(decimal, 10));
    }
    if (hex !== undefined) {
      return fromCodePoint(Number.parseInt(hex, 16));
    }
    return NAMED.get((name ?? '').toLowerCase()) ?? '?';
  });
}

/** The invisible characters taken out and every run of blanks made one space, not trimmed. */
export const squeeze = (text: string): string => text.replaceAll(INVISIBLE, '').replaceAll(/\s+/g, ' ');

/** The text of a piece of HTML between tags, as it reads: entities decoded, invisible characters removed, blanks collapsed (leading and trailing ones kept as one). */
export const readable = (raw: string): string => squeeze(decodeEntities(raw));

/** How many printed characters a text holds (blanks and invisible characters do not count). */
export const printedLength = (text: string): number => text.replaceAll(INVISIBLE, '').replaceAll(/\s/g, '').length;
