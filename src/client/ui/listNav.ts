/** What a list needs to know about a row to move over it. */
export interface ListItem {
  label: string;
  disabled?: boolean;
}

/** The index of the first row that can be chosen, or -1. */
export function firstEnabled(items: readonly ListItem[]): number {
  return items.findIndex((item) => item.disabled !== true);
}

/** The index of the last row that can be chosen, or -1. */
export function lastEnabled(items: readonly ListItem[]): number {
  return items.findLastIndex((item) => item.disabled !== true);
}

/**
 * The next row that can be chosen, `step` (1 down, -1 up) from `from`. At an end it stays where it is, or goes round to the other
 * end when `wrap` is set (menus wrap, a select does not). -1 when no row can be chosen.
 */
export function moveIndex(items: readonly ListItem[], from: number, step: 1 | -1, wrap: boolean): number {
  if (from < 0) {
    return step === 1 ? firstEnabled(items) : lastEnabled(items);
  }
  for (let offset = 1; offset <= items.length; offset += 1) {
    const raw = from + step * offset;
    if (!wrap && (raw < 0 || raw >= items.length)) {
      break;
    }
    const index = (raw + items.length * 2) % items.length;
    if (items[index].disabled !== true) {
      return index;
    }
  }
  return from < items.length && items[from].disabled !== true ? from : -1;
}

/** True when `label` starts with `typed`, ignoring case and accents (typing "viet" finds "Việt Nam"). */
function startsWith(label: string, typed: string): boolean {
  return label.slice(0, typed.length).localeCompare(typed, undefined, { sensitivity: 'base' }) === 0;
}

/**
 * Type-ahead: the row a person's typed letters point at, or -1. One letter typed again and again ("aaa") walks through the rows that
 * start with it, after the current one. Several different letters ("ab") find the first row that starts with all of them, the current
 * row included, so it does not jump away while the word is being typed.
 */
export function typeAheadIndex(items: readonly ListItem[], current: number, typed: string): number {
  if (typed === '' || items.length === 0) {
    return -1;
  }
  const repeating = /^(.)\1*$/su.test(typed);
  const needle = repeating ? String.fromCodePoint(typed.codePointAt(0) ?? 0) : typed;
  const start = repeating ? current + 1 : Math.max(current, 0);
  for (let offset = 0; offset < items.length; offset += 1) {
    const index = (start + offset) % items.length;
    if (items[index].disabled !== true && startsWith(items[index].label, needle)) {
      return index;
    }
  }
  return -1;
}
