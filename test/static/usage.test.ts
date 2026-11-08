// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { DYNAMIC_KEY_FAMILIES } from '../../src/shared/i18n/families';
import glossary from '../../src/shared/i18n/glossary.json';
import en from '../../src/shared/i18n/locales/en.json';
import { clientFiles, stringLiterals, translateCalls, type TranslateCall } from './helpers/scan';

// Static scan of src/client against the English catalogue (design.md section 20.3 b). Runs in the node project.

const baseOf = (key: string): string => (key.includes('#') ? key.slice(0, key.indexOf('#')) : key);
const BASES = new Set(Object.keys(en).map(baseOf));
const files = clientFiles();
const calls: TranslateCall[] = files.flatMap((file) => translateCalls(file));
const literals = new Set(files.flatMap((file) => [...stringLiterals(file)]));
const where = (call: TranslateCall): string => `${call.file}:${call.line}`;

describe('translate calls in src/client', () => {
  it('find at least one call (the scan itself works)', () => {
    expect(calls.length).toBeGreaterThan(0);
  });

  it('name only keys that exist in en.json', () => {
    const missing = calls.flatMap((call) => (call.key !== undefined && !BASES.has(call.key) ? [`${where(call)} ${call.key}`] : []));
    expect(missing).toEqual([]);
  });

  it('never build a key in place (a template or a +): anything built at run time goes through tDyn and a declared family', () => {
    const computed = calls.filter((call) => call.callee !== 'tDyn' && call.built).map(where);
    expect(computed).toEqual([]);
  });

  it('build tDyn keys inside a family declared in src/shared/i18n/families.ts', () => {
    const outside = calls
      .filter((call) => call.callee === 'tDyn')
      .filter((call) => {
        const prefix = call.prefix;
        return prefix === undefined || !DYNAMIC_KEY_FAMILIES.some((family) => prefix.startsWith(family));
      })
      .map(where);
    expect(outside).toEqual([]);
  });
});

describe('the English catalogue', () => {
  const governed = new Set(glossary.rows.flatMap((row) => row.appKeys));

  it('holds no key the client does not use (a key written anywhere in src/client as a literal, a dynamic family, or a glossary term)', () => {
    const unused = [...BASES].filter(
      (key) => !literals.has(key) && !DYNAMIC_KEY_FAMILIES.some((family) => key.startsWith(family)) && !governed.has(key)
    );
    expect(unused).toEqual([]);
  });
});
