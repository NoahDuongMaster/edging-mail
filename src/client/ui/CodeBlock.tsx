import type React from 'react';
import { cx } from './cx';

interface CodeBlockProps {
  /** The commands, one per line, exactly as they are typed. */
  children: string;
  className?: string;
}

/**
 * Shell commands or a snippet of configuration to copy into a terminal or a file: mono on a raised fill, never translated, never wrapped
 * (a long line scrolls sideways inside the block, not the page). A name inside a sentence is a `<code>` in the text instead.
 */
export function CodeBlock({ children, className }: CodeBlockProps): React.ReactElement {
  return (
    <pre translate="no" className={cx('ui-code', className)}>
      {children}
    </pre>
  );
}
