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
 * A turning arc for work in progress. On its own it announces its label ("Loading…") to a screen reader; inside a busy button pass
 * `decorative`. Under reduced motion it stands still (`nm-spin`, see index.css) and its label is written beside it, so what is happening
 * is said in words rather than by movement.
 */
export function Spinner({ size = 16, decorative = false, label, className }: SpinnerProps): React.ReactElement {
  const tr = useT();
  return (
    <span className={cx('ui-spinner', className)} role={decorative ? undefined : 'status'}>
      <svg className="nm-spin" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
      {decorative ? null : <span className="ui-spinner-label">{label ?? tr('common.loading')}</span>}
    </span>
  );
}
