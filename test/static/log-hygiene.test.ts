// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers/scan';

// Round 5, logging: the Worker logs the CLASS of an error, never its message, its stack or the error object (a message can carry a file name, an
// address or the SQL parameters of a failed write). This reads every console call of the Worker and refuses one that passes anything of a caught error
// except `errorClass(error)`. Reads the sources, so it runs in Node.

const WORKER = path.join(ROOT, 'src', 'worker');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const entry = path.join(dir, name);
    return statSync(entry).isDirectory() ? (name === 'site' ? [] : walk(entry)) : entry.endsWith('.ts') ? [entry] : [];
  });

/** The arguments of every console call in `text`, with `errorClass(x)` and the literal text of strings removed (what is left is code). */
const consoleArguments = (text: string): string[] =>
  [...text.matchAll(/console\.(?:error|warn|log|info|debug)\(([\s\S]*?)\);/g)].map((match) =>
    match[1]
      .replaceAll(/errorClass\(\s*\w+\s*\)/g, '')
      .replaceAll(/`([^`]*)`/g, (_whole, inner: string) =>
        [...inner.matchAll(/\$\{([^}]*)\}/g)].map((expression) => expression[1]).join(' ')
      )
      .replaceAll(/'[^']*'|"[^"]*"/g, '')
  );

const leaks = (code: string): boolean => /\berrorMessage\b|\.message\b|\.stack\b|\b(?:error|err|cause|reason|e)\b/.test(code);

describe('logging hygiene: a caught error is logged by its class only', () => {
  it('knows a leak when it sees one (the scanner itself)', () => {
    const bad = [
      "console.error('x failed:', error);",
      "console.error('x failed:', errorMessage(error));",
      `console.error(\`x failed: \${error.message}\`);`,
      "console.error('x failed:', (error as Error).stack);",
      "console.warn('x', cause);",
      // The inbound failure line: a stage word is fine, but the error itself (or its message) is not
      `console.error(\`x failed at stage \${stage}: \${error}\`);`,
      `console.warn(\`x failed on attempt \${tries}: \${error.message}\`);`
    ];
    const good = [
      "console.error('x failed:', errorClass(error));",
      `console.error(\`x failed with HTTP \${response.status}\`);`,
      "console.error('[edging-mail] Could not do it:', errorClass(error));",
      `console.error(\`x failed at stage \${stage}: \${errorClass(error)}\`);`,
      `console.warn(\`x: \${stage} failed on attempt \${tries} of \${ATTEMPTS}, trying again: \${errorClass(error)}\`);`
    ];
    for (const sample of bad) {
      expect(consoleArguments(sample).some(leaks), sample).toBe(true);
    }
    for (const sample of good) {
      expect(consoleArguments(sample).some(leaks), sample).toBe(false);
    }
  });

  it('holds for every console call in src/worker', () => {
    const offenders: string[] = [];
    let calls = 0;
    for (const file of walk(WORKER)) {
      const text = readFileSync(file, 'utf8');
      for (const code of consoleArguments(text)) {
        calls += 1;
        if (leaks(code)) {
          offenders.push(`${path.relative(ROOT, file)}: ${code.trim().slice(0, 100)}`);
        }
      }
    }
    expect(calls).toBeGreaterThan(40);
    expect(offenders).toEqual([]);
  });
});
