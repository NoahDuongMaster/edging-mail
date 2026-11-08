// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '../../src/shared/i18n/languages';
import { ROOT } from './helpers/scan';

// Adding a language must touch no sentence of the Worker (docs/i18n.md, step 6): an English message that lists the languages is built from LOCALES.
// This reads the Worker's sources and refuses a string that names two or more language tags by hand. Reads files, so it runs in Node.

const WORKER = path.join(ROOT, 'src', 'worker');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const entry = path.join(dir, name);
    // the public site has its own list of languages (it also carries a path): src/worker/site/languages.ts
    return statSync(entry).isDirectory() ? (name === 'site' ? [] : walk(entry)) : entry.endsWith('.ts') ? [entry] : [];
  });

const tag = LOCALES.map((locale) => locale.replaceAll('-', String.raw`\-`)).join('|');
const TWO_TAGS_IN_ONE_STRING = new RegExp(`(['"\`])[^'"\`\\n]*\\b(?:${tag})\\b[^'"\`\\n]*\\b(?:${tag})\\b[^'"\`\\n]*\\1`);

describe('the Worker does not list the languages by hand', () => {
  it('has no string that names two language tags (the sentences are built from LOCALES)', () => {
    const offenders = walk(WORKER).flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .map((line, index) => ({ line, at: `${path.relative(ROOT, file)}:${index + 1}` }))
        .filter(({ line }) => !/^\s*(?:\/\/|\*|\/\*)/.test(line) && TWO_TAGS_IN_ONE_STRING.test(line))
        .map(({ line, at }) => `${at}: ${line.trim()}`)
    );
    expect(offenders).toEqual([]);
  });

  it('would see one (the pattern itself)', () => {
    expect(TWO_TAGS_IN_ONE_STRING.test("const reason = 'language must be vi, en or zh-CN';")).toBe(true);
    expect(TWO_TAGS_IN_ONE_STRING.test("const reason = 'language must be ' + LANGUAGE_CHOICES;")).toBe(false);
    expect(TWO_TAGS_IN_ONE_STRING.test("import zh from '../shared/i18n/locales/server/zh-CN.json';")).toBe(false);
  });
});
