import { describe, expect, it } from 'vitest';
import en from '../../src/shared/i18n/locales/en.json';
import { ERRORS } from '../../src/worker/errors';

// Every error code the Worker can answer with has a text in the catalogue (`err.<code>`), and the catalogue holds no text for a code
// that does not exist. `err.network` is the client's own (the request never reached the server).

const CLIENT_ONLY = new Set(['err.network']);

describe('the error codes of the Worker and the catalogue', () => {
  const keys = Object.keys(en).filter((key) => key.startsWith('err.'));

  it('have a catalogue text for every code of src/worker/errors.ts', () => {
    const missing = Object.keys(ERRORS)
      .map((code) => `err.${code}`)
      .filter((key) => !keys.includes(key));
    expect(missing).toEqual([]);
  });

  it('have no catalogue text for a code that does not exist', () => {
    const stale = keys.filter((key) => !CLIENT_ONLY.has(key) && !(key.slice('err.'.length) in ERRORS));
    expect(stale).toEqual([]);
  });
});
