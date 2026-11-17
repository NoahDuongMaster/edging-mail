import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DateTimePicker, FlightTrail, Odometer, Postmark, Spinner } from '../../src/client/ui';
import {
  addMonths,
  ceilToStep,
  clampDate,
  formatValue,
  minuteSteps,
  monthGrid,
  parseValue,
  startOfWeek,
  weekStart
} from '../../src/client/ui/calendar';
import { arcControl, arcPoint, homingDuration } from '../../src/client/ui/homing';

// The v3 signature primitives (DESIGN-v3 section 3, F2), rendered on the server side of React: the markup screen readers and the stylesheet
// rely on, and the pure rules (the date math of the picker, the arc of a homing flight). The motion itself is proven in the UI lab
// (frames at 0.1x and getAnimations logs), because there is no DOM here.

const noop = (): void => {
  // a callback the test does not look at
};
const render = (element: Parameters<typeof renderToStaticMarkup>[0]): string => renderToStaticMarkup(element);
/** The text a screen reader gets: the markup without its aria-hidden subtrees (none of them nest another span of the same kind here). */
const spoken = (html: string): string =>
  html
    .replaceAll(/<(span|svg)[^>]*aria-hidden="true"[^>]*>[\s\S]*?<\/\1>(?:<\/span>)*/g, '')
    .replaceAll(/<[^>]+>/g, '')
    .trim();

describe('Odometer (H2)', () => {
  it('says the value once for screen readers; the drawn digits are aria-hidden, one rolling cell per ASCII digit', () => {
    const html = render(h(Odometer, { value: 1234, format: (value: number) => value.toLocaleString('en-US'), className: 'x' }));
    expect(html).toMatch(
      /^<span class="ui-odo x"><span class="ui-visually-hidden">1,234<\/span><span class="ui-odo-face" aria-hidden="true">/
    );
    expect(html.split('1,234')).toHaveLength(2);
    expect(html.match(/class="ui-odo-d"/g)).toHaveLength(4);
    // A separator (or any character a formatter adds) stands still.
    expect(html).toContain('<span class="ui-odo-s">,</span>');
    expect(render(h(Odometer, { value: 7 }))).toContain('<span class="ui-visually-hidden">7</span>');
  });
});

describe('DateTimePicker (H9)', () => {
  const props = { id: 'when', label: 'Snooze until', hideLabel: true, value: '2026-11-17T08:00', onChange: noop };

  it('is a field-like combobox button that opens a dialog: no browser datetime field', () => {
    const html = render(h(DateTimePicker, { ...props, min: '2026-11-16T18:41', max: '2027-11-16T18:40' }));
    expect(html).not.toMatch(/<input\b|datetime-local/);
    const trigger = /<button[^>]*>/.exec(html)?.[0] ?? '';
    expect(trigger).toContain('id="when"');
    expect(trigger).toContain('type="button"');
    expect(trigger).toContain('role="combobox"');
    expect(trigger).toContain('aria-haspopup="dialog"');
    expect(trigger).toContain('aria-expanded="false"');
    expect(trigger).toContain('aria-labelledby="when-label when-value"');
    expect(trigger).toMatch(/class="ui-select ui-dtp-trigger"/);
    // The label (for screen readers only here) and the value the name is made of; the value in the app's words (medium date, short time).
    expect(html).toContain('<span id="when-label" class="ui-visually-hidden">Snooze until</span>');
    expect(html).toMatch(/<span id="when-value" class="ui-select-value ui-dtp-value">Nov 17, 2026, 8:00/);
    // The calendar icon is decoration.
    expect(html).toMatch(/<svg[^>]*ui-dtp-icon[^>]*>/);
    expect(/<svg[^>]*ui-dtp-icon[^>]*>/.exec(html)?.[0]).toContain('aria-hidden="true"');
  });

  it('passes the caller aria-invalid and aria-describedby, joins its own hint and error, and says when it is empty or disabled', () => {
    const invalid = render(h(DateTimePicker, { ...props, 'aria-invalid': true, 'aria-describedby': 'when-problem' }));
    expect(invalid).toContain('aria-invalid="true"');
    expect(invalid).toContain('data-invalid="true"');
    expect(invalid).toContain('aria-describedby="when-problem"');
    const own = render(h(DateTimePicker, { ...props, hideLabel: false, hint: 'Local time', error: 'Too soon' }));
    expect(own).toContain('aria-describedby="when-hint when-error"');
    // v4m R1: the hint is an InfoTip after the label by default (the label element keeps only its words, so the name is unchanged) and
    // stays in the page for aria-describedby; `hintMode="inline"` keeps the visible line.
    expect(own).toContain('<div class="ui-label ui-tip-row"><span id="when-label">Snooze until</span><button type="button"');
    expect(own).toContain('<span id="when-hint" class="ui-visually-hidden">Local time</span>');
    const inline = render(h(DateTimePicker, { ...props, hideLabel: false, hint: 'Local time', hintMode: 'inline' }));
    expect(inline).toContain('<span id="when-label" class="ui-label">Snooze until</span>');
    expect(inline).toContain('<p id="when-hint" class="ui-hint">Local time</p>');
    expect(inline).not.toContain('ui-infotip');
    expect(own).toContain('aria-invalid="true"');
    const empty = render(h(DateTimePicker, { ...props, value: '' }));
    expect(empty).toContain('data-placeholder="true">Choose a date and time</span>');
    const disabled = render(h(DateTimePicker, { ...props, disabled: true }));
    expect(disabled).toContain('aria-disabled="true"');
    expect(disabled).toContain('tabindex="-1"');
    // Named by aria-label alone: the name still holds the visible value (2.5.3).
    const named = render(h(DateTimePicker, { value: '2026-11-17T08:00', onChange: noop, id: 'n', 'aria-label': 'Date and time' }));
    expect(named).toContain('<span id="n-label" class="ui-visually-hidden">Date and time</span>');
    expect(named).toContain('aria-labelledby="n-label n-value"');
  });
});

