import { describe, expect, it } from 'vitest';
import { ownerInitials } from '../../src/client/lib/settings';
import { initialsOf, isCjk } from '../../src/client/ui/initials';

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
  it('gives ONE character for a CJK name, with or without a space (J3-11: two characters do not fit a 32px circle)', () => {
    expect(initialsOf('李明')).toBe('李');
    expect(initialsOf('李 明')).toBe('李');
    expect(initialsOf('山田 太郎')).toBe('山');
    expect(initialsOf('김 민준')).toBe('김');
    expect(isCjk(initialsOf('李明'))).toBe(true);
    expect(isCjk(initialsOf('Li Ming'))).toBe(false);
    expect(initialsOf('Li Ming')).toBe('LM');
  });
  it('makes the header avatar by the same rule (ownerInitials)', () => {
    const settings = { display_name: '李明', email: 'li.ming@example.com', signature: '' };
    expect(ownerInitials(settings)).toBe('李');
    expect(ownerInitials({ ...settings, display_name: '' })).toBe('LM');
    expect(ownerInitials()).toBe('');
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
