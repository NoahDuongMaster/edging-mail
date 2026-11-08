// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import ts from '@typescript/typescript6';
import { describe, expect, it } from 'vitest';
import { LOCALES } from '../../src/shared/i18n/languages';
import { ROOT, parse, walk } from './helpers/scan';

// The words of the history screens: every audit action the Worker writes (`auditEntry`, `auditEntryIf`) has a sentence in the admin audit log, and
// every kind of a sign-in history row (`signInEntry`) has a title in the account activity card, in all three languages. Without a word the screen
// falls back to "Other action: <code>" or "Unknown event": a new Worker feature that forgets its words shows up here, not on a screen.
// Reads the Worker source with the TypeScript parser, so it runs in Node.

// The call and the position of the argument that names the action or the kind.
const WHERE: Readonly<Record<string, number>> = { auditEntry: 2, auditEntryIf: 3, signInEntry: 4 };

const files = walk(path.join(ROOT, 'src', 'worker'), ['.ts']).filter(
  (file) => !file.includes(`${path.sep}site${path.sep}`) && !file.endsWith(`${path.sep}types.ts`)
);

/** Collects, into `found`, the string literals a node (and everything under it) hands to `call` as its action or kind argument. */
function collect(node: ts.Node, call: string, alsoOptions: boolean, found: Set<string>): void {
  if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === call) {
    const argument = node.arguments.at(WHERE[call] ?? 0);
    if (argument !== undefined && ts.isStringLiteralLike(argument)) {
      found.add(argument.text);
    }
  }
  // The options of the credential-change helpers carry the action (`{ set, actor, action: 'break_glass', ... }`); `types.ts`, where `action` is
  // the mail action of a bulk request, is left out of the files.
  if (
    alsoOptions &&
    ts.isPropertyAssignment(node) &&
    ts.isIdentifier(node.name) &&
    node.name.text === 'action' &&
    ts.isStringLiteralLike(node.initializer)
  ) {
    found.add(node.initializer.text);
  }
  ts.forEachChild(node, (child) => {
    collect(child, call, alsoOptions, found);
  });
}

function literalsOf(call: string, alsoOptions = false): string[] {
  const found = new Set<string>();
  for (const file of files) {
    collect(parse(file), call, alsoOptions, found);
  }
  return [...found];
}

const auditActions = [...new Set([...literalsOf('auditEntry', true), ...literalsOf('auditEntryIf')])].toSorted();
// `signInEntry` without a kind is an ordinary sign-in.
const signInKinds = [...new Set(['sign_in', ...literalsOf('signInEntry')])].toSorted();

const catalogue = (language: string): Record<string, string | undefined> =>
  JSON.parse(readFileSync(path.join(ROOT, 'src', 'shared', 'i18n', 'locales', `${language}.json`), 'utf8')) as Record<string, string>;

describe('the words of the history screens', () => {
  it('are found in the source (the checks below would pass on an empty list otherwise)', () => {
    expect(auditActions.length).toBeGreaterThan(25);
    expect(auditActions).toContain('locked_mail_delete_requested');
    expect(auditActions).toContain('break_glass');
    expect(signInKinds).toContain('locked_delete_requested');
    expect(signInKinds).toContain('break_glass');
    expect(signInKinds.length).toBeGreaterThanOrEqual(6);
  });

  it.each(LOCALES)('%s: every audit action has a sentence (audit.action.<action>)', (language) => {
    const words = catalogue(language);
    expect(
      auditActions.filter((action) => words[`audit.action.${action}`] === undefined).map((action) => `audit.action.${action}`)
    ).toEqual([]);
  });

  it.each(LOCALES)('%s: every kind of a sign-in history row has a title (activity.kind.<kind>)', (language) => {
    const words = catalogue(language);
    expect(signInKinds.filter((kind) => words[`activity.kind.${kind}`] === undefined).map((kind) => `activity.kind.${kind}`)).toEqual([]);
  });
});
