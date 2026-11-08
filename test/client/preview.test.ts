import { describe, expect, it } from 'vitest';
import { LIMITS } from '../../src/client/lib/sealedmail';
import { addressesToAsk, isCompleteAddress, previewAddresses, previewOf } from '../../src/client/lib/sealedmail/preview';
import type { KeyAnswer } from '../../src/client/lib/sealedmail';

// EC-4: the quiet line under the recipient fields says what the message will be, from the same lookup the send uses. It mirrors `runSend`: one
// outside address, one person without keys or too many files, and the usual route is taken (another From address has no case: `/send` refuses it).

const WITH_KEYS: KeyAnswer = { internal: true, publicKey: 'spki', keyId: 'id' };
const NO_KEYS: KeyAnswer = { internal: true };
const OUTSIDE: KeyAnswer = { internal: false };
const answersOf = (entries: Record<string, KeyAnswer>) => new Map(Object.entries(entries));

const base = { fileSizes: [] as number[] };

describe('previewOf', () => {
  it('says nothing without a recipient, and nothing until every recipient has an answer', () => {
    expect(previewOf({ ...base, addresses: [], answers: new Map() })).toEqual({ state: 'unknown' });
    expect(
      previewOf({ ...base, addresses: ['a@example.com', 'b@example.com'], answers: answersOf({ 'a@example.com': WITH_KEYS }) })
    ).toEqual({
      state: 'unknown'
    });
  });

  it('is end-to-end when everybody has keys and the files fit', () => {
    const answers = answersOf({ 'a@example.com': WITH_KEYS, 'b@example.com': WITH_KEYS });
    expect(previewOf({ ...base, addresses: ['a@example.com', 'B@example.com '], answers })).toEqual({ state: 'e2e' });
  });

  it('is plain for an outside address, even next to people with keys', () => {
    const answers = answersOf({ 'a@example.com': WITH_KEYS, 'o@example.org': OUTSIDE });
    expect(previewOf({ ...base, addresses: ['a@example.com', 'o@example.org'], answers })).toEqual({ state: 'plain', reason: 'outside' });
  });

  it('is plain for a person on this server who has no keys yet', () => {
    const answers = answersOf({ 'a@example.com': WITH_KEYS, 'c@example.com': NO_KEYS });
    expect(previewOf({ ...base, addresses: ['a@example.com', 'c@example.com'], answers })).toEqual({ state: 'plain', reason: 'no_keys' });
  });

  it('is plain "too large" when every person would get a sealed copy of the files and the total passes the cap', () => {
    const answers = answersOf({
      'a@example.com': WITH_KEYS,
      'b@example.com': WITH_KEYS,
      'c@example.com': WITH_KEYS,
      'd@example.com': WITH_KEYS
    });
    const addresses = ['a@example.com', 'b@example.com', 'c@example.com', 'd@example.com'];
    // Five copies (four people and the Sent copy) of 2 MiB is 10 MiB plus the overhead: over the cap. One person with the same file fits.
    const file = 2 * 1024 * 1024;
    expect(previewOf({ ...base, addresses, answers, fileSizes: [file] })).toEqual({ state: 'plain', reason: 'big' });
    expect(previewOf({ ...base, addresses: ['a@example.com'], answers, fileSizes: [file] })).toEqual({ state: 'e2e' });
    expect(LIMITS.attachmentBytes).toBe(10 * 1024 * 1024);
  });

  it('is plain "too large" for more files than one copy may hold', () => {
    const answers = answersOf({ 'a@example.com': WITH_KEYS });
    expect(
      previewOf({
        ...base,
        addresses: ['a@example.com'],
        answers,
        fileSizes: Array.from({ length: LIMITS.attachmentsPerCopy + 1 }, () => 1)
      })
    ).toEqual({
      state: 'plain',
      reason: 'big'
    });
  });

  it('does not preview more recipients than the end-to-end route takes', () => {
    const addresses = Array.from({ length: LIMITS.recipients + 1 }, (_, index) => `p${index}@example.com`);
    const answers = new Map(addresses.map((address) => [address, WITH_KEYS] as const));
    expect(previewOf({ ...base, addresses, answers })).toEqual({ state: 'unknown' });
  });
});

describe('what is asked, and how often', () => {
  it('asks only for finished addresses, lower-cased and once each', () => {
    expect(isCompleteAddress('bob@example.com')).toBe(true);
    expect(isCompleteAddress('bob@example')).toBe(false);
    expect(isCompleteAddress('bob@')).toBe(false);
    expect(isCompleteAddress('Bob Smith <bob@example.com>')).toBe(false);
    expect(previewAddresses(['Bob@Example.com', 'bo'], ['bob@example.com ', 'cat@example.org', 'x@y'])).toEqual([
      'bob@example.com',
      'cat@example.org'
    ]);
  });

  it('asks for the addresses with no answer yet', () => {
    expect(addressesToAsk(['a@example.com', 'b@example.com'], new Set(['a@example.com']), 0, 6)).toEqual(['b@example.com']);
    expect(addressesToAsk(['a@example.com'], new Set(['a@example.com']), 0, 6)).toEqual([]);
    expect(addressesToAsk([], new Set(), 0, 6)).toEqual([]);
  });

  it('stops asking when the preview used its share of the lookup budget', () => {
    expect(addressesToAsk(['a@example.com'], new Set(), 5, 6)).toEqual(['a@example.com']);
    expect(addressesToAsk(['a@example.com'], new Set(), 6, 6)).toEqual([]);
  });

  it('does not ask about more addresses than one lookup takes', () => {
    const many = Array.from({ length: LIMITS.recipients + 1 }, (_, index) => `p${index}@example.com`);
    expect(addressesToAsk(many, new Set(), 0, 6)).toEqual([]);
  });
});
