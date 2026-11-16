import { describe, expect, it } from 'vitest';
import { chunks, extendSelection, keepListed, pageState, selectRange, toggleAll, toggleOne } from '../../src/client/lib/selection';

// The selection of several messages (multi-select, J6-26; lib/selection.ts): a click toggles one row, Shift+click sets a range to the state of
// the row clicked, Shift+arrows (and Shift+J/K) grow and shrink it from the focused row, the head's box is tri-state, rows that leave are let
// go, and the batch route gets at most 100 ids a call.

const ORDER = ['a', 'b', 'c', 'd', 'e'];
const set = (...ids: string[]): Set<string> => new Set(ids);
const sorted = (selected: ReadonlySet<string>): string[] => [...selected].toSorted();

describe('toggleOne', () => {
  it('ticks a clear row and clears a ticked one, without touching the set it was given', () => {
    const before = set('a');
    expect(sorted(toggleOne(before, 'b'))).toEqual(['a', 'b']);
    expect(sorted(toggleOne(before, 'a'))).toEqual([]);
    expect(sorted(before)).toEqual(['a']);
  });
});

describe('selectRange (Shift+click)', () => {
  it('ticks every row from the anchor to the row clicked, both ways', () => {
    expect(sorted(selectRange(set('b'), ORDER, 'b', 'd'))).toEqual(['b', 'c', 'd']);
    expect(sorted(selectRange(set('d'), ORDER, 'd', 'a'))).toEqual(['a', 'b', 'c', 'd']);
  });

  it('clears the range when the row clicked was ticked (the range takes the state the click gives it)', () => {
    expect(sorted(selectRange(set('a', 'b', 'c', 'd'), ORDER, 'a', 'c'))).toEqual(['d']);
  });

  it('is a plain toggle without an anchor in the list', () => {
    expect(sorted(selectRange(set(), ORDER, null, 'c'))).toEqual(['c']);
    expect(sorted(selectRange(set('c'), ORDER, 'gone', 'c'))).toEqual([]);
  });
});

describe('extendSelection (Shift+Down / Shift+Up, Shift+J / Shift+K)', () => {
  it('ticks the focused row and the next one, which is where focus goes', () => {
    expect(extendSelection(set(), ORDER, 'b', 1)).toEqual({ selected: set('b', 'c'), to: 'c' });
    expect(extendSelection(set('b', 'c'), ORDER, 'c', 1)).toEqual({ selected: set('b', 'c', 'd'), to: 'd' });
    expect(extendSelection(set(), ORDER, 'c', -1)).toEqual({ selected: set('b', 'c'), to: 'b' });
  });

  it('shrinks a run when it goes back over it', () => {
    expect(extendSelection(set('b', 'c', 'd'), ORDER, 'd', -1)).toEqual({ selected: set('b', 'c'), to: 'c' });
  });

  it('changes nothing at either end of the list, nor from a row that is not listed', () => {
    expect(extendSelection(set('e'), ORDER, 'e', 1).to).toBeNull();
    expect(sorted(extendSelection(set('a'), ORDER, 'a', -1).selected)).toEqual(['a']);
    expect(extendSelection(set(), ORDER, 'zz', 1).to).toBeNull();
  });
});

describe('the head box and the rows that leave', () => {
  it('is clear, a dash or ticked (tri-state), and ticks all or clears all', () => {
    expect(pageState(set(), ORDER)).toBe('none');
    expect(pageState(set('a', 'c'), ORDER)).toBe('some');
    expect(pageState(set(...ORDER), ORDER)).toBe('all');
    expect(pageState(set('gone'), ORDER)).toBe('none');
    expect(sorted(toggleAll(set('a'), ORDER))).toEqual(ORDER);
    expect(sorted(toggleAll(set(...ORDER), ORDER))).toEqual([]);
  });

  it('keeps only the listed rows, and the same set when none went (no needless render)', () => {
    const ticked = set('a', 'b');
    expect(keepListed(ticked, ORDER)).toBe(ticked);
    expect(sorted(keepListed(set('a', 'gone'), ORDER))).toEqual(['a']);
    // Another folder lists none of them: the selection is empty (App also clears it on a change of view).
    expect(sorted(keepListed(ticked, ['x', 'y']))).toEqual([]);
  });

  it('sends at most 100 ids a call to the batch route', () => {
    const ids = Array.from({ length: 250 }, (_, index) => `m${index}`);
    expect(chunks(ids).map((part) => part.length)).toEqual([100, 100, 50]);
    expect(chunks([])).toEqual([]);
  });
});
