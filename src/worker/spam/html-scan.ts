// A single-pass HTML scanner for the spam filter: the links (target and visible text), the images, the text a reader sees and the text hidden from them.
// Mail HTML is hostile input, so this is not a parser: it reads at most MAX_HTML_CHARS characters, moves forward only (every step consumes what it read and
// nothing is read twice), keeps every collection bounded, and never throws. No library: htmlparser2 would add a dependency (and a NOTICE entry) for what
// four rules need, and its work on a 190 kB hostile document is not smaller than this scan's.

import { isHiddenStyle } from './html-style';
import { printedLength, readable } from './html-text';

/** The most characters of HTML that are read. */
export const MAX_HTML_CHARS = 200_000;
// Visible text is kept for the phrase scan up to this many characters.
const MAX_VISIBLE_CHARS = 20_000;
const MAX_ANCHORS = 1000;
const MAX_ANCHOR_TEXT = 300;
// Open elements remembered (for hiding); deeper ones are read but not tracked.
const MAX_DEPTH = 64;
// A style or a link longer than this is cut before it is looked at.
const MAX_ATTRIBUTE = 4096;

export interface Anchor {
  href: string;
  /** The text between `<a>` and `</a>`, as it reads, at most 300 characters. */
  text: string;
}

export interface HtmlScan {
  anchors: Anchor[];
  imageCount: number;
  /** What a reader sees: the text outside hidden elements, blanks collapsed, at most 20000 characters. */
  visibleText: string;
  /** How many printed characters the visible text holds (all of it, not only the part kept in `visibleText`). */
  visibleLength: number;
  /** How many printed characters sit inside hidden elements. */
  hiddenLength: number;
}

const VOID: ReadonlySet<string> = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr'
]);
// Elements whose content is not text a reader sees: skipped up to their closing tag.
const RAW_TEXT: ReadonlySet<string> = new Set(['script', 'style', 'title']);
// Tags that end a line or a block: a space stands in for them, so "Hello<br>World" does not read "HelloWorld".
const BLOCK: ReadonlySet<string> = new Set([
  'br',
  'p',
  'div',
  'tr',
  'td',
  'th',
  'li',
  'ul',
  'ol',
  'table',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'blockquote',
  'section',
  'article',
  'header',
  'footer',
  'pre'
]);

const SPACES: ReadonlySet<string> = new Set([' ', '\t', '\n', '\f', '\r']);
const NAME_END: ReadonlySet<string> = new Set([...SPACES, '/', '>']);
const ATTRIBUTE_END: ReadonlySet<string> = new Set([...SPACES, '=', '>', '/']);
const UNQUOTED_END: ReadonlySet<string> = new Set([...SPACES, '>']);
const LETTER = /^[a-z]$/i;

interface Tag {
  name: string;
  href: string | undefined;
  style: string | undefined;
  /** Where the next read starts: just past the `>`, or the end of the input when the tag never ends. */
  end: number;
}

/** The first index at or after `from` whose character is in `stops`, or the end of the text. */
function skipUntil(html: string, from: number, stops: ReadonlySet<string>): number {
  let index = from;
  while (index < html.length && !stops.has(html.charAt(index))) {
    index += 1;
  }
  return index;
}

/** The first index at or after `from` that is not a blank. */
function skipSpaces(html: string, from: number): number {
  let index = from;
  while (index < html.length && SPACES.has(html.charAt(index))) {
    index += 1;
  }
  return index;
}

/** Reads the open tag that starts at `start` (a `<` and a letter): its name, its `href` and its `style`. */
function readOpenTag(html: string, start: number): Tag {
  const length = html.length;
  let index = skipUntil(html, start + 1, NAME_END);
  const name = html.slice(start + 1, Math.min(index, start + 33)).toLowerCase();
  let href: string | undefined;
  let style: string | undefined;
  while (index < length) {
    const char = html.charAt(index);
    if (char === '>') {
      index += 1;
      break;
    }
    if (SPACES.has(char) || char === '/') {
      index += 1;
      continue;
    }
    // An attribute name. It takes at least one character (an `=` that starts it belongs to the name), so every pass moves forward.
    const nameStart = index;
    index = skipUntil(html, index + 1, ATTRIBUTE_END);
    const attribute = html.slice(nameStart, Math.min(index, nameStart + 12)).toLowerCase();
    index = skipSpaces(html, index);
    if (html.charAt(index) !== '=') {
      continue;
    }
    index = skipSpaces(html, index + 1);
    const quote = html.charAt(index);
    let value: string;
    if (['"', "'"].includes(quote)) {
      const close = html.indexOf(quote, index + 1);
      const stop = close === -1 ? length : close;
      value = html.slice(index + 1, Math.min(stop, index + 1 + MAX_ATTRIBUTE));
      index = close === -1 ? length : close + 1;
    } else {
      const valueStart = index;
      index = skipUntil(html, index, UNQUOTED_END);
      value = html.slice(valueStart, Math.min(index, valueStart + MAX_ATTRIBUTE));
    }
    if (attribute === 'href') {
      href ??= value;
    } else if (attribute === 'style') {
      style ??= value;
    }
  }
  return { name, href, style, end: index };
}

