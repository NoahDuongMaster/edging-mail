import React from 'react';
import { cx } from './cx';
import { useOverflows } from './media';

export interface TableProps extends React.ComponentProps<'table'> {
  /** What the table lists ("People"). It names the scrolling area for screen readers. */
  label: string;
  /** Tighter rows (32 px) for admin tables on a desktop. Rows stay 44 px on touch. */
  dense?: boolean;
  /** The header row stays at the top while the rows scroll (it needs `maxHeight`, or a parent that sets a height). Default: true. */
  stickyHeader?: boolean;
  /** Makes the table scroll inside this height (px or any CSS length). */
  maxHeight?: number | string;
}

/**
 * A real `<table>` in the app's style: hairline rows, a quiet header that sticks, a hover on rows, and a scroll area that takes the
 * keyboard while it scrolls (so a wide table can be read without a mouse, and a table that fits is no empty Tab stop). Write the usual
 * markup inside: `<thead><tr><th scope="col">`, `<tbody>`, `<td>`. Numbers go in `<td className="ui-num">` (right-aligned, tabular). Use it
 * for data that has columns, never for layout.
 */
export function Table({
  label,
  dense = false,
  stickyHeader = true,
  maxHeight,
  className,
  children,
  ...table
}: TableProps): React.ReactElement {
  const wrapRef = React.useRef<HTMLDivElement | null>(null);
  const scrolls = useOverflows(wrapRef);
  return (
    <div
      ref={wrapRef}
      className="ui-table-wrap"
      role="region"
      aria-label={label}
      // A scroll area must be reachable by keyboard (WCAG 2.1.1), so it takes focus although a region is not a control: only while it
      // scrolls (useOverflows), else it would be a Tab stop that does nothing.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region
      tabIndex={scrolls ? 0 : undefined}
      style={maxHeight === undefined ? undefined : { maxHeight }}
    >
      <table
        className={cx('ui-table', className)}
        data-dense={dense ? 'true' : undefined}
        data-sticky={stickyHeader ? 'true' : undefined}
        {...table}
      >
        {children}
      </table>
    </div>
  );
}
