// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ERRORS } from '../../src/worker/errors';
import { ROOT } from './helpers/scan';

// Addendum 4.6 L1 / design.md 20.2: every error answer of the Worker carries a stable `code` from ONE registry (src/worker/errors.ts), and the
// client catalogue has the text for every code in every language. Reads the sources, so it runs in Node.

const WORKER = path.join(ROOT, 'src', 'worker');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const entry = path.join(dir, name);
    return statSync(entry).isDirectory() ? (name === 'site' ? [] : walk(entry)) : entry.endsWith('.ts') ? [entry] : [];
  });
const sources = walk(WORKER).map((file) => ({ file: path.relative(ROOT, file), text: readFileSync(file, 'utf8') }));
const codes = Object.keys(ERRORS);

const used = (pattern: RegExp): { file: string; code: string }[] =>
  sources.flatMap(({ file, text }) => [...text.matchAll(pattern)].map((match) => ({ file, code: match[1] })));

describe('the error-code registry', () => {
  it('has every code a route writes: apiError(c, code), and code: <literal> in an answer or a gate', () => {
    const written = [...used(/apiError\(\s*c,\s*'([a-z_0-9]+)'/g), ...used(/\bcode: '([a-z_0-9]+)'/g)].filter(
      (entry) => entry.file !== 'src/worker/errors.ts'
    );
    expect(written.length).toBeGreaterThan(40);
    expect(written.filter((entry) => !codes.includes(entry.code)).map((entry) => `${entry.file}: ${entry.code}`)).toEqual([]);
  });

  it('gives every code one English text of its own (the fallback maps an uncoded answer by its text) and a plausible status', () => {
    const texts = Object.values(ERRORS).map((entry) => entry.error);
    expect(texts.filter((text, index) => texts.indexOf(text) !== index)).toEqual([]);
    for (const [code, entry] of Object.entries(ERRORS)) {
      expect(code, code).toMatch(/^[a-z][a-z_0-9]*$/);
      expect(entry.status, code).toBeGreaterThanOrEqual(400);
      expect(entry.status, code).toBeLessThan(600);
    }
  });

  it('has a text in the client catalogue (err.<code>) in all three languages', () => {
    for (const language of ['en', 'vi', 'zh-CN']) {
      const catalogue: Record<string, string | undefined> = JSON.parse(
        readFileSync(path.join(ROOT, 'src', 'shared', 'i18n', 'locales', `${language}.json`), 'utf8')
      ) as Record<string, string>;
      expect(codes.filter((code) => catalogue[`err.${code}`] === undefined).map((code) => `${language}: err.${code}`)).toEqual([]);
    }
  });

  it('is not bypassed: every { success: false } answer a route writes carries its code (or is built by apiError)', () => {
    const uncoded = sources
      .filter(({ file }) => file !== 'src/worker/errors.ts')
      .flatMap(({ file, text }) =>
        [...text.matchAll(/success: false,[^}]*\}/g)].filter((match) => !match[0].includes('code')).map((match) => `${file}: ${match[0]}`)
      );
    expect(uncoded).toEqual([]);
  });
});
