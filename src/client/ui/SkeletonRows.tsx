import type React from 'react';
import { cx } from './cx';
import { Skeleton } from './Skeleton';
import { VisuallyHidden } from './VisuallyHidden';

/** Widths of the bars of each placeholder row (up to three lines, or columns), so the rows do not all look the same. */
const ROWS = [
  { id: 'a', widths: ['34%', '78%', '62%'] },
  { id: 'b', widths: ['42%', '66%', '74%'] },
  { id: 'c', widths: ['28%', '84%', '55%'] },
  { id: 'd', widths: ['38%', '72%', '68%'] },
  { id: 'e', widths: ['46%', '60%', '80%'] },
  { id: 'f', widths: ['32%', '76%', '58%'] }
] as const;

/** The widths of the columns of a table's placeholder row: a wide first column, narrower ones after it. */
const COLUMNS = ['34%', '16%', '22%', '12%'] as const;

/** The placeholder rows to draw: `count` of them, at least 1 and at most the 6 there are. */
export function skeletonRows(count: number): (typeof ROWS)[number][] {
  return ROWS.slice(0, Math.min(Math.max(Math.trunc(count), 1), ROWS.length));
}

interface ListSkeletonProps {
  /** What is loading ("Loading mail…"): said to screen readers, the rows are not. */
  label: string;
  /** How many rows (1 to 6). Default: 6. */
  rows?: number;
  /** Lines per row: 1 for a one-line list, 3 for a mail (sender, subject, a shorter preview). Default: 2. */
  lines?: 1 | 2 | 3;
  className?: string;
}

/**
 * Grey rows where a hairline list will be while it loads, so the pane is never blank and does not jump when the rows arrive. The region
 * says it is busy and names what loads; the bars are hidden from screen readers. They rest under reduced motion (Skeleton).
 */
export function ListSkeleton({ label, rows = 6, lines = 2, className }: ListSkeletonProps): React.ReactElement {
  return (
    <div role="status" aria-busy="true" className={className}>
      <VisuallyHidden>{label}</VisuallyHidden>
      {skeletonRows(rows).map((row) => (
        <div key={row.id} className="ui-skel-row" aria-hidden="true">
          {row.widths.slice(0, lines).map((width, line) => (
            <Skeleton key={width} width={width} height={line === 2 ? 12 : undefined} />
          ))}
        </div>
      ))}
    </div>
  );
}

interface TableSkeletonProps {
  /** What is loading ("Loading people…"): said to screen readers, the rows are not. */
  label: string;
  /** How many rows (1 to 6). Default: 4. */
  rows?: number;
  /** Bars per row, side by side like the columns of the table (1 to 4). Default: 2. */
  columns?: number;
  className?: string;
}

/** Grey rows where a Table will be while it loads, in the table's frame. Like ListSkeleton, it names what loads and hides its bars. */
export function TableSkeleton({ label, rows = 4, columns = 2, className }: TableSkeletonProps): React.ReactElement {
  const widths = COLUMNS.slice(0, Math.min(Math.max(Math.trunc(columns), 1), COLUMNS.length));
  return (
    <div role="status" aria-busy="true" className={cx('ui-skel-table', className)}>
      <VisuallyHidden>{label}</VisuallyHidden>
      {skeletonRows(rows).map((row) => (
        <div key={row.id} className="ui-skel-row" aria-hidden="true">
          {widths.map((width) => (
            <Skeleton key={width} width={width} />
          ))}
        </div>
      ))}
    </div>
  );
}
