import type React from 'react';
import { cx } from './cx';

interface CodeBlockProps {
  /** The commands, one per line, exactly as they are typed. */
  children: string;
  className?: string;
}

/**
 * Makes a block that scrolls sideways reachable with the keyboard (WCAG 2.1.1, axe scrollable-region-focusable): while a line is wider
 * than the block it is a tab stop (the arrow keys then scroll it), and it leaves the tab order again once everything fits. Set on the
 * element itself, so the server render (no layout) stays the plain block.
 */
function keyboardScroll(el: HTMLPreElement | null): (() => void) | undefined {
  if (!el || typeof ResizeObserver === 'undefined') {
    return undefined;
  }
  const update = () => {
    if (el.scrollWidth > el.clientWidth + 1) {
      el.setAttribute('tabindex', '0');
    } else {
      el.removeAttribute('tabindex');
    }
  };
  update();
  const sizes = new ResizeObserver(update);
  sizes.observe(el);
  return () => sizes.disconnect();
}

/**
 * Shell commands or a snippet of configuration to copy into a terminal or a file: mono on a raised fill, never translated, never wrapped
 * (a long line scrolls sideways inside the block, not the page). A name inside a sentence is a `<code>` in the text instead.
 */
export function CodeBlock({ children, className }: CodeBlockProps): React.ReactElement {
  return (
    <pre ref={keyboardScroll} translate="no" className={cx('ui-code', className)}>
      {children}
    </pre>
  );
}
