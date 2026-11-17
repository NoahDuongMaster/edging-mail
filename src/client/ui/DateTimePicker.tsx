import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import React from 'react';
import { createPortal } from 'react-dom';
import { trapTab } from '../lib/focusTrap';
import { fmt, useLocale, useT } from '../lib/i18n';
import { Button } from './Button';
import {
  addDays,
  addMonths,
  ceilToStep,
  clampDate,
  dayKey,
  formatValue,
  minuteSteps,
  monthGrid,
  parseValue,
  sameDay,
  startOfDay,
  startOfWeek,
  weekStart
} from './calendar';
import { cx } from './cx';
import { Dialog } from './Dialog';
import { describedBy, Field, has, type HintMode } from './Field';
import { IconButton } from './IconButton';
import { useLayer } from './layers';
import { useMediaMatch } from './media';
import { useExitMotion } from './motion';
import { placePopup } from './position';
import { Select, type SelectOption } from './Select';

// v3 H9 (DESIGN-v3 section 3): the date and time picker that replaces every `<input type="datetime-local">`. Values in and out are local
// `YYYY-MM-DDTHH:mm` strings, exactly what the callers read from the native field, so their checks stay as they were.
//
// The trigger is a field (the Select box look: 40 px, 44 on touch) with a calendar icon and the value in the app's language (Intl, medium
// date + short time) or a placeholder; it is a combobox button whose popup is a dialog (aria-haspopup="dialog"). The dialog follows the APG
// date picker dialog: a month heading (announced politely when it changes) with previous/next month buttons, a 7-column grid whose week
// starts where the language starts it (Intl weekInfo: Sunday for en, Monday for vi and zh-CN), Today and Tomorrow quick dates, a time row
// (hour and minute as ui Select, minutes in 5-minute steps plus the current minute when it is not on a step), then Cancel and Set. Keys in
// the grid: arrows move a day or a week, Home and End go to the start and end of the week, Page Up and Page Down a month (with Shift a
// year), Enter or Space picks the day; Tab stays inside; Escape closes and gives focus back to the trigger. Days outside min..max are
// aria-disabled; hours and minutes outside them are disabled options; a pick is moved into the range. On a desktop it floats under the
// trigger (a popup in <body>, the Popover look); on a phone it is a bottom sheet (ui Dialog).

export interface DateTimePickerProps {
  /** `YYYY-MM-DDTHH:mm` (local), or '' for none. */
  value: string;
  onChange: (value: string) => void;
  /** Earliest pickable moment, same format. */
  min?: string;
  /** Latest pickable moment, same format. */
  max?: string;
  id?: string;
  /** The accessible name when there is no `label` (it is then kept for screen readers only). */
  'aria-label'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  disabled?: boolean;
  className?: string;
  /** The field's label, as TextField's (drawn above it, or for screen readers only with `hideLabel`). */
  label?: string;
  hideLabel?: boolean;
  hint?: string;
  /** `tip` (default): the hint behind an InfoTip after the label; `inline`: a visible line under the trigger (Field's HintMode). */
  hintMode?: HintMode;
  error?: string;
  /** Shown while there is no value; default: "Choose a date and time". */
  placeholder?: string;
}

/** The width under which the picker is a bottom sheet (the Dialog's own breakpoint). */
const SHEET_QUERY = '(max-width: 640px)';

const pad2 = (n: number): string => String(n).padStart(2, '0');

/** The ids of the hour, minute and day-period lists (Select draws them in <body>): a press inside them is a press inside the picker. */
const listIdsOf = (baseId: string): string[] => [`${baseId}-hour-list`, `${baseId}-minute-list`, `${baseId}-period-list`];

/**
 * Chooses a date and a time (snooze until, a scheduled moment): a field-like button that opens a calendar dialog with a time row. Controlled:
 * `value` and `onChange` carry local `YYYY-MM-DDTHH:mm` strings; `min`/`max` limit what can be picked. Name it with `label` (or
 * `aria-label`); `aria-invalid` and `error` draw the danger edge. Use it instead of the browser's datetime field, which this replaces.
 */
