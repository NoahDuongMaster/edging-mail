import type React from 'react';
import { cx } from './cx';
import { initialsOf } from './initials';

interface AvatarProps {
  /** The person's name or address; the letters are made from it. */
  name: string;
  /** 28, 32 or 40 px. */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * A round tile with a person's initials, in one quiet neutral for everybody (the accent is for actions, not for people). It is
 * decoration: the name is always written next to it or in the label of the control it sits in, so screen readers skip it.
 */
export function Avatar({ name, size = 'md', className }: AvatarProps): React.ReactElement {
  return (
    <span className={cx('ui-avatar', className)} data-size={size} aria-hidden="true">
      {initialsOf(name)}
    </span>
  );
}
