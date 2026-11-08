// PX-15: the frame parses the TEXT of a mail's document, not the tree that was checked. Markup can be read differently the second time (a `<link>` that is text
// in the first tree is an element in the second, `<form><math><mtext></form><form><mglyph><style></math><link ...>` is the known shape), so a document that was
// made safe once can be unsafe when the frame reads it. `buildMailDocument` therefore reads its own text again and makes it safe again until the text stops
// changing. This is the loop, without a DOM, so that it can be tested: `reread` takes the text of a document, parses it, makes the tree safe and writes it out.

/** How many times the text may change before the markup is taken to have no stable reading. */
export const MAX_PASSES = 4;

/**
 * Runs `reread` on `first`, then on what it returned, until it returns what it was given: that text is a fixed point, so the frame, which parses exactly it,
 * gets a tree that `reread` would not change. `undefined` when the text still changed after `MAX_PASSES` rereadings (it never settled): show none of it.
 */
export function settle(first: string, reread: (text: string) => string): string | undefined {
  let text = first;
  for (let pass = 0; pass < MAX_PASSES; pass += 1) {
    const next = reread(text);
    if (next === text) {
      return text;
    }
    text = next;
  }
  return undefined;
}
