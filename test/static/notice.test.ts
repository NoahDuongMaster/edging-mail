// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers/scan';

// AC40, docs against code: NOTICE lists every package that ends up in the Worker or in the app (the runtime dependencies of package.json and everything
// they need, found in package-lock.json), with the version and the licence the lockfile has, and every licence among them is one the project accepts. The
// rows of NOTICE that are not runtime (the test and build tools it names) must match the lockfile as well. Reads files, so it runs in Node.

interface LockEntry {
  version: string;
  license?: string;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const read = (file: string): string => readFileSync(path.join(ROOT, file), 'utf8');
const lock = (JSON.parse(read('package-lock.json')) as { packages: Record<string, LockEntry> }).packages;
const manifest = JSON.parse(read('package.json')) as { dependencies: Record<string, string> };
const notice = read('NOTICE');

/** MIT-0 is MIT without the attribution clause. The project's own rule (CONTRIBUTING.md) is MIT, ISC, BSD or Apache-2.0; 0BSD and BlueOak are the same kind. */
const ACCEPTED = new Set(['MIT', 'MIT-0', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'BlueOak-1.0.0']);

/** Where npm put `name` for a package installed at `from` ('' is the project): the nearest `node_modules` up the tree. */
function resolve(from: string, name: string): string | undefined {
  let base = from;
  for (;;) {
    const candidate = `${base}${base === '' ? '' : '/'}node_modules/${name}`;
    if (candidate in lock) {
      return candidate;
    }
    if (base === '') {
      return undefined;
    }
    const cut = base.lastIndexOf('/node_modules/');
    base = cut === -1 ? '' : base.slice(0, cut);
  }
}

/** The runtime dependencies of package.json and what they need, as lock keys. */
function runtimeClosure(): Set<string> {
  const seen = new Set<string>();
  const queue = Object.keys(manifest.dependencies).flatMap((name) => resolve('', name) ?? []);
  for (let key = queue.pop(); key !== undefined; key = queue.pop()) {
    if (!seen.has(key)) {
      seen.add(key);
      const entry = lock[key];
      queue.push(...Object.keys({ ...entry.dependencies, ...entry.optionalDependencies }).flatMap((name) => resolve(key, name) ?? []));
    }
  }
  return seen;
}

/** The package rows of NOTICE: three spaces, name, version, licence. */
function noticeRows(): { name: string; version: string; licence: string }[] {
  return [...notice.matchAll(/^ {3}(@?[a-z][\w./@-]*) {2,}(\d+\.\d+\.\d+\S*) {2,}(\S+)/gm)].map((match) => ({
    name: match[1],
    version: match[2],
    licence: match[3]
  }));
}

const nameOf = (key: string): string => key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);

describe('NOTICE and the lockfile', () => {
  const closure = runtimeClosure();
  const rows = noticeRows();

  it('sees the runtime packages and the rows (the test is not blind)', () => {
    expect(closure.size).toBeGreaterThan(15);
    expect(rows.length).toBeGreaterThan(15);
  });

  it('lists every runtime package, with the version and licence of the lockfile', () => {
    const problems = [...closure].flatMap((key) => {
      const row = rows.find((candidate) => candidate.name === nameOf(key));
      const entry = lock[key];
      if (row === undefined) {
        return [`${nameOf(key)}@${entry.version} is not in NOTICE`];
      }
      return row.version === entry.version && row.licence === entry.license
        ? []
        : [`${row.name}: NOTICE says ${row.version} ${row.licence}, the lockfile ${entry.version} ${String(entry.license)}`];
    });
    expect(problems).toEqual([]);
  });

  it('has no row that the lockfile contradicts, runtime or not', () => {
    const problems = rows.flatMap((row) => {
      const entries = Object.entries(lock).filter(([key]) => nameOf(key) === row.name);
      return entries.some(([, entry]) => entry.version === row.version && entry.license === row.licence)
        ? []
        : [`${row.name} ${row.version} ${row.licence}`];
    });
    expect(problems).toEqual([]);
  });

  it('has only licences the project accepts among the runtime packages', () => {
    const refused = [...closure]
      .filter((key) => !ACCEPTED.has(lock[key].license ?? 'none'))
      .map((key) => `${nameOf(key)}: ${String(lock[key].license)}`);
    expect(refused).toEqual([]);
  });
});