export function DateTimePicker({
  value,
  onChange,
  min,
  max,
  id,
  disabled = false,
  className,
  label,
  hideLabel,
  hint,
  hintMode,
  error,
  placeholder,
  ...aria
}: DateTimePickerProps): React.JSX.Element {
  const tr = useT();
  // Formats follow the app's language: render again when it changes.
  useLocale();
  const generated = React.useId();
  const fieldId = id ?? generated;
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = React.useState(false);
  const sheet = useMediaMatch(SHEET_QUERY);
  const date = parseValue(value);
  const minDate = parseValue(min);
  const maxDate = parseValue(max);
  const name = label ?? aria['aria-label'];
  const invalid = aria['aria-invalid'] === true || has(error);
  const described = [aria['aria-describedby'], describedBy(fieldId, hint, error)].filter((part) => part !== undefined && part !== '');
  const dialogId = `${fieldId}-dialog`;

  const close = React.useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) {
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, []);

  const trigger = (
    <button
      ref={triggerRef}
      id={fieldId}
      type="button"
      role="combobox"
      className={cx('ui-select ui-dtp-trigger', className)}
      data-invalid={invalid ? 'true' : undefined}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-controls={open ? dialogId : undefined}
      aria-labelledby={name === undefined ? undefined : `${fieldId}-label ${fieldId}-value`}
      aria-describedby={described.length > 0 ? described.join(' ') : undefined}
      aria-invalid={invalid ? true : undefined}
      aria-disabled={disabled ? true : undefined}
      tabIndex={disabled ? -1 : undefined}
      onClick={() => {
        if (!disabled) {
          setOpen((was) => !was);
        }
      }}
      onKeyDown={(event) => {
        if (!disabled && !open && event.key === 'ArrowDown' && event.altKey) {
          event.preventDefault();
          setOpen(true);
        }
      }}
    >
      <CalendarDays size={16} strokeWidth={1.75} aria-hidden="true" className="ui-dtp-icon" />
      <span id={`${fieldId}-value`} className="ui-select-value ui-dtp-value" data-placeholder={date === null ? 'true' : undefined}>
        {date === null ? (placeholder ?? tr('datetime.empty')) : fmt.dateTime(date)}
      </span>
    </button>
  );

  const picker = open ? (
    <Picker
      baseId={fieldId}
      dialogId={dialogId}
      initial={clampDate(date ?? ceilToStep(new Date()), minDate, maxDate)}
      min={minDate}
      max={maxDate}
      sheet={sheet}
      anchorRef={triggerRef}
      onClose={close}
      onSet={(next) => {
        onChange(next);
        close(true);
      }}
    />
  ) : null;

  if (label !== undefined) {
    return (
      <Field id={fieldId} label={label} hideLabel={hideLabel} hint={hint} hintMode={hintMode} error={error} native={false}>
        {trigger}
        {picker}
      </Field>
    );
  }
  return (
    <>
      {name === undefined ? null : (
        <span id={`${fieldId}-label`} className="ui-visually-hidden">
          {name}
        </span>
      )}
      {trigger}
      {picker}
    </>
  );
}

interface PickerProps {
  baseId: string;
  dialogId: string;
  /** The moment the dialog starts on (the value, else the next 5 minutes), already inside min..max. */
  initial: Date;
  min: Date | null;
  max: Date | null;
  sheet: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Closes it; `returnFocus`: focus goes back to the trigger (Escape, Cancel), not when focus or a press went elsewhere. */
  onClose: (returnFocus: boolean) => void;
  onSet: (value: string) => void;
}

interface Formats {
  month: (date: Date) => string;
  weekdayShort: (date: Date) => string;
  weekdayLong: (date: Date) => string;
  full: (date: Date) => string;
  /** The chosen moment in one short line under the controls ("Tue, Nov 17, 8:00 AM"). */
  summary: (date: Date) => string;
  /** A 12-hour language (en): the words of its two day periods ("AM", "PM"); null for a 24-hour one (vi, zh-CN). */
  periods: readonly [string, string] | null;
}

/** The words of the picker, all through fmt (the UI language at the time of the call; the locale is only the memo key). */
function formatsFor(_locale: string): Formats {
  // A 12-hour language writes 21:00 as "9 PM": no "21" in it. Its day-period words are what is left without the digits.
  const twelve = !fmt.time(new Date(2000, 0, 1, 21), { hour: 'numeric' }).includes('21');
  const period = (hour: number): string =>
    fmt
      .time(new Date(2000, 0, 1, hour), { hour: 'numeric', hour12: true })
      .replaceAll(/[\d\s\u202F]/g, '')
      .trim();
  return {
    month: (date) => fmt.date(date, { month: 'long', year: 'numeric' }),
    weekdayShort: (date) => fmt.date(date, { weekday: 'short' }),
    weekdayLong: (date) => fmt.date(date, { weekday: 'long' }),
    full: (date) => fmt.date(date, { dateStyle: 'full' }),
    summary: (date) => fmt.dateTime(date, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }),
    periods: twelve ? [period(9), period(21)] : null
  };
}

