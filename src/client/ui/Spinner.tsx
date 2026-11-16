import type React from 'react';
import { useT } from '../lib/i18n';
import { cx } from './cx';

interface SpinnerProps {
  /** Width and height in px. */
  size?: number;
  /** True inside a control that already says it is busy (a loading Button): the spinner then says nothing itself. */
  decorative?: boolean;
  /** What is happening, when it is more than "Loading…" ("Checking…"): read by screen readers, and shown under reduced motion. */
  label?: string;
  className?: string;
}

/**
 * The wingbeat loader (v3 H8) for work in progress: three dots that rise and fall in a soft wave, like wings, in the current text colour,
 * inside a `size` x `size` box (so it takes the place of a 16 px icon in a busy Button without moving anything). On its own it announces
 * its label ("Loading…") to a screen reader; inside a busy button pass `decorative`. Under reduced motion the dots stand still
 * (signature.css) and its label is written beside it (ui.css), so what is happening is said in words rather than by movement.
 */
export function Spinner({ size = 16, decorative = false, label, className }: SpinnerProps): React.ReactElement {
  const tr = useT();
  const box = { '--ui-wing-size': `${size}px` } as React.CSSProperties;
  return (
    <span className={cx('ui-spinner', className)} role={decorative ? undefined : 'status'}>
      <span className="ui-wing" aria-hidden="true" style={box}>
        <span className="ui-wing-dot" />
        <span className="ui-wing-dot" />
        <span className="ui-wing-dot" />
      </span>
      {decorative ? null : <span className="ui-spinner-label">{label ?? tr('common.loading')}</span>}
    </span>
  );
}
