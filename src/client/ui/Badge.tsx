import type React from 'react';
import { cx } from './cx';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

interface BadgeProps {
  tone?: BadgeTone;
  className?: string;
  children: React.ReactNode;
}

/**
 * A short status or count next to a name ("Admin", "Unverified", "3"). The words carry the meaning; the colour only adds to it, so a
 * badge never has only a colour. `accent` marks the current or the new, `success`, `warning` and `danger` a real state; everything else is `neutral`.
 */
export function Badge({ tone = 'neutral', className, children }: BadgeProps): React.ReactElement {
  return (
    <span className={cx('ui-badge', className)} data-tone={tone}>
      {children}
    </span>
  );
}
