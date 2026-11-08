import type { Locale } from './languages';

/** Anything the formatters take for a point in time: epoch milliseconds, a Date or an ISO string. */
export type TimeInput = number | Date | string;

const toDate = (value: TimeInput): Date => (value instanceof Date ? value : new Date(value));

const cache = new Map<string, Intl.DateTimeFormat | Intl.NumberFormat | Intl.RelativeTimeFormat>();

function cached<T extends Intl.DateTimeFormat | Intl.NumberFormat | Intl.RelativeTimeFormat>(
  kind: string,
  locale: Locale,
  options: object | undefined,
  make: () => T
): T {
  const id = `${kind}|${locale}|${JSON.stringify(options ?? {})}`;
  let found = cache.get(id);
  if (found === undefined) {
    found = make();
    cache.set(id, found);
  }
  return found as T;
}

const RELATIVE_STEPS: readonly (readonly [Intl.RelativeTimeFormatUnit, number])[] = [
  ['second', 1000],
  ['minute', 60_000],
  ['hour', 3_600_000],
  ['day', 86_400_000],
  ['week', 604_800_000],
  ['month', 2_592_000_000],
  ['year', 31_536_000_000]
];

export interface Formatters {
  date(value: TimeInput, options?: Intl.DateTimeFormatOptions): string;
  time(value: TimeInput, options?: Intl.DateTimeFormatOptions): string;
  dateTime(value: TimeInput, options?: Intl.DateTimeFormatOptions): string;
  relative(value: TimeInput, now?: number): string;
  number(value: number, options?: Intl.NumberFormatOptions): string;
}

/** Formatters bound to a language: the UI language is read at every call, so a language switch needs no rebuild. */
export function makeFormatters(getLocale: () => Locale): Formatters {
  const dateTime = (options: Intl.DateTimeFormatOptions, value: TimeInput): string => {
    const locale = getLocale();
    return cached('dtf', locale, options, () => new Intl.DateTimeFormat(locale, options)).format(toDate(value));
  };
  return {
    date: (value, options) => dateTime(options ?? { dateStyle: 'medium' }, value),
    time: (value, options) => dateTime(options ?? { timeStyle: 'short' }, value),
    dateTime: (value, options) => dateTime(options ?? { dateStyle: 'medium', timeStyle: 'short' }, value),
    relative: (value, now = Date.now()) => {
      const locale = getLocale();
      const delta = toDate(value).getTime() - now;
      const step = RELATIVE_STEPS.findLast(([, size]) => Math.abs(delta) >= size) ?? RELATIVE_STEPS[0];
      const [unit, size] = step;
      const format = cached('rtf', locale, { numeric: 'auto' }, () => new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }));
      return format.format(Math.round(delta / size), unit);
    },
    number: (value, options) => {
      const locale = getLocale();
      return cached('nf', locale, options, () => new Intl.NumberFormat(locale, options)).format(value);
    }
  };
}
