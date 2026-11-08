import { describe, expect, it } from 'vitest';
import { initialsOf } from '../../src/client/ui/initials';

// The letters of an Avatar.

describe('initialsOf', () => {
  it('takes the first letter of the first and of the last word', () => {
    expect(initialsOf('Noah Duong')).toBe('ND');
    expect(initialsOf('Ada Augusta King Lovelace')).toBe('AL');
  });
  it('takes one letter for one word, upper-cased', () => {
    expect(initialsOf('noah')).toBe('N');
  });
  it('reads an address by the part before the @, split at dots, dashes and underscores', () => {
    expect(initialsOf('noah.duong@example.com')).toBe('ND');
    expect(initialsOf('billing@example.com')).toBe('B');
    expect(initialsOf('no_reply-team@example.com')).toBe('NT');
  });
  it('keeps a whole character: Vietnamese letters with marks, and Chinese names without spaces', () => {
    expect(initialsOf('Đỗ Ánh')).toBe('ĐÁ');
    expect(initialsOf('ơn ưu')).toBe('ƠƯ');
    expect(initialsOf('王小明')).toBe('王');
  });
  it('does not cut a character made of two code units in half', () => {
    expect(initialsOf('𠮷野家')).toBe('𠮷');
  });
  it('gives a question mark when there is nothing to show', () => {
    expect(initialsOf('')).toBe('?');
    expect(initialsOf(' '.repeat(3))).toBe('?');
    expect(initialsOf('@example.com')).toBe('?');
    expect(initialsOf('._-')).toBe('?');
  });
});
