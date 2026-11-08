// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { allowed } from './helpers/allow';
import { ROOT, clientFiles, hardcoded, localeProblems } from './helpers/scan';

// The client shows no text of its own: every sentence, label, tooltip and toast comes from the catalogue (design.md 20.3 c, d).

const files = clientFiles();
const show = (findings: { file: string; line: number; kind: string; text: string }[]): string[] =>
  findings.map((finding) => `${finding.file}:${finding.line} ${finding.kind}: ${finding.text}`);

describe('src/client', () => {
  it('has no hard-coded user-visible string (JSX text, aria-label, title, placeholder, alt, label, toast and dialog texts)', () => {
    expect(show(files.flatMap((file) => hardcoded(file, allowed)))).toEqual([]);
  });

  it('formats dates, times and numbers only through fmt (no toLocale*String, no Intl formatter with a locale of its own)', () => {
    expect(show(files.flatMap((file) => localeProblems(file)))).toEqual([]);
  });

  it('never finds an element by a visible string (aria-label, title, alt, placeholder): such a selector breaks when the language changes', () => {
    const SELECTOR_CALL = /(querySelector(All)?|closest|matches)\(/;
    const BY_TEXT = /\[\s*(aria-label|title|alt|placeholder)\s*[$*^~|]?=/;
    const problems = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, index) =>
          SELECTOR_CALL.test(line) && BY_TEXT.test(line) ? [`${path.relative(ROOT, file)}:${index + 1} ${line.trim()}`] : []
        )
    );
    expect(problems).toEqual([]);
  });
});
