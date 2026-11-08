import type React from 'react';
import { cx } from './cx';

interface DividerProps {
  /** `vertical` is a hairline between buttons of one toolbar; the default separates blocks of content. */
  orientation?: 'horizontal' | 'vertical';
  className?: string;
}

/** A hairline that separates two groups. Prefer space; use a Divider only where the groups would otherwise run together. */
export function Divider({ orientation = 'horizontal', className }: DividerProps): React.ReactElement {
  return orientation === 'horizontal' ? (
    <hr className={cx('ui-divider', className)} />
  ) : (
    <span role="separator" aria-orientation="vertical" className={cx('ui-divider', className)} data-orientation="vertical" />
  );
}
