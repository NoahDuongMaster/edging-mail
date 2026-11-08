import { describe, expect, it } from 'vitest';
import { ERRORS } from '../src/worker/errors';
import { app } from '../src/worker/index';

// AC40, docs against code: docs/api.md names every route of the Worker (method and path) and no route that does not exist, and its table of error codes is the
// registry of src/worker/errors.ts (same codes, same status, same English text). The routes are DERIVED from the Hono route table (app.routes), like
// test/gate.test.ts, so a route added tomorrow fails here until the document has it. The document is read as text (there is no file system in workerd).

const [API] = Object.values(import.meta.glob<string>('../docs/api.md', { query: '?raw', import: 'default', eager: true }));

/** `:id` and `:address` are the same thing to this test: a path parameter. */
const normalise = (path: string): string => path.replaceAll(/:\w+/g, ':param');

/** Every `METHOD /api/...` the document writes in backticks (a query string after the path is not part of the route). */
function documentedRoutes(): Set<string> {
  const found = new Set<string>();
  for (const match of API.matchAll(/`(GET|POST|PUT|PATCH|DELETE) (\/api[^`\s?]*)/g)) {
    found.add(`${match[1]} ${normalise(match[2])}`);
  }
  return found;
}

function codedRoutes(): Set<string> {
  const found = new Set<string>();
  for (const route of app.routes) {
    // `app.use(...)` is registered as ALL; the handlers behind it are the routes.
    if (route.method !== 'ALL' && route.path.startsWith('/api/')) {
      found.add(`${route.method} ${normalise(route.path)}`);
    }
  }
  return found;
}

describe('docs/api.md and the routes of the Worker', () => {
  it('names every route of the Worker', () => {
    const documented = documentedRoutes();
    expect([...codedRoutes()].filter((route) => !documented.has(route)).toSorted()).toEqual([]);
  });

  it('names no route that the Worker does not have', () => {
    const coded = codedRoutes();
    expect([...documentedRoutes()].filter((route) => !coded.has(route)).toSorted()).toEqual([]);
  });

  it('sees a real number of routes (the test itself is not blind)', () => {
    expect(codedRoutes().size).toBeGreaterThan(55);
    expect(documentedRoutes().size).toBeGreaterThan(55);
  });
});

/** `| \`code\` | 400 | text |` rows after the "## Errors" heading. */
function documentedErrors(): Map<string, { status: number; text: string }> {
  const table = API.slice(API.indexOf('\n## Errors'));
  return new Map(
    [...table.matchAll(/^\| `([a-z_0-9]+)`\s*\| (\d{3})\s*\| (.*?)\s*\|$/gm)].map((match) => [
      match[1],
      { status: Number(match[2]), text: match[3] }
    ])
  );
}

describe('the table of error codes in docs/api.md', () => {
  it('has a row for every code of the registry and none for a code that does not exist', () => {
    const documented = documentedErrors();
    expect([...documented.keys()].filter((code) => !(code in ERRORS)).toSorted()).toEqual([]);
    expect(
      Object.keys(ERRORS)
        .filter((code) => !documented.has(code))
        .toSorted()
    ).toEqual([]);
  });

  it('gives each code the status and the English text of the registry', () => {
    const documented = documentedErrors();
    const different = Object.entries(ERRORS)
      .map(([code, entry]) => {
        const row = documented.get(code);
        return { code, expected: `${entry.status} ${entry.error}`, written: row === undefined ? 'no row' : `${row.status} ${row.text}` };
      })
      .filter(({ expected, written }) => expected !== written);
    expect(different).toEqual([]);
  });
});
