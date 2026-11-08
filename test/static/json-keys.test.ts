// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '../../src/shared/i18n/languages';
import { ROOT, walk } from './helpers/scan';

// JSON allows a key twice and a parser keeps the last one, so a doubled entry (a text pasted in twice, a merge that kept both sides) is silent: one
// of the two texts never shows, and nothing fails. This reads the TEXT of every catalogue file (the app's three languages, the server's push
// texts, the translators' notes, the glossary) with a small scanner that sees every key, and lists a key that an object holds more than once.

/** The keys that appear twice in one object of a JSON text, as "path > key". Throws on text that is not JSON. */
export function duplicateKeys(text: string): string[] {
  const duplicates: string[] = [];
  let at = 0;
  const skip = (): void => {
    while (at < text.length && ' \n\r\t'.includes(text.charAt(at))) {
      at += 1;
    }
  };
  const take = (char: string): void => {
    skip();
    if (text.charAt(at) !== char) {
      throw new Error(`expected "${char}" at ${String(at)}`);
    }
    at += 1;
  };
  /** After an item of an object or an array: true when another follows (a comma), false at the closing bracket. */
  const more = (close: string): boolean => {
    skip();
    if (text.charAt(at) === ',') {
      at += 1;
      return true;
    }
    take(close);
    return false;
  };
  /** A string starting at the opening quote, with its escapes left as they are (two spellings of one key are rare enough to leave alone). */
  const string = (): string => {
    take('"');
    let out = '';
    while (at < text.length && text.charAt(at) !== '"') {
      const step = text.charAt(at) === '\\' ? 2 : 1;
      out += text.slice(at, at + step);
      at += step;
    }
    take('"');
    return out;
  };
  const object = (where: string): void => {
    take('{');
    skip();
    if (text.charAt(at) === '}') {
      at += 1;
      return;
    }
    const seen = new Set<string>();
    do {
      skip();
      const key = string();
      const here = where === '' ? key : `${where} > ${key}`;
      if (seen.has(key)) {
        duplicates.push(here);
      }
      seen.add(key);
      take(':');
      // eslint-disable-next-line @typescript-eslint/no-use-before-define -- object, array and value call each other
      value(here);
    } while (more('}'));
  };
  const array = (where: string): void => {
    take('[');
    skip();
    if (text.charAt(at) === ']') {
      at += 1;
      return;
    }
    let index = 0;
    do {
      // eslint-disable-next-line @typescript-eslint/no-use-before-define -- object, array and value call each other
      value(`${where}[${String(index)}]`);
      index += 1;
    } while (more(']'));
  };
  const value = (where: string): void => {
    skip();
    const char = text.charAt(at);
    switch (char) {
      case '{': {
        object(where);
        break;
      }
      case '[': {
        array(where);
        break;
      }
      case '"': {
        string();
        break;
      }
      default: {
        // A number, true, false or null: everything up to the next separator.
        const start = at;
        while (at < text.length && !',}] \n\r\t'.includes(text.charAt(at))) {
          at += 1;
        }
        if (start === at) {
          throw new Error(`unexpected "${char}" at ${String(at)}`);
        }
      }
    }
  };
  value('');
  skip();
  if (at !== text.length) {
    throw new Error(`text after the JSON value at ${String(at)}`);
  }
  return duplicates;
}

describe('the duplicate-key scanner', () => {
  it('finds a key an object holds twice, at any depth, and names where', () => {
    expect(duplicateKeys('{"a":1,"b":2,"a":3}')).toEqual(['a']);
    expect(duplicateKeys('{"x":{"c":1,"c":2},"y":[{"d":1,"d":2}]}')).toEqual(['x > c', 'y[0] > d']);
    expect(duplicateKeys('{"a":1,"a":1,"a":1}')).toEqual(['a', 'a']);
  });

  it('does not mistake the same key in two objects, escapes, numbers, nesting or empty containers for a duplicate', () => {
    expect(duplicateKeys('{"a":{"k":1},"b":{"k":2},"c":[],"d":{},"e":[1,2.5e3,-4,true,false,null]}')).toEqual([]);
    expect(duplicateKeys(String.raw`{"q\"uote":"v, \" } {","r":"\\"}`)).toEqual([]);
    expect(duplicateKeys('{\n  "a": "x",\n  "b": [ {"a": 1}, {"a": 2} ]\n}\n')).toEqual([]);
    expect(duplicateKeys('"just a string"')).toEqual([]);
  });

  it('refuses text that is not JSON instead of passing it', () => {
    expect(() => duplicateKeys('{"a":1,}')).toThrow();
    expect(() => duplicateKeys('{"a" 1}')).toThrow();
    expect(() => duplicateKeys('{"a":1} extra')).toThrow();
  });
});

const catalogues = walk(path.join(ROOT, 'src', 'shared', 'i18n'), ['.json']);

describe('the catalogue files', () => {
  it('are found (the check below would pass on an empty list otherwise)', () => {
    const names = catalogues.map((file) => path.relative(path.join(ROOT, 'src', 'shared', 'i18n'), file));
    expect(names).toEqual(expect.arrayContaining([...LOCALES.flatMap((tag) => [`locales/${tag}.json`, `locales/server/${tag}.json`])]));
  });

  it.each(catalogues.map((file) => [path.relative(ROOT, file), file] as const))('%s has no key twice in one object', (_name, file) => {
    expect(duplicateKeys(readFileSync(file, 'utf8'))).toEqual([]);
  });
});
