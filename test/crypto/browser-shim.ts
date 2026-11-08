// A minimal stand-in for the part of Vitest that test/crypto/kat.test.ts uses (describe, it and a few expect matchers), so that the SAME file runs in a
// browser: `npm run kat:browser` bundles kat.test.ts with esbuild (the alias `vitest` points here) into one self-contained page that prints PASS or FAIL for
// every test. It is not a test file and nothing in the app imports it.

interface Registered {
  name: string;
  run: () => unknown;
}

const registered: Registered[] = [];
const path: string[] = [];

export const describe = (name: string, body: () => void): void => {
  path.push(name);
  body();
  path.pop();
};

export const it = (name: string, run: () => unknown): void => {
  registered.push({ name: [...path, name].join(' > '), run });
};

class Mismatch extends Error {}

const shown = (value: unknown): string => {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  try {
    return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
  } catch {
    return typeof value;
  }
};

const matchers = (actual: unknown, message: string | undefined, negate: boolean) => {
  const check = (pass: boolean, what: string): void => {
    if (pass === negate) {
      const text = `expected ${shown(actual)} ${negate ? 'not ' : ''}${what}`;
      throw new Mismatch(message === undefined ? text : `${message}: ${text}`);
    }
  };
  return {
    toBe: (expected: unknown): void => {
      check(Object.is(actual, expected), `to be ${shown(expected)}`);
    },
    toEqual: (expected: unknown): void => {
      check(shown(actual) === shown(expected), `to equal ${shown(expected)}`);
    },
    toBeGreaterThanOrEqual: (limit: number): void => {
      check(typeof actual === 'number' && actual >= limit, `to be at least ${limit}`);
    },
    toBeLessThanOrEqual: (limit: number): void => {
      check(typeof actual === 'number' && actual <= limit, `to be at most ${limit}`);
    },
    toBeInstanceOf: (constructor: abstract new (...args: never[]) => unknown): void => {
      check(actual instanceof constructor, `to be an instance of ${constructor.name}`);
    },
    toHaveLength: (length: number): void => {
      check(
        (typeof actual === 'string' || actual instanceof Uint8Array || Array.isArray(actual)) && actual.length === length,
        `to have length ${length}`
      );
    },
    toMatch: (pattern: RegExp): void => {
      check(typeof actual === 'string' && pattern.test(actual), `to match ${String(pattern)}`);
    },
    toThrow: (): void => {
      let threw = false;
      try {
        (actual as () => unknown)();
      } catch {
        threw = true;
      }
      check(threw, 'to throw');
    }
  };
};

export const expect = (actual: unknown, message?: string) => ({
  ...matchers(actual, message, false),
  not: matchers(actual, message, true),
  rejects: {
    toThrow: async (): Promise<void> => {
      let threw = false;
      try {
        await actual;
      } catch {
        threw = true;
      }
      matchers(threw, message, false).toBe(true);
    }
  },
  resolves: {
    toBeUndefined: async (): Promise<void> => {
      matchers(await actual, message, false).toBe(undefined);
    }
  }
});

/** Runs every registered test in order and writes the result to the page: one line per test, the verdict in the title and in `data-result` of <body>. */
export async function runAll(): Promise<void> {
  const out = document.querySelector('#out');
  const line = (text: string): void => {
    out?.append(`${text}\n`);
  };
  let failed = 0;
  for (const test of registered) {
    const started = performance.now();
    try {
      await test.run();
      line(`PASS  ${test.name} (${Math.round(performance.now() - started)} ms)`);
    } catch (error) {
      failed += 1;
      line(`FAIL  ${test.name}: ${error instanceof Error ? error.message : 'threw something that is not an error'}`);
    }
  }
  const verdict = failed === 0 ? `PASS: all ${registered.length} tests` : `FAIL: ${failed} of ${registered.length} tests failed`;
  line(`\n${verdict}\n${navigator.userAgent}`);
  document.title = verdict;
  document.body.dataset.result = failed === 0 ? 'pass' : 'fail';
}
