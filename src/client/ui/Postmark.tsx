import type React from 'react';
import { fmt, useLocale } from '../lib/i18n';
import { cx } from './cx';

// v3 signature: the postmark (decorative, aria-hidden). A circular date stamp (two concentric 1 px rings, the day and short month over the
// time inside, in small tabular caps) with wavy cancellation lines running to its right, turned -8 degrees as a hand stamp lands. It marks
// a moment of delivery: the reader's open letter (its top-right corner, the ring alone with the year: v3 P1) and the compose window's stamp
// at Send. The real
// date is always written in words elsewhere (the reader's header, the toast); this only draws it. Dates go through the i18n `fmt`
// helpers, in the app's language. It never moves by itself: a caller that stamps it (compose at Send) animates it under its own
// reduced-motion rule. Ink: --text3 at 55 % (signature.css), so it reads on the surface and on a stamp in both themes.

export interface PostmarkProps {
  /** The moment it marks (a Date or epoch milliseconds). */
  date: Date | number;
  /** The diameter of the circle in px (the drawing scales with it); 64 by default, 48 on a phone. */
  size?: number;
  /** The reach of the cancellation lines: 'long' (about 1.1 diameters), 'short' (about half one, beside a close button) or 'none' (the
   *  date ring alone: the reader's letter corner, where there is no stamp to cancel). */
  waves?: 'long' | 'short' | 'none';
  /** What the ring prints under the day: the 'time' (default: a moment, compose at Send) or the 'year' (the reader's corner, whose
   *  header already says the time in words). */
  lower?: 'time' | 'year';
  className?: string;
}

/** The drawing's own unit: a 64 px circle centred at (32, 32). */
const UNIT = 64;
const CENTRE = 32;
/** The two rings (1 px each, drawn at that width whatever the size). */
const RINGS = [31.25, 26.5] as const;
/** The cancellation lines: their height in the drawing (they start just clear of the outer ring), a little above the centre. */
const WAVE_ROWS = [22, 29.5, 37] as const;
/** One wave: a quarter-wavelength step and its height. */
const STEP = 3.5;
const AMPLITUDE = 2.2;
const REACH = { long: 136, short: 104, none: UNIT } as const;
/** The turn of a hand stamp. */
const TILT = -8;

/** A wavy line from x0 to x1 at height y: smooth quadratic arcs, alternating up and down. */
function wave(y: number, x0: number, x1: number): string {
  const steps = Math.max(2, Math.floor((x1 - x0) / (STEP * 2)));
  return `M${x0.toFixed(1)} ${y} q${STEP} ${-AMPLITUDE} ${STEP * 2} 0${` t${STEP * 2} 0`.repeat(steps - 1)}`;
}

/** Where a line at height y leaves the outer ring, plus a hair of paper. */
const startOf = (y: number): number => CENTRE + Math.sqrt(Math.max(0, RINGS[0] ** 2 - (y - CENTRE) ** 2)) + 2.5;

/** A long date ('15 thg 11') is fitted into the inner ring instead of running over it. */
const fit = (text: string, room: number): { textLength?: number; lengthAdjust?: 'spacingAndGlyphs' } =>
  text.length > 8 ? { textLength: room, lengthAdjust: 'spacingAndGlyphs' } : {};

/** A circular postmark with the date (and the time or the year) inside and, unless `waves="none"`, wavy lines to its right; decoration
 *  only (aria-hidden). */
export function Postmark({ date, size = UNIT, waves = 'long', lower = 'time', className }: PostmarkProps): React.ReactElement {
  // Read so a change of language draws the date again in the new one (fmt reads the language at every call).
  useLocale();
  const when = date instanceof Date ? date : new Date(date);
  const day = fmt.date(when, { day: 'numeric', month: 'short' });
  const second = lower === 'year' ? String(when.getFullYear()) : fmt.time(when, { hour: 'numeric', minute: '2-digit' });
  // The ring alone is its own box (the drawing's 64 units); waves reach past it, plus a hair for their round caps.
  const width = waves === 'none' ? UNIT : REACH[waves] + 4;
  const scale = size / UNIT;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={cx('ui-postmark', className)}
      data-waves={waves}
      width={Math.round(width * scale)}
      height={size}
      viewBox={`0 0 ${width} ${UNIT}`}
      fill="none"
    >
      <g transform={`rotate(${TILT} ${CENTRE} ${CENTRE})`}>
        {RINGS.map((r) => (
          <circle key={r} cx={CENTRE} cy={CENTRE} r={r} className="ui-postmark-ring" vectorEffect="non-scaling-stroke" />
        ))}
        {waves === 'none'
          ? null
          : WAVE_ROWS.map((y) => (
              <path key={y} d={wave(y, startOf(y), REACH[waves])} className="ui-postmark-wave" vectorEffect="non-scaling-stroke" />
            ))}
        <text x={CENTRE} y={30} textAnchor="middle" className="ui-postmark-day" {...fit(day, 44)}>
          {day}
        </text>
        <text x={CENTRE} y={41.5} textAnchor="middle" className="ui-postmark-time" {...fit(second, 40)}>
          {second}
        </text>
      </g>
    </svg>
  );
}