/** The dialog: the month grid, the quick dates and the time, as a floating popup (desktop) or a bottom sheet (phone). */
function Picker({ baseId, dialogId, initial, min, max, sheet, anchorRef, onClose, onSet }: PickerProps): React.ReactElement {
  const tr = useT();
  const locale = useLocale();
  const formats = React.useMemo(() => formatsFor(locale), [locale]);
  const firstDay = React.useMemo(() => weekStart(locale), [locale]);
  const [draft, setDraft] = React.useState(initial);
  const [focusDay, setFocusDay] = React.useState(() => startOfDay(initial));
  const moveFocus = React.useRef(false);
  const focusRef = React.useRef<HTMLButtonElement | null>(null);
  const minDay = min === null ? null : startOfDay(min);
  const maxDay = max === null ? null : startOfDay(max);
  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);
  const monthId = `${baseId}-month`;
  const timeId = `${baseId}-time`;

  const outside = (day: Date): boolean => (minDay !== null && day < minDay) || (maxDay !== null && day > maxDay);
  const inRange = (moment: Date): Date => clampDate(moment, min, max);
  const keepDay = (day: Date): Date => clampDate(day, minDay, maxDay);

  // The day that has the grid's Tab stop moves with the keys; focus follows it after the commit.
  React.useLayoutEffect(() => {
    if (moveFocus.current) {
      moveFocus.current = false;
      focusRef.current?.focus({ preventScroll: true });
    }
  }, [focusDay]);

  const pickDay = (day: Date) => {
    if (outside(day)) {
      return;
    }
    setDraft((was) => inRange(new Date(day.getFullYear(), day.getMonth(), day.getDate(), was.getHours(), was.getMinutes())));
    setFocusDay(startOfDay(day));
  };

  const onGridKeyDown = (event: React.KeyboardEvent<HTMLTableElement>) => {
    const moves: Partial<Record<string, () => Date>> = {
      ArrowLeft: () => addDays(focusDay, -1),
      ArrowRight: () => addDays(focusDay, 1),
      ArrowUp: () => addDays(focusDay, -7),
      ArrowDown: () => addDays(focusDay, 7),
      Home: () => startOfWeek(focusDay, firstDay),
      End: () => addDays(startOfWeek(focusDay, firstDay), 6),
      PageUp: () => addMonths(focusDay, event.shiftKey ? -12 : -1),
      PageDown: () => addMonths(focusDay, event.shiftKey ? 12 : 1)
    };
    const move = moves[event.key];
    if (move === undefined || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    event.preventDefault();
    moveFocus.current = true;
    setFocusDay(keepDay(startOfDay(move())));
  };

  const year = focusDay.getFullYear();
  const month = focusDay.getMonth();
  const days = monthGrid(year, month, firstDay);
  // Only the weeks that hold a day of the month; the days of the months around it are blank cells (the keys still walk into them).
  const rows = Math.ceil((days.findIndex((day) => day.getMonth() === month) + new Date(year, month + 1, 0).getDate()) / 7);
  const weeks = Array.from({ length: rows }, (_, row) => days.slice(row * 7, row * 7 + 7));
  const lastOfPrevious = new Date(year, month, 0);
  const firstOfNext = new Date(year, month + 1, 1);
  const showMonth = (step: number) => {
    setFocusDay(keepDay(startOfDay(addMonths(focusDay, step))));
  };

  const y = draft.getFullYear();
  const mo = draft.getMonth();
  const d = draft.getDate();
  const hourOut = (hour: number): boolean =>
    (min !== null && new Date(y, mo, d, hour, 59) < min) || (max !== null && new Date(y, mo, d, hour, 0) > max);
  const { periods } = formats;
  const afternoon = draft.getHours() >= 12;
  // A 12-hour language picks 12, 1 ... 11 and the day period beside the minutes ("8 : 00 AM", as it is written); a 24-hour one 00 ... 23.
  const hours: SelectOption[] =
    periods === null
      ? Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: pad2(hour), disabled: hourOut(hour) }))
      : Array.from({ length: 12 }, (_, index) => {
          const hour = index + (afternoon ? 12 : 0);
          return { value: String(hour), label: String(index === 0 ? 12 : index), disabled: hourOut(hour) };
        });
  const halfOut = (pm: boolean): boolean => Array.from({ length: 12 }, (_, index) => index + (pm ? 12 : 0)).every((hour) => hourOut(hour));
  const setHour = (hour: number) => setDraft((was) => inRange(new Date(y, mo, d, hour, was.getMinutes())));
  const minutes: SelectOption[] = minuteSteps(draft.getMinutes()).map((minute) => {
    const at = new Date(y, mo, d, draft.getHours(), minute);
    return { value: String(minute), label: pad2(minute), disabled: (min !== null && at < min) || (max !== null && at > max) };
  });

  const quick = (
    <div className="ui-dtp-quick">
      {[
        { day: today, text: tr('datetime.today') },
        { day: tomorrow, text: tr('datetime.tomorrow') }
      ].map(({ day, text }) => (
        <button
          key={dayKey(day)}
          type="button"
          className="ui-dtp-chip"
          aria-pressed={sameDay(day, draft)}
          disabled={outside(day)}
          onClick={() => pickDay(day)}
        >
          {text}
        </button>
      ))}
    </div>
  );

  const content = (
    <div className="ui-dtp">
      <div className="ui-dtp-head">
        <h2 id={monthId} className="ui-dtp-month" aria-live="polite">
          {formats.month(focusDay)}
        </h2>
        <div className="ui-dtp-nav">
          <IconButton
            label={tr('datetime.prev_month')}
            size="sm"
            disabled={minDay !== null && lastOfPrevious < minDay}
            onClick={() => showMonth(-1)}
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </IconButton>
          <IconButton
            label={tr('datetime.next_month')}
            size="sm"
            disabled={maxDay !== null && firstOfNext > maxDay}
            onClick={() => showMonth(1)}
          >
            <ChevronRight size={16} aria-hidden="true" />
          </IconButton>
        </div>
      </div>
      {/* APG date picker dialog: the month is an ARIA grid, the arrow keys move between its days. */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-to-interactive-role -- see above */}
      <table role="grid" aria-labelledby={monthId} className="ui-dtp-grid" onKeyDown={onGridKeyDown}>
        <thead>
          <tr>
            {days.slice(0, 7).map((day) => (
              <th key={day.getDay()} scope="col" abbr={formats.weekdayLong(day)}>
                {formats.weekdayShort(day)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={dayKey(week[0] ?? today)}>
              {week.map((day) => {
                if (day.getMonth() !== month) {
                  return <td key={dayKey(day)} className="ui-dtp-blank" />;
                }
                const focused = sameDay(day, focusDay);
                const disabled = outside(day);
                const isToday = sameDay(day, today);
                const selected = sameDay(day, draft);
                return (
                  <td key={dayKey(day)} aria-selected={selected}>
                    <button
                      ref={focused ? focusRef : undefined}
                      type="button"
                      className="ui-dtp-day"
                      tabIndex={focused ? 0 : -1}
                      data-day={dayKey(day)}
                      data-today={isToday ? 'true' : undefined}
                      data-selected={selected ? 'true' : undefined}
                      aria-current={isToday ? 'date' : undefined}
                      aria-disabled={disabled ? true : undefined}
                      onClick={() => pickDay(day)}
                    >
                      <span aria-hidden="true">{day.getDate()}</span>
                      <span className="ui-visually-hidden">{formats.full(day)}</span>
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {quick}
      <div className="ui-dtp-time" role="group" aria-labelledby={timeId}>
        <span id={timeId} className="ui-dtp-time-label">
          {tr('datetime.time_label')}
        </span>
        <div className="ui-dtp-time-part">
          <Select
            id={`${baseId}-hour`}
            label={tr('datetime.hour')}
            hideLabel
            options={hours}
            value={String(draft.getHours())}
            onChange={(next) => setHour(Number(next))}
          />
        </div>
        <span className="ui-dtp-colon" aria-hidden="true">
          :
        </span>
        <div className="ui-dtp-time-part">
          <Select
            id={`${baseId}-minute`}
            label={tr('datetime.minute')}
            hideLabel
            options={minutes}
            value={String(draft.getMinutes())}
            onChange={(next) => setDraft((was) => inRange(new Date(y, mo, d, was.getHours(), Number(next))))}
          />
        </div>
        {periods === null ? null : (
          <div className="ui-dtp-time-part" data-period="">
            <Select
              id={`${baseId}-period`}
              label={tr('datetime.day_period')}
              hideLabel
              options={[
                { value: 'am', label: periods[0], disabled: halfOut(false) },
                { value: 'pm', label: periods[1], disabled: halfOut(true) }
              ]}
              value={afternoon ? 'pm' : 'am'}
              onChange={(next) => setHour((draft.getHours() % 12) + (next === 'pm' ? 12 : 0))}
            />
          </div>
        )}
      </div>
      <p className="ui-dtp-summary">{formats.summary(draft)}</p>
    </div>
  );

  const actions = (
    <>
      <Button variant="secondary" onClick={() => onClose(true)}>
        {tr('common.cancel')}
      </Button>
      <Button variant="primary" onClick={() => onSet(formatValue(draft))}>
        {tr('datetime.set')}
      </Button>
    </>
  );

  if (sheet) {
    // The sheet's heading (a Dialog prop, not a tooltip).
    const heading = { title: tr('datetime.dialog_label') };
    return (
      <Dialog
        open
        onClose={() => onClose(true)}
        {...heading}
        size="sm"
        className="ui-dtp-sheet"
        initialFocusRef={focusRef}
        returnFocusRef={anchorRef}
        footer={actions}
      >
        {content}
      </Dialog>
    );
  }
  return (
    <Floating id={dialogId} baseId={baseId} label={tr('datetime.dialog_label')} anchorRef={anchorRef} focusRef={focusRef} onClose={onClose}>
      {content}
      <div className="ui-dtp-actions">{actions}</div>
    </Floating>
  );
}

interface FloatingProps {
  id: string;
  baseId: string;
  label: string;
  anchorRef: React.RefObject<HTMLElement | null>;
  focusRef: React.RefObject<HTMLElement | null>;
  onClose: (returnFocus: boolean) => void;
  children: React.ReactNode;
}

/**
 * The desktop popup: a modal dialog in <body> placed under the trigger (above when there is no room), the Popover look. Focus goes in on
 * open and is trapped; Escape (the top layer) closes it and returns focus; a press outside or focus moving elsewhere closes it. Opened from
 * inside another popup (Snooze's), a press inside it is kept from that popup's "outside" rule.
 */
function Floating({ id, baseId, label, anchorRef, focusRef, onClose, children }: FloatingProps): React.ReactElement {
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const closeRef = React.useRef(onClose);
  React.useLayoutEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);
  useLayer(true, () => closeRef.current(true));
  useExitMotion(panelRef, 'popup');

  const ours = React.useCallback(
    (node: Node): boolean =>
      panelRef.current?.contains(node) === true ||
      listIdsOf(baseId).some((list) => document.querySelector(`#${CSS.escape(list)}`)?.contains(node) === true),
    [baseId]
  );

  React.useLayoutEffect(() => {
    const place = () => {
      const panel = panelRef.current;
      const anchor = anchorRef.current;
      if (panel === null || anchor === null) {
        return;
      }
      panel.style.maxHeight = '';
      const placement = placePopup(
        anchor.getBoundingClientRect(),
        { width: panel.offsetWidth, height: panel.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        'start',
        8,
        8
      );
      panel.style.top = `${placement.top}px`;
      panel.style.left = `${placement.left}px`;
      panel.style.maxHeight = `${placement.maxHeight}px`;
      panel.dataset.side = placement.side;
    };
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node && ours(event.target))) {
        place();
      }
    };
    place();
    // A month with fewer weeks makes it shorter: it is placed again (an "above" popup keeps its bottom by the trigger).
    const sizes = new ResizeObserver(place);
    if (panelRef.current !== null) {
      sizes.observe(panelRef.current);
    }
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      sizes.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchorRef, ours]);

  React.useEffect(() => {
    focusRef.current?.focus({ preventScroll: true });
  }, [focusRef]);

  React.useEffect(() => {
    const nested = anchorRef.current?.closest('.ui-popover') !== null && anchorRef.current?.closest('.ui-popover') !== undefined;
    // In front of the document's own capture listeners: a popup that holds the trigger must not see a press inside this one as outside.
    const shield = (event: PointerEvent) => {
      if (nested && event.target instanceof Node && ours(event.target)) {
        event.stopPropagation();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !ours(target) && anchorRef.current?.contains(target) !== true) {
        closeRef.current(false);
      }
    };
    window.addEventListener('pointerdown', shield, true);
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('pointerdown', shield, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [anchorRef, ours]);

  return createPortal(
    // The dialog keeps Tab inside and closes when focus leaves it (APG modal dialog).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- see above
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      tabIndex={-1}
      className="ui-popover ui-dtp-pop"
      onKeyDown={(event) => {
        if (event.key === 'Tab') {
          trapTab(event, panelRef.current);
        }
      }}
      onBlur={(event) => {
        const next = event.relatedTarget;
        if (next instanceof Node && !ours(next) && anchorRef.current?.contains(next) !== true) {
          closeRef.current(false);
        }
      }}
    >
      {children}
    </div>,
    document.body
  );
}
