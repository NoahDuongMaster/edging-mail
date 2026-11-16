import React from 'react';
import { cx } from './cx';

// v3 signature H7 (DESIGN-v3 section 3): the dashed flight trail with a small letter at its end (decorative, aria-hidden). It draws in
// once on mount (a mask whose stroke-dashoffset runs 700 ms with --ease-emph-enter; the dashes themselves never move), the letter settles
// at its end, then everything is still: no loop (WCAG 2.2.2). Under reduced motion it is drawn from the start. Colours: the trail is the
// accent at 55 % (`tone="panel"`: --brand-panel-line on the brand panel), the letter a --surface sheet with an accent edge.
// Sizes (px): sm 96 x 40 (inline hints), md 180 x 72 (empty states, the empty reader), lg 520 x 220 (the auth brand panel: a long, quiet
// curve with two faint secondary trails; it scales down with its container).

export interface FlightTrailProps {
  size?: 'sm' | 'md' | 'lg';
  /** 'default' on a sheet or the page; 'panel' on the brand panel of the sign-in screens. */
  tone?: 'default' | 'panel';
  className?: string;
}

interface Drawing {
  width: number;
  height: number;
  /** The main trail. */
  path: string;
  /** Faint secondary trails (lg). */
  echoes: readonly string[];
  /** The letter: its centre, its angle along the end of the trail, its size. */
  letter: { x: number; y: number; angle: number; width: number; height: number };
  dash: string;
  /** How far (px, along x) each trail fades in from nothing at its origin. */
  fade: number;
}

// Each trail rises to the right (a take-off); the letter sits a little past its end, turned along the last tangent.
const DRAWINGS: Readonly<Record<'sm' | 'md' | 'lg', Drawing>> = {
  sm: {
    width: 96,
    height: 40,
    path: 'M6 34 C30 34 56 30 76 16',
    echoes: [],
    letter: { x: 83, y: 11, angle: -35, width: 15, height: 11 },
    dash: '2 3.5',
    fade: 20
  },
  md: {
    width: 180,
    height: 72,
    path: 'M10 58 Q96 58 150 23',
    echoes: [],
    letter: { x: 161, y: 16, angle: -33, width: 20, height: 14 },
    dash: '3 5',
    fade: 36
  },
  lg: {
    width: 520,
    height: 220,
    path: 'M20 200 C140 194 300 184 440 72',
    // Two faint secondary trails (brief: "2-3 faint secondary trails"): a wake that starts about 40 px either side of the flight and
    // converges on it, both ending 14 px off it at the same point of the flight, behind the letter.
    echoes: ['M80 158 C180 156 290 140 380 97', 'M200 216 C290 212 350 170 397 119'],
    letter: { x: 456, y: 60, angle: -39, width: 30, height: 21 },
    dash: '3 6',
    fade: 90
  }
};

/** Where a one-segment path ("M x y Q|C ...") starts, and the same curve walked backwards (the dashes then start at the letter: a full
 * dash meets it whatever the length, instead of the cycle landing wherever it happens to). */
function ends(d: string): { startX: number; backwards: string } {
  const numbers = (d.match(/-?[\d.]+/g) ?? []).map(Number);
  const pairs: string[] = [];
  for (let index = 0; index + 1 < numbers.length; index += 2) {
    pairs.unshift(`${numbers[index] ?? 0} ${numbers[index + 1] ?? 0}`);
  }
  const [first = '0 0', ...others] = pairs;
  return { startX: numbers[0] ?? 0, backwards: `M${first} ${d.includes('Q') ? 'Q' : 'C'}${others.join(' ')}` };
}

/** A dashed arc with a letter at its end, drawn in once on mount; aria-hidden. */
export function FlightTrail({ size = 'md', tone = 'default', className }: FlightTrailProps): React.JSX.Element {
  const drawing = DRAWINGS[size];
  // Mask ids must be unique in the page and valid in url(#...): React's id without its punctuation.
  const id = `ui-trail-${React.useId().replaceAll(/[^\w-]/g, '')}`;
  const { letter } = drawing;
  const trails = [drawing.path, ...drawing.echoes].map((d) => ({ d, ...ends(d) }));
  // The flap: a V from the top corners; shallower on the small letter so it stays a flap at 15 px.
  const depth = size === 'sm' ? -letter.height * 0.12 : letter.height * 0.08;
  const flap = `M${-letter.width / 2 + 1.5} ${-letter.height / 2 + 1.5} L0 ${depth} L${letter.width / 2 - 1.5} ${-letter.height / 2 + 1.5}`;
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      className={cx('ui-trail', className)}
      data-size={size}
      data-tone={tone}
      width={drawing.width}
      height={drawing.height}
      viewBox={`0 0 ${drawing.width} ${drawing.height}`}
      fill="none"
    >
      <defs>
        {/* Per trail: a mask whose stroke draws in once (the reveal), painted with a gradient so the trail fades in at its origin. */}
        {trails.map(({ d, startX }, index) => (
          <React.Fragment key={d}>
            <linearGradient id={`${id}-f${index}`} gradientUnits="userSpaceOnUse" x1={startX} y1="0" x2={startX + drawing.fade} y2="0">
              <stop offset="0" stopColor="currentColor" stopOpacity="0" />
              <stop offset="1" stopColor="currentColor" />
            </linearGradient>
            <mask id={`${id}-${index}`} maskUnits="userSpaceOnUse" x="0" y="0" width={drawing.width} height={drawing.height}>
              <path
                d={d}
                pathLength={1}
                stroke={`url(#${id}-f${index})`}
                className="ui-trail-reveal"
                data-echo={index === 0 ? undefined : index}
              />
            </mask>
          </React.Fragment>
        ))}
      </defs>
      {trails.slice(1).map(({ d, backwards }, index) => (
        <path key={d} d={backwards} className="ui-trail-echo" strokeDasharray={drawing.dash} mask={`url(#${id}-${index + 1})`} />
      ))}
      <path d={trails[0]?.backwards} className="ui-trail-path" strokeDasharray={drawing.dash} mask={`url(#${id}-0)`} />
      <g transform={`translate(${letter.x} ${letter.y}) rotate(${letter.angle})`}>
        <g className="ui-trail-letter">
          <rect
            x={-letter.width / 2}
            y={-letter.height / 2}
            width={letter.width}
            height={letter.height}
            rx={Math.max(2, letter.height * 0.18)}
            className="ui-trail-paper"
          />
          <path d={flap} className="ui-trail-flap" />
        </g>
      </g>
    </svg>
  );
}
