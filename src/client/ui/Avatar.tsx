import type React from 'react';
import { cx } from './cx';
import { initialsOf, isCjk } from './initials';

interface AvatarProps {
  /** The person's name or address; the letters are made from it. */
  name: string;
  /** 28, 32 or 40 px. */
  size?: 'sm' | 'md' | 'lg';
  /** The person of the open (selected) row: the tile takes the accent tint instead of the neutral fill. */
  selected?: boolean;
  className?: string;
}

/**
 * A round tile with a person's initials, in one quiet neutral for everybody (the accent is for actions, not for people); the sender of the
 * open message takes the accent tint (`selected`). It is decoration: the name is always written next to it or in the label of the control
 * it sits in, so screen readers skip it. A CJK name shows one character, a size larger (`data-script="cjk"`; ui/initials.ts).
 */
export function Avatar({ name, size = 'md', selected = false, className }: AvatarProps): React.ReactElement {
  const initials = initialsOf(name);
  return (
    <span
      className={cx('ui-avatar', className)}
      data-size={size}
      data-selected={selected ? 'true' : undefined}
      data-script={isCjk(initials) ? 'cjk' : undefined}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}