describe('FlightTrail (H7) and the wingbeat loader (H8)', () => {
  it('draws the trail as decoration only, with mask ids unique per instance', () => {
    const html = render(h('div', null, h(FlightTrail, { size: 'lg', tone: 'panel' }), h(FlightTrail, { size: 'sm' })));
    expect(html).toMatch(/^<div><svg aria-hidden="true" focusable="false" class="ui-trail" data-size="lg" data-tone="panel"/);
    expect(html).toContain('viewBox="0 0 520 220"');
    expect(html).toContain('viewBox="0 0 96 40"');
    expect(html.match(/class="ui-trail-echo"/g)).toHaveLength(2);
    const ids = [...html.matchAll(/<mask[^>]*id="([^"]+)"/g)].map((match) => match[1]);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(4);
    for (const id of ids) {
      expect(id).toMatch(/^[\w-]+$/);
    }
    expect(spoken(html)).toBe('');
    expect(render(h(FlightTrail, {}))).toContain('data-size="md" data-tone="default"');
  });

  it('Spinner: three aria-hidden dots in a size box, a status with its words, or silent inside a busy control', () => {
    const own = render(h(Spinner, { label: 'Checking the records…', size: 20 }));
    expect(own).toMatch(/^<span class="ui-spinner" role="status"><span class="ui-wing" aria-hidden="true" style="--ui-wing-size:20px">/);
    expect(own.match(/class="ui-wing-dot"/g)).toHaveLength(3);
    expect(spoken(own)).toBe('Checking the records…');
    const decorative = render(h(Spinner, { decorative: true }));
    expect(decorative).not.toContain('role=');
    expect(spoken(decorative)).toBe('');
  });
});

describe('Postmark (v3 X1)', () => {
  it('draws a decorative date stamp: two rings, three wavy lines, the day and the time in the app language, nothing for screen readers', () => {
    const date = new Date(2026, 10, 15, 10, 5);
    const html = render(h(Postmark, { date, className: 'x' }));
    expect(html).toMatch(
      /^<svg aria-hidden="true" focusable="false" class="ui-postmark x" data-waves="long" width="140" height="64" viewBox="0 0 140 64"/
    );
    expect(html.match(/class="ui-postmark-ring"/g)).toHaveLength(2);
    expect(html.match(/class="ui-postmark-wave"/g)).toHaveLength(3);
    // The date through the i18n fmt helpers (en here): the day and short month over the time; the drawing turns -8 degrees as a hand stamp.
    expect(html).toMatch(/class="ui-postmark-day">Nov 15<\/text>/);
    expect(html).toMatch(/class="ui-postmark-time">10:05\sAM<\/text>/);
    expect(html).toContain('transform="rotate(-8 32 32)"');
    expect(spoken(html)).toBe('');
    // A phone's 48 px postmark with the short waves (beside a close button): the drawing scales, its viewBox keeps the unit.
    expect(render(h(Postmark, { date: date.getTime(), size: 48, waves: 'short' }))).toContain(
      'width="81" height="48" viewBox="0 0 108 64"'
    );
    // v3 P1: the reader's corner ring: no waves (its box is the ring's), and the year under the day instead of the time.
    const corner = render(h(Postmark, { date, size: 56, waves: 'none', lower: 'year' }));
    expect(corner).toContain('data-waves="none" width="56" height="56" viewBox="0 0 64 64"');
    expect(corner).not.toContain('ui-postmark-wave');
    expect(corner).toMatch(/class="ui-postmark-time">2026<\/text>/);
    expect(spoken(corner)).toBe('');
  });
});

