import { describe, expect, it } from 'vitest';
import { firstEnabled, lastEnabled, moveIndex, typeAheadIndex, type ListItem } from '../../src/client/ui/listNav';

// The index maths behind Select and Menu: which row the arrows, Home/End and typed letters land on. Pure functions, so they are tested here;
// the keyboard paths that use them (focus, aria-activedescendant, Escape) were run in a browser lab, see the report of the redesign.

const rows = (labels: string[], disabled: string[] = []): ListItem[] =>
  labels.map((label) => ({ label, disabled: disabled.includes(label) }));

describe('firstEnabled and lastEnabled', () => {
  it('skip rows that cannot be chosen', () => {
    const items = rows(['a', 'b', 'c', 'd'], ['a', 'd']);
    expect(firstEnabled(items)).toBe(1);
    expect(lastEnabled(items)).toBe(2);
  });
  it('say -1 when nothing can be chosen, or the list is empty', () => {
    expect(firstEnabled(rows(['a'], ['a']))).toBe(-1);
    expect(lastEnabled([])).toBe(-1);
  });
});

describe('moveIndex', () => {
  const items = rows(['a', 'b', 'c', 'd'], ['b']);

  it('steps over a disabled row', () => {
    expect(moveIndex(items, 0, 1, false)).toBe(2);
    expect(moveIndex(items, 2, -1, false)).toBe(0);
  });
  it('stays on the last row without wrap (a select), and goes round with wrap (a menu)', () => {
    expect(moveIndex(items, 3, 1, false)).toBe(3);
    expect(moveIndex(items, 0, -1, false)).toBe(0);
    expect(moveIndex(items, 3, 1, true)).toBe(0);
    expect(moveIndex(items, 0, -1, true)).toBe(3);
  });
  it('starts from the end that matches the direction when nothing is active yet', () => {
    expect(moveIndex(items, -1, 1, true)).toBe(0);
    expect(moveIndex(items, -1, -1, true)).toBe(3);
  });
  it('gives -1 when no row can be chosen', () => {
    expect(moveIndex(rows(['a', 'b'], ['a', 'b']), 0, 1, true)).toBe(-1);
    expect(moveIndex([], -1, 1, true)).toBe(-1);
  });
  it('stays put on a lone row, wrap or not', () => {
    const lone = rows(['only']);
    expect(moveIndex(lone, 0, 1, true)).toBe(0);
    expect(moveIndex(lone, 0, -1, false)).toBe(0);
  });
});

describe('typeAheadIndex', () => {
  const items = rows(['Alpha', 'Apple', 'Banana', 'Avocado', 'Việt Nam', 'Zèbre'], ['Apple']);

  it('finds the first row that starts with the typed letters, from the current row', () => {
    expect(typeAheadIndex(items, 0, 'b')).toBe(2);
    expect(typeAheadIndex(items, 2, 'av')).toBe(3);
  });
  it('wraps round the list', () => {
    expect(typeAheadIndex(items, 5, 'a')).toBe(0);
  });
  it('keeps the current row while a longer word is typed that it still matches', () => {
    expect(typeAheadIndex(items, 3, 'avo')).toBe(3);
    expect(typeAheadIndex(items, 0, 'al')).toBe(0);
  });
  it('walks through the rows of one letter when that letter is typed again and again, skipping disabled rows', () => {
    expect(typeAheadIndex(items, 0, 'a')).toBe(3);
    expect(typeAheadIndex(items, 3, 'aa')).toBe(0);
    expect(typeAheadIndex(items, 0, 'aaa')).toBe(3);
  });
  it('ignores case and accents, so a keyboard without Vietnamese or French input still finds the row', () => {
    expect(typeAheadIndex(items, 0, 'viet')).toBe(4);
    expect(typeAheadIndex(items, 0, 'VIỆT')).toBe(4);
    expect(typeAheadIndex(items, 0, 'zeb')).toBe(5);
  });
  it('says -1 for no match, for nothing typed and for an empty list', () => {
    expect(typeAheadIndex(items, 0, 'q')).toBe(-1);
    expect(typeAheadIndex(items, 0, '')).toBe(-1);
    expect(typeAheadIndex([], -1, 'a')).toBe(-1);
  });
  it('never lands on a disabled row', () => {
    expect(typeAheadIndex(items, -1, 'app')).toBe(-1);
  });
});
