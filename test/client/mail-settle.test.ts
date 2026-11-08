import { describe, expect, it } from 'vitest';
import { MAX_PASSES, settle } from '../../src/client/lib/mailSettle';

// PX-15: the frame parses the TEXT of a mail's document, and markup can be read differently the second time. `settle` is the loop that reads the text back
// until it stops changing. It has no DOM, so it is tested here with readings written as plain string functions; `scripts/frame-probe.mjs` runs the real
// builder, with a real parser, on the mutation markup in browsers.

/** A "reading" that peels one wrapper off per pass, like a parser that shows one more layer each time. */
const peel = (text: string): string => text.replace(/^<w>(.*)<\/w>$/, '$1');

/** An `x` inside `count` wrappers. */
const layers = (count: number): string => `${'<w>'.repeat(count)}x${'</w>'.repeat(count)}`;

// A model of the mutation: first reading, the link is inside a comment, so a check of that tree sees no link. Second reading, the comment is gone and the link is an
// element.
const uncomment = (text: string): string => text.replace('<!--', '').replace('-->', '');
/** What a check of the first tree does: it removes the links it can see, and a comment is not an element, so a link inside one is not seen. */
const removeLinks = (text: string): string =>
  text.replaceAll(/<!--.*?-->|<link[^>]*>/g, (found) => (found.startsWith('<!--') ? found : ''));
const reread = (text: string): string => removeLinks(uncomment(text));

describe('settle', () => {
  it('returns the text after one rereading when reading it again changes nothing', () => {
    let calls = 0;
    const result = settle('<p>x</p>', (text) => {
      calls += 1;
      return text;
    });
    expect(result).toBe('<p>x</p>');
    expect(calls).toBe(1);
  });

  it('rereads what the last reading gave until the text stops changing, and returns that fixed point', () => {
    const result = settle('<w><w>x</w></w>', peel);
    expect(result).toBe('x');
    expect(peel(result ?? '')).toBe(result);
  });

  it('settles at the limit and not past it: MAX_PASSES rereadings allow MAX_PASSES - 1 changes', () => {
    expect(settle(layers(MAX_PASSES - 1), peel)).toBe('x');
    expect(settle(layers(MAX_PASSES), peel)).toBeUndefined();
  });

  it('gives up on a text that keeps growing, and calls the reading no more often than the limit', () => {
    let calls = 0;
    const result = settle('start', (text) => {
      calls += 1;
      return `${text}+`;
    });
    expect(result).toBeUndefined();
    expect(calls).toBe(MAX_PASSES);
  });

  it('gives up on a text that flips between two readings', () => {
    expect(settle('a', (text) => (text === 'a' ? 'b' : 'a'))).toBeUndefined();
  });

  it('finds what the first text hid: a link inside a comment that the second reading turns into an element is removed by the rereading', () => {
    const first = '<!--<link rel=prerender href=x>-->hi';
    // What a single pass would have handed to the frame still carries the link:
    expect(removeLinks(first)).toContain('<link');
    // The loop hands over text with none, and rereading it changes nothing.
    const settled = settle(first, reread);
    expect(settled).toBe('hi');
    expect(reread(settled ?? '')).toBe(settled);
  });
});
