// Snooze times, in the browser's local time zone. Pure functions (no React, no clock reads unless a default says so) so they can be tested in Node.
// The texts are looked up when a function runs (never at module load), in the UI language.
import { fmt, tr } from './i18n';
import { formatClock } from './mail';

/** The server rejects a wake time sooner than this or later than MAX_SNOOZE_MS from now. */
export const MIN_SNOOZE_MS = 60_000;
export const MAX_SNOOZE_MS = 366 * 86_400_000;
/** A saved wake time must be this much further ahead than the minimum to be set again (the request itself takes a moment). */
const RESNOOZE_MARGIN_MS = 10_000;
/** Keeps the whole day + time text in one piece: a toast or chip breaks before it, never inside it. */
const NBSP = '\u00A0';

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const EVENING_HOUR = 18;
const MORNING_HOUR = 8;
/** "Later today" is only worth offering when it is at least this far away. */
const LATER_TODAY_MIN_MS = 2 * HOUR_MS;

export interface SnoozePreset {
  id: 'later' | 'tomorrow' | 'weekend' | 'next-week';
  label: string;
  /** Short wake time shown next to the label, e.g. "Thu 8:00 AM". */
  hint: string;
  at: Date;
}

/**
 * `hour`:00 local on the calendar day `days` after `from`'s day. Built with the Date constructor (not by adding 24 h)
 * so the clock time stays right across a DST change.
 */
function atLocal(from: Date, days: number, hour: number): Date {
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + days, hour, 0, 0, 0);
}

/** Calendar days from `now`'s day to `date`'s day (0 = same day), whatever the length of the days in between. */
function dayOffset(date: Date, now: Date): number {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.round((day.getTime() - start.getTime()) / DAY_MS);
}

// Same clock as the message list ("9:31 AM"). A plain space before AM/PM is made non-breaking too.
function timeText(date: Date): string {
  return formatClock(date).replaceAll(' ', NBSP);
}

function weekdayText(date: Date): string {
  return fmt.date(date, { weekday: 'short' });
}

/** The default for a custom pick: tomorrow morning. */
export function tomorrowMorning(now: Date): Date {
  return atLocal(now, 1, MORNING_HOUR);
}

/**
 * The quick choices for `now`: Later today (18:00, if at least 2 h ahead), Tomorrow, This weekend (Saturday, not offered on
 * Saturday or Sunday) and Next week (the next Monday; on a Monday that is a week away). A choice that lands on the same
 * moment as an earlier one is left out (on a Friday "This weekend" is tomorrow, on a Sunday "Next week" is tomorrow).
 */
export function snoozePresets(now: Date): SnoozePreset[] {
  const day = now.getDay(); // 0 = Sunday
  const choices: Omit<SnoozePreset, 'hint'>[] = [];

  const evening = atLocal(now, 0, EVENING_HOUR);
  if (evening.getTime() - now.getTime() >= LATER_TODAY_MIN_MS) {
    choices.push({ id: 'later', label: tr('snooze.later_today'), at: evening });
  }
  choices.push({ id: 'tomorrow', label: tr('snooze.tomorrow'), at: tomorrowMorning(now) });
  if (day !== 0 && day !== 6) {
    choices.push({ id: 'weekend', label: tr('snooze.this_weekend'), at: atLocal(now, 6 - day, MORNING_HOUR) });
  }
  choices.push({ id: 'next-week', label: tr('snooze.next_week'), at: atLocal(now, (8 - day) % 7 || 7, MORNING_HOUR) });

  return choices
    .filter((choice, index) => choices.findIndex((other) => other.at.getTime() === choice.at.getTime()) === index)
    .map((choice) => ({
      ...choice,
      hint: choice.id === 'later' ? timeText(choice.at) : tr('snooze.day_time', { day: weekdayText(choice.at), time: timeText(choice.at) })
    }));
}

/** "today 6:00 PM", "tomorrow 8:00 AM", otherwise the date with its time ("Mon, Nov 12 8:00 AM"; the year is added when it is not this year). */
export function formatSnoozeUntil(untilMs: number, now: Date = new Date()): string {
  const until = new Date(untilMs);
  const offset = dayOffset(until, now);
  const time = timeText(until);
  if (offset === 0) {
    return tr('snooze.today_at', { time }).replaceAll(' ', NBSP);
  }
  if (offset === 1) {
    return tr('snooze.tomorrow_at', { time }).replaceAll(' ', NBSP);
  }
  const day = fmt.date(until, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    ...(until.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' as const })
  });
  return tr('snooze.day_time', { day, time }).replaceAll(' ', NBSP);
}

/**
 * Whether a mail's saved wake time can still be set again. Once it is due (or about to be) the server would refuse it, and the mail
 * belongs in the Inbox anyway: that is where the cron would have put it.
 */
export function canResnooze(untilMs: number, nowMs: number): boolean {
  return untilMs - nowMs >= MIN_SNOOZE_MS + RESNOOZE_MARGIN_MS;
}

/** Ids of the list headings of the Snoozed folder (the list turns them into text, in the UI language). */
export type SnoozeGroup = 'today' | 'tomorrow' | 'next-7-days' | 'later';

export const SNOOZE_GROUP_ORDER: SnoozeGroup[] = ['today', 'tomorrow', 'next-7-days', 'later'];

/** The list heading (as an id) for a snoozed mail, by the day it comes back. Soonest-first input stays in order across these groups. */
export function snoozeGroupOf(untilMs: number, now: Date = new Date()): SnoozeGroup {
  const offset = dayOffset(new Date(untilMs), now);
  if (offset <= 0) {
    return 'today';
  }
  if (offset === 1) {
    return 'tomorrow';
  }
  return offset <= 7 ? 'next-7-days' : 'later';
}

/** Why a custom wake time cannot be used (the server checks again), in the UI language, or null when it can. */
export function snoozeProblem(at: Date | null, now: Date): string | null {
  if (at === null || Number.isNaN(at.getTime())) {
    return tr('snooze.pick_date');
  }
  const ahead = at.getTime() - now.getTime();
  if (ahead < MIN_SNOOZE_MS) {
    return tr('snooze.too_soon');
  }
  return ahead > MAX_SNOOZE_MS ? tr('snooze.too_far') : null;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** The value format of `<input type="datetime-local">` ("2026-11-05T08:00"), in local time, to the minute. */
export function toLocalInputValue(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** Reads a datetime-local value ("2026-11-05T08:00", minute precision) as local time; null when it is empty or not a real date. */
export function parseLocalInput(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (match === null) {
    return null;
  }
  const [, year, month, day, hour, minute] = match.map(Number);
  const date = new Date(year, month - 1, day, hour, minute);
  // The constructor rolls over impossible dates (Feb 30 becomes Mar 2); a real date keeps its month and day.
  return date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}