describe('the date math of the picker', () => {
  it('reads and writes the value of the browser field it replaces, and refuses impossible dates', () => {
    expect(formatValue(new Date(2026, 10, 5, 8, 0))).toBe('2026-11-05T08:00');
    expect(parseValue('2026-11-05T08:00')?.getTime()).toBe(new Date(2026, 10, 5, 8, 0).getTime());
    expect(parseValue('2026-02-30T08:00')).toBeNull();
    expect(parseValue('')).toBeNull();
    expect(parseValue('2026-11-05 08:00')).toBeNull();
  });

  it('starts the week where the language does (Intl weekInfo; Monday without it) and lays out six weeks', () => {
    const intl = new Intl.Locale('en') as Intl.Locale & { getWeekInfo?: unknown; weekInfo?: unknown };
    const known = typeof intl.getWeekInfo === 'function' || intl.weekInfo !== undefined;
    expect(weekStart('en')).toBe(known ? 0 : 1);
    expect(weekStart('vi')).toBe(1);
    expect(weekStart('zh-CN')).toBe(1);
    expect(weekStart('not a locale')).toBe(1);
    // 1 November 2026 is a Sunday.
    const monday = monthGrid(2026, 10, 1);
    expect(monday).toHaveLength(42);
    expect(formatValue(monday[0])).toBe('2026-10-26T00:00');
    expect(formatValue(monthGrid(2026, 10, 0)[0])).toBe('2026-11-01T00:00');
    expect(formatValue(startOfWeek(new Date(2026, 10, 18), 1))).toBe('2026-11-16T00:00');
  });

  it('moves by months without overflowing, offers 5-minute steps plus an odd current minute, clamps into the range', () => {
    expect(formatValue(addMonths(new Date(2026, 0, 31, 9, 30), 1))).toBe('2026-02-28T09:30');
    expect(formatValue(addMonths(new Date(2026, 2, 15), -12))).toBe('2025-03-15T00:00');
    expect(minuteSteps(40)).toHaveLength(12);
    expect(minuteSteps(41)).toEqual([0, 5, 10, 15, 20, 25, 30, 35, 40, 41, 45, 50, 55]);
    expect(formatValue(ceilToStep(new Date(2026, 10, 16, 18, 41, 30)))).toBe('2026-11-16T18:45');
    expect(formatValue(ceilToStep(new Date(2026, 10, 16, 18, 45, 0)))).toBe('2026-11-16T18:45');
    const min = new Date(2026, 10, 16, 18, 41);
    const max = new Date(2027, 10, 16, 18, 40);
    expect(formatValue(clampDate(new Date(2026, 10, 16, 8, 0), min, max))).toBe('2026-11-16T18:41');
    expect(formatValue(clampDate(new Date(2028, 0, 1), min, max))).toBe('2027-11-16T18:40');
  });
});

describe('the homing arc (H1)', () => {
  const viewport = { width: 1440, height: 900 };

  it('lifts the arc above the straight line by about a quarter of the distance, inside the screen', () => {
    const from = { x: 760, y: 420 };
    const to = { x: 120, y: 260 };
    const control = arcControl(from, to, viewport);
    const apex = arcPoint(from, control, to, 0.5);
    const middle = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    expect(apex.y).toBeLessThan(middle.y);
    const lift = Math.hypot(control.x - middle.x, control.y - middle.y) / Math.hypot(to.x - from.x, to.y - from.y);
    expect(lift).toBeGreaterThanOrEqual(0.18);
    expect(lift).toBeLessThanOrEqual(0.28);
  });

  it('flips below the line near the top edge, and never leaves the screen', () => {
    const from = { x: 900, y: 24 };
    const to = { x: 100, y: 30 };
    const control = arcControl(from, to, viewport);
    expect(control.y).toBeGreaterThan(30);
    for (let t = 0; t <= 1; t += 0.1) {
      const p = arcPoint(from, control, to, t);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(viewport.height);
    }
  });

  it('takes --dur-homing (620 ms) for a typical way, 480-720 ms by distance', () => {
    expect(homingDuration(700)).toBe(620);
    expect(homingDuration(40)).toBe(480);
    expect(homingDuration(3000)).toBe(720);
  });
});
