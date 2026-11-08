// @vitest-environment node
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers/scan';

// crypto-review.md 19.3 (a): closing the sockets with the "renewed" code (4402) is right only where the SAME answer gives the caller a fresh
// cookie and the key stays valid. Any other route that passes `renewed` would keep a browser unlocked after its session was revoked, so the list
// is fixed here: a new route must be added on purpose. Reads the sources, so it runs in Node.

const WORKER = path.join(ROOT, 'src', 'worker');
const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const entry = path.join(dir, name);
    return statSync(entry).isDirectory() ? (name === 'site' ? [] : walk(entry)) : entry.endsWith('.ts') ? [entry] : [];
  });

/** `<file>: POST <path>` for every call of closeSockets that passes `renewed`, found by the route registration that precedes it. */
const renewedRoutes = (text: string, file: string): string[] =>
  [...text.matchAll(/closeSockets\([^)]*\brenewed:\s*true\b[^)]*\)/g)].map((match) => {
    const before = text.slice(0, match.index);
    const routes = [...before.matchAll(/\w+Routes\.(post|get|put|patch|delete)\(\s*'([^']+)'/g)];
    const route = routes.at(-1);
    return `${file}: ${route === undefined ? 'no route' : `${route[1].toUpperCase()} ${route[2]}`}`;
  });

describe('closeSockets(..., { renewed })', () => {
  it('knows a call when it sees one (the scanner itself)', () => {
    const sample =
      "x.post('/a', async () => {});\nfooRoutes.post('/b', async (c) => {\n  await closeSockets(c.env, id, { renewed: true });\n});";
    expect(renewedRoutes(sample, 'f.ts')).toEqual(['f.ts: POST /b']);
    expect(renewedRoutes('await closeSockets(env, id);', 'f.ts')).toEqual([]);
  });

  it('is passed by exactly change-password, 2fa/enroll/confirm, 2fa/disable and 2fa/recovery-codes', () => {
    const found = walk(WORKER).flatMap((file) => renewedRoutes(readFileSync(file, 'utf8'), path.basename(file)));
    expect(found.toSorted()).toEqual(
      [
        'credentials.ts: POST /change-password',
        'two-factor.ts: POST /2fa/disable',
        'two-factor.ts: POST /2fa/enroll/confirm',
        'two-factor.ts: POST /2fa/recovery-codes'
      ].toSorted()
    );
  });
});
