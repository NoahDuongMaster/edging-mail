import type React from 'react';
import { cx } from './cx';

/** A key on the keyboard, in a keycap ("C", "Esc"). The key is the same in every language, so it is the one text that is not translated. */
export function Kbd({ className, children }: { className?: string; children: React.ReactNode }): React.ReactElement {
  return <kbd className={cx('ui-kbd', className)}>{children}</kbd>;
}
