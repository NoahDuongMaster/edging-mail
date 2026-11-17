import { describe, expect, it } from 'vitest';
import { entryMatches, listDecision, MAX_ENTRY_CHARS, normaliseEntry } from '../src/worker/spam/lists';
import type { ListEntry } from '../src/worker/spam/lists';

// The person's lists: what an entry may be, what it matches, and which entry wins when an allow and a block both cover a sender.

describe('normaliseEntry', () => {
  it('trims and lower-cases a plain address or a bare host', () => {
    expect(normaliseEntry('  Friend@Example.COM ')).toBe('friend@example.com');
    expect(normaliseEntry('Example.com')).toBe('example.com');
    expect(normaliseEntry('mail.example.co.uk')).toBe('mail.example.co.uk');
    expect(normaliseEntry('xn--bcher-kva.example')).toBe('xn--bcher-kva.example');
  });

  it('accepts what senders really write: tags, bounce addresses and dots in the local part', () => {
    for (const value of [
      'news+tag@example.com',
      'bounce=a=b@mail.example.com',
      'a.b.c@example.com',
      "o'brien@example.com",
      'a_b-c@example.com',
      'x~y@example.com'
    ]) {
      expect(normaliseEntry(value), value).toBe(value);
    }
  });

  it('refuses anything else', () => {
    const tooLong = `${'a'.repeat(250)}.example.com`;
    for (const value of [
      '',
      ' '.repeat(3),
      'localhost',
      'example',
      '*.example.com',
      '@example.com',
      'example.com/path',
      'https://example.com',
      'example.com:25',
      'Alice <alice@example.com>',
      '"alice"@example.com',
      'a b@example.com',
      'a@b@example.com',
      'a@example',
      'a@',
      '.a@example.com',
      'a.@example.com',
      'a..b@example.com',
      'a@-example.com',
      'a@exa mple.com',
      'a@1.2.3.4',
      '1.2.3.4',
      'bücher.example',
      'a@bücher.example',
      'ünï@example.com',
      `${'a'.repeat(65)}@example.com`,
      tooLong,
      '\u0000@example.com',
      'a@exa\tmple.com'
    ]) {
      expect(normaliseEntry(value), JSON.stringify(value)).toBeNull();
    }
    for (const [index, value] of [null, undefined, 5, true, {}, ['a@example.com']].entries()) {
      expect(normaliseEntry(value), `value ${index}`).toBeNull();
    }
  });

  it('allows at most 255 characters', () => {
    const label = 'a'.repeat(60);
    const exactly = `${label}.${label}.${label}.${label}.com`;
    expect(exactly.length).toBeLessThanOrEqual(MAX_ENTRY_CHARS);
    expect(normaliseEntry(exactly)).toBe(exactly);
    expect(normaliseEntry(`${label}.${label}.${label}.${label}.${label}.com`)).toBeNull();
  });
});

describe('entryMatches', () => {
  it('an address entry is that address only, case-insensitively (the address is already lower-case)', () => {
    expect(entryMatches('friend@example.com', 'friend@example.com')).toBe(true);
    expect(entryMatches('friend@example.com', 'other@example.com')).toBe(false);
    expect(entryMatches('friend@example.com', 'friend@mail.example.com')).toBe(false);
    expect(entryMatches('friend@example.com', 'xfriend@example.com')).toBe(false);
    expect(entryMatches('friend@example.com', 'friend@example.com.evil.example')).toBe(false);
  });

  it('a host entry is that host and its subdomains', () => {
    expect(entryMatches('example.com', 'a@example.com')).toBe(true);
    expect(entryMatches('example.com', 'a@mail.example.com')).toBe(true);
    expect(entryMatches('example.com', 'a@x.y.example.com')).toBe(true);
    expect(entryMatches('mail.example.com', 'a@mail.example.com')).toBe(true);
    expect(entryMatches('mail.example.com', 'a@example.com')).toBe(false);
    expect(entryMatches('mail.example.com', 'a@other.example.com')).toBe(false);
  });

  it('a host that merely ends with the same letters does not match', () => {
    expect(entryMatches('example.com', 'a@notexample.com')).toBe(false);
    expect(entryMatches('example.com', 'a@myexample.com')).toBe(false);
    expect(entryMatches('example.com', 'a@example.com.evil.example')).toBe(false);
    expect(entryMatches('example.com', 'a@example.co')).toBe(false);
    expect(entryMatches('example.com', 'example.com@evil.example')).toBe(false);
  });

  it('the host of an address is what follows its LAST @', () => {
    expect(entryMatches('example.com', 'a@evil.example@example.com')).toBe(true);
    expect(entryMatches('evil.example', 'a@evil.example@example.com')).toBe(false);
  });
});

const entry = (kind: ListEntry['kind'], value: string, created_at = 1): ListEntry => ({ kind, value, created_at });

describe('listDecision', () => {
  it('is null when no entry covers the sender', () => {
    expect(listDecision([], 'a@example.com')).toBeNull();
    expect(listDecision([entry('block', 'other.example'), entry('allow', 'b@example.com')], 'a@example.com')).toBeNull();
  });

  it('answers the kind of the entry that covers the sender', () => {
    expect(listDecision([entry('block', 'example.com')], 'a@mail.example.com')).toBe('block');
    expect(listDecision([entry('allow', 'a@example.com')], 'a@example.com')).toBe('allow');
  });

  it('the most specific entry wins: an address beats a host, a longer host beats a shorter one', () => {
    expect(listDecision([entry('block', 'example.com'), entry('allow', 'friend@example.com')], 'friend@example.com')).toBe('allow');
    expect(listDecision([entry('allow', 'example.com'), entry('block', 'bad@example.com')], 'bad@example.com')).toBe('block');
    expect(listDecision([entry('block', 'example.com'), entry('allow', 'news.example.com')], 'a@news.example.com')).toBe('allow');
    expect(listDecision([entry('allow', 'example.com'), entry('block', 'news.example.com')], 'a@news.example.com')).toBe('block');
    // the broader entry still applies to the rest of its domain
    expect(listDecision([entry('block', 'example.com'), entry('allow', 'friend@example.com')], 'other@example.com')).toBe('block');
  });

  it('at the same specificity the newer entry wins, and block wins a tie', () => {
    expect(listDecision([entry('block', 'a@example.com', 1), entry('allow', 'a@example.com', 2)], 'a@example.com')).toBe('allow');
    expect(listDecision([entry('allow', 'a@example.com', 1), entry('block', 'a@example.com', 2)], 'a@example.com')).toBe('block');
    expect(listDecision([entry('allow', 'a@example.com', 5), entry('block', 'a@example.com', 5)], 'a@example.com')).toBe('block');
    expect(listDecision([entry('block', 'a@example.com', 5), entry('allow', 'a@example.com', 5)], 'a@example.com')).toBe('block');
  });
});
