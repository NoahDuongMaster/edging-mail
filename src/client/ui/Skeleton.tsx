import type React from 'react';
import { cx } from './cx';

interface SkeletonProps {
  /** A CSS length or a number of px. Default: the full width of the container. */
  width?: number | string;
  /** Default: one line of text (14 px). */
  height?: number | string;
  /** A round placeholder (an avatar). */
  circle?: boolean;
  className?: string;
}

/**
 * A grey block that stands where content will be while it loads, so the page does not jump when it arrives. It says nothing to a screen
 * reader: the region that loads says so itself (`aria-busy`, or a Spinner with its text). It rests under reduced motion.
 */
export function Skeleton({ width, height, circle = false, className }: SkeletonProps): React.ReactElement {
  return (
    <span className={cx('ui-skeleton', className)} data-circle={circle ? 'true' : undefined} style={{ width, height }} aria-hidden="true" />
  );
}