/** Where the content of a script, style or title element ends: just past its closing tag (matched without regard to case), or the end of the input. */
function skipRawText(html: string, name: string, from: number): number {
  let at = html.indexOf('</', from);
  while (at !== -1) {
    if (html.slice(at + 2, at + 2 + name.length).toLowerCase() === name) {
      const close = html.indexOf('>', at);
      return close === -1 ? html.length : close + 1;
    }
    at = html.indexOf('</', at + 2);
  }
  return html.length;
}

/** Scans HTML (the first MAX_HTML_CHARS characters of it) in one pass. */
export function scanHtml(source: string): HtmlScan {
  const html = source.length > MAX_HTML_CHARS ? source.slice(0, MAX_HTML_CHARS) : source;
  const length = html.length;
  const anchors: Anchor[] = [];
  // The open elements, innermost last: each one's name and whether it hides its content.
  const names: string[] = [];
  const hides: boolean[] = [];
  const visible: string[] = [];
  let visibleChars = 0;
  let visibleLength = 0;
  let hiddenLength = 0;
  let hiddenDepth = 0;
  let imageCount = 0;
  let anchor: Anchor | null = null;

  const space = (): void => {
    if (visibleChars < MAX_VISIBLE_CHARS && hiddenDepth === 0) {
      visible.push(' ');
      visibleChars += 1;
    }
  };
  const addText = (raw: string): void => {
    const text = readable(raw);
    if (text.length === 0) {
      return;
    }
    if (hiddenDepth > 0) {
      hiddenLength += printedLength(text);
      return;
    }
    visibleLength += printedLength(text);
    if (anchor !== null && anchor.text.length < MAX_ANCHOR_TEXT) {
      anchor.text = (anchor.text + text).slice(0, MAX_ANCHOR_TEXT);
    }
    if (visibleChars < MAX_VISIBLE_CHARS) {
      const kept = text.slice(0, MAX_VISIBLE_CHARS - visibleChars);
      visible.push(kept);
      visibleChars += kept.length;
    }
  };
  const endAnchor = (): void => {
    if (anchor !== null && anchors.length < MAX_ANCHORS) {
      anchors.push({ href: anchor.href, text: anchor.text.trim() });
    }
    anchor = null;
  };
  // `</name>` closes the nearest open element of that name and everything opened inside it.
  const closeElement = (name: string): void => {
    const level = names.lastIndexOf(name);
    if (level === -1) {
      return;
    }
    for (let popped = names.length - 1; popped >= level; popped -= 1) {
      hiddenDepth -= hides[popped] ? 1 : 0;
    }
    names.length = level;
    hides.length = level;
  };

  let index = 0;
  let textStart = 0;
  while (index < length) {
    const lt = html.indexOf('<', index);
    if (lt === -1) {
      break;
    }
    const next = html.charAt(lt + 1);
    const markup = next === '!' || next === '?';
    // A `<` that does not start a tag (a letter, `/`, `!` or `?` follows) is text.
    if (!LETTER.test(next) && next !== '/' && !markup) {
      index = lt + 1;
      continue;
    }
    addText(html.slice(textStart, lt));
    if (markup) {
      // A comment runs to `-->`, a doctype or a processing instruction to the next `>`.
      const comment = html.startsWith('<!--', lt);
      const stop = comment ? html.indexOf('-->', lt + 4) : html.indexOf('>', lt + 2);
      index = stop === -1 ? length : stop + (comment ? 3 : 1);
    } else if (next === '/') {
      const stop = html.indexOf('>', lt + 2);
      const name = html
        .slice(lt + 2, stop === -1 ? length : Math.min(stop, lt + 34))
        .trim()
        .toLowerCase();
      if (name === 'a') {
        endAnchor();
      }
      if (BLOCK.has(name)) {
        space();
      }
      closeElement(name);
      index = stop === -1 ? length : stop + 1;
    } else {
      const tag = readOpenTag(html, lt);
      index = tag.end;
      if (BLOCK.has(tag.name)) {
        space();
      }
      if (tag.name === 'img') {
        imageCount += 1;
      }
      if (RAW_TEXT.has(tag.name)) {
        index = skipRawText(html, tag.name, tag.end);
      } else if (!VOID.has(tag.name)) {
        if (tag.name === 'a' && tag.href !== undefined) {
          endAnchor();
          anchor = { href: tag.href, text: '' };
        }
        if (names.length < MAX_DEPTH) {
          const hidden = tag.style !== undefined && isHiddenStyle(tag.style);
          names.push(tag.name);
          hides.push(hidden);
          hiddenDepth += hidden ? 1 : 0;
        }
      }
    }
    textStart = index;
  }
  addText(html.slice(textStart));
  endAnchor();
  return { anchors, imageCount, visibleText: visible.join('').replaceAll(/\s+/g, ' ').trim(), visibleLength, hiddenLength };
}
