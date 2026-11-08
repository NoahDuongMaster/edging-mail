// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROOT } from './helpers/scan';

// AC40, docs against code: every binding and variable of the Worker (the `Env` interface in src/worker/types.ts, and the `vars` of wrangler.jsonc) is in
// docs/configuration.md: a binding in the Bindings table, a variable in the table that gives its default, how to make it and what happens when it changes.
// Reads files, so it runs in Node.

const read = (...parts: string[]): string => readFileSync(path.join(ROOT, ...parts), 'utf8');
const TYPES = read('src', 'worker', 'types.ts');
const DOC = read('docs', 'configuration.md');

const BINDING_TYPES = new Set(['D1Database', 'R2Bucket', 'SendEmail', 'Fetcher', 'DurableObjectNamespace']);

/** The members of `interface Env`: name and type. */
function envMembers(): { name: string; type: string }[] {
  const body = TYPES.slice(TYPES.indexOf('export interface Env {'));
  const end = body.indexOf('\n}');
  return [...body.slice(0, end).matchAll(/^ {2}([A-Z][A-Z0-9_]*)\??: (\w+);/gm)].map((match) => ({ name: match[1], type: match[2] }));
}

/** The rows of a Markdown table of `doc` whose first cell is `` `name` ``: the other cells. */
function rowsOf(name: string, section: string): string[][] {
  const start = DOC.indexOf(section);
  const end = DOC.indexOf('\n## ', start + 1);
  return [...DOC.slice(start, end === -1 ? undefined : end).matchAll(new RegExp(`^\\| \`${name}\`\\s*\\|(.*)\\|$`, 'gm'))].map((match) =>
    match[1].split('|').map((cell) => cell.trim())
  );
}

describe('docs/configuration.md and the Env of the Worker', () => {
  const members = envMembers();

  it('sees the members of Env (the test is not blind)', () => {
    expect(members.map((member) => member.name)).toEqual(
      expect.arrayContaining(['DB', 'BUCKET', 'JWT_SECRET', 'DATA_KEY', 'ALLOW_LOCAL_PUSH'])
    );
    expect(members.length).toBeGreaterThan(12);
  });

  it('has every binding in the Bindings table, with a purpose', () => {
    const missing = members
      .filter((member) => BINDING_TYPES.has(member.type))
      .filter((member) => rowsOf(member.name, '## Bindings').length === 0);
    expect(missing.map((member) => member.name)).toEqual([]);
  });

  it('has every variable and secret in the table of defaults: a default, how to make it, and what a change does, none of them empty', () => {
    const variables = members.filter((member) => !BINDING_TYPES.has(member.type));
    const problems = variables.flatMap(({ name }) => {
      const rows = rowsOf(name, '## Variables and secrets');
      const withDefaults = rows.filter((cells) => cells.length === 3);
      return withDefaults.length === 1 && withDefaults[0].every((cell) => cell !== '') ? [] : [name];
    });
    expect(problems).toEqual([]);
  });

  it('has every variable and secret in the first table as well (kind, required, constraint, purpose)', () => {
    const variables = members.filter((member) => !BINDING_TYPES.has(member.type));
    const problems = variables.filter(({ name }) => !rowsOf(name, '## Variables and secrets').some((cells) => cells.length === 4));
    expect(problems.map((member) => member.name)).toEqual([]);
  });

  it('types every variable that wrangler.jsonc sets, and documents it', () => {
    const wrangler = read('wrangler.jsonc')
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
    const block = /"vars"\s*:\s*\{([\s\S]*?)\n {2}\}/.exec(wrangler)?.[1] ?? '';
    const names = [...block.matchAll(/"([A-Z][A-Z0-9_]*)"\s*:/g)].map((match) => match[1]);
    expect(names.length).toBeGreaterThan(1);
    const known = new Set(members.map((member) => member.name));
    expect(names.filter((name) => !known.has(name))).toEqual([]);
    expect(names.filter((name) => !DOC.includes(`\`${name}\``))).toEqual([]);
  });

  it('is told about by the template of .dev.vars for every secret and the local switch', () => {
    const template = read('.dev.vars.example');
    for (const name of ['APP_PASSWORD', 'JWT_SECRET', 'DATA_KEY', 'ALLOW_LOCAL_PUSH']) {
      expect(template, name).toContain(name);
    }
  });
});
