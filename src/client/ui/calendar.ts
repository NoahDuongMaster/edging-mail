// Date math of the date-time picker (ui/DateTimePicker.tsx), in local time, to the minute. Pure functions (tested in
// test/client/ui-signature.test.ts). Values are the strings `<input type="datetime-local">` produced: `YYYY-MM-DDTHH:mm`.

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** `YYYY-MM-DDTHH:mm` of a local date, to the minute (what the callers stored from the browser's field). */
export function formatValue(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** Reads `YYYY-MM-DDTHH:mm` as local time; null when it is empty or not a real date (Feb 30). */
export function parseValue(value: string | undefined): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value ?? '');
  if (match === null) {
    return null;
  }
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  return date.getMonth() === month - 1 && date.getDate() === day && hour < 24 && minute < 60 ? date : null;
}

/** `YYYY-MM-DD` of a local date: the key of a day cell. */
export function dayKey(date: Date): string {
  return formatValue(date).slice(0, 10);
}

export const startOfDay = (date: Date): Date => new Date(date.getFullYear(), date.getMonth(), date.getDate());

export const sameDay = (a: Date, b: Date): boolean => dayKey(a) === dayKey(b);

/** The same wall-clock time `days` days later (local calendar days, so a DST change keeps the hour). */
export function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days, date.getHours(), date.getMinutes());
}

/** The same day `months` months later; the 31st becomes the last day of a shorter month. */
export function addMonths(date: Date, months: number): Date {
  const first = new Date(date.getFullYear(), date.getMonth() + months, 1, date.getHours(), date.getMinutes());
  const last = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  first.setDate(Math.min(date.getDate(), last));
  return first;
}

/** `date` moved into [min, max] (either may be missing). */
export function clampDate(date: Date, min: Date | null, max: Date | null): Date {
  if (min !== null && date < min) {
    return new Date(min);
  }
  if (max !== null && date > max) {
    return new Date(max);
  }
  return date;
}

interface WeekInfo {
  firstDay?: number;
}
type LocaleWithWeek = Intl.Locale & { getWeekInfo?: () => WeekInfo; weekInfo?: WeekInfo };

/**
 * The first day of the week in `locale` as `Date.getDay()` numbers (0 Sunday ... 6 Saturday): Intl.Locale weekInfo where the browser has
 * it (en = en-US: Sunday; vi, zh-CN: Monday), else Monday.
 */
export function weekStart(locale: string): number {
  try {
    const intl = new Intl.Locale(locale) as LocaleWithWeek;
    const info = typeof intl.getWeekInfo === 'function' ? intl.getWeekInfo() : intl.weekInfo;
    const first = info?.firstDay;
    // weekInfo counts 1 Monday ... 7 Sunday.
    return typeof first === 'number' && first >= 1 && first <= 7 ? first % 7 : 1;
  } catch {
    return 1;
  }
}

/** The first day shown in the week row of `date`. */
export function startOfWeek(date: Date, firstDay: number): Date {
  const back = (date.getDay() - firstDay + 7) % 7;
  return addDays(date, -back);
}

/** The 42 days (6 weeks) of the month grid of `year`/`month` (0-11), starting on `firstDay`, at midnight. */
export function monthGrid(year: number, month: number, firstDay: number): Date[] {
  const start = startOfWeek(new Date(year, month, 1), firstDay);
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
}

/** The minute steps offered for a time: every 5 minutes, plus `current` when it is not on a step. */
export function minuteSteps(current: number): number[] {
  const steps = Array.from({ length: 12 }, (_, index) => index * 5);
  return steps.includes(current) ? steps : [...steps, current].toSorted((a, b) => a - b);
}

/** The next whole 5 minutes at or after `date` (a sensible start when nothing is chosen yet). */
export function ceilToStep(date: Date, step = 5): Date {
  const result = new Date(date);
  result.setSeconds(0, 0);
  const extra = result.getMinutes() % step;
  if (extra !== 0 || date.getSeconds() > 0 || date.getMilliseconds() > 0) {
    result.setMinutes(result.getMinutes() - extra + step);
  }
  return result;
}
