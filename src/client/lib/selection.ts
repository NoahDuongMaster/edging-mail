// The selection of several messages in the list (multi-select, J6-26). Pure functions on a set of ids and the order the list shows them in,
// so the rules can be tested in Node: a click toggles one row, Shift+click sets a range to the state of the row clicked, Shift+arrows (and
// Shift+J/K) grow or shrink the selection from the row that has focus, and the box of the head selects or clears every row on the page.

/** How much of the page is selected: nothing, some rows, or every row (the box of the head is clear, a dash, or ticked). */
export type PageState = 'none' | 'some' | 'all';

/** The selection with `id` turned the other way. */
export function toggleOne(selected: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(selected);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

/**
 * Shift+click: every row from `anchor` (the row clicked last) to `to`, both included, takes the state `to` is turned to (ticked when it
 * was clear, clear when it was ticked), as mail clients do. Without an anchor in the list it is a plain toggle of `to`.
 */
export function selectRange(selected: ReadonlySet<string>, order: readonly string[], anchor: string | null, to: string): Set<string> {
  const from = anchor === null ? -1 : order.indexOf(anchor);
  const end = order.indexOf(to);
  if (from === -1 || end === -1) {
    return toggleOne(selected, to);
  }
  const on = !selected.has(to);
  const next = new Set(selected);
  for (const id of order.slice(Math.min(from, end), Math.max(from, end) + 1)) {
    if (on) {
      next.add(id);
    } else {
      next.delete(id);
    }
  }
  return next;
}

/**
 * Shift+Down / Shift+Up (and Shift+J / Shift+K) from the row `from`: the row that has focus is selected and so is the next one in that
 * direction, which takes focus (`to`). Going back over a selected run shrinks it: when the next row is already selected, `from` is let go.
 * `to` is null at either end of the list (nothing changes then).
 */
export function extendSelection(
  selected: ReadonlySet<string>,
  order: readonly string[],
  from: string,
  direction: 1 | -1
): { selected: Set<string>; to: string | null } {
  const at = order.indexOf(from);
  const to = at === -1 ? undefined : order.at(at + direction);
  if (at === -1 || to === undefined || at + direction < 0) {
    return { selected: new Set(selected), to: null };
  }
  const next = new Set(selected);
  if (next.has(to) && next.has(from)) {
    next.delete(from);
  } else {
    next.add(from);
    next.add(to);
  }
  return { selected: next, to };
}

/** The selection without the rows that are no longer listed (archived, filtered out). The same set when nothing went, so React keeps it. */
export function keepListed(selected: ReadonlySet<string>, order: readonly string[]): ReadonlySet<string> {
  if (selected.size === 0) {
    return selected;
  }
  const listed = new Set(order);
  const kept = [...selected].filter((id) => listed.has(id));
  return kept.length === selected.size ? selected : new Set(kept);
}

/** How much of the page `selected` covers. */
export function pageState(selected: ReadonlySet<string>, order: readonly string[]): PageState {
  const count = order.filter((id) => selected.has(id)).length;
  if (count === 0) {
    return 'none';
  }
  return count === order.length ? 'all' : 'some';
}

/** The box of the head: every row of the page when not all of them are selected, else none. */
export function toggleAll(selected: ReadonlySet<string>, order: readonly string[]): Set<string> {
  return pageState(selected, order) === 'all' ? new Set() : new Set(order);
}

/** Ids in groups of at most `size` (the batch route takes 100 ids a call). */
export function chunks(ids: readonly string[], size = 100): string[][] {
  const out: string[][] = [];
  for (let at = 0; at < ids.length; at += size) {
    out.push(ids.slice(at, at + size));
  }
  return out;
}
