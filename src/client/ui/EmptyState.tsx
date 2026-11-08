import type React from 'react';
import { cx } from './cx';
import { has } from './Field';

interface EmptyStateProps {
  title: string;
  description?: string;
  /** At most one button or link: what to do next. */
  action?: React.ReactNode;
  /** Shows a small Edgar (112 px) above the text. For a screen that is empty or has failed as a whole, not for an empty table inside a page. */
  illustration?: boolean;
  className?: string;
}

/**
 * What a place shows when there is nothing in it, or it cannot be shown: one sentence of what is going on, one line of why or what next,
 * at most one action. Centred in the room it has. Edgar is optional and small.
 */
export function EmptyState({ title, description, action, illustration = false, className }: EmptyStateProps): React.ReactElement {
  return (
    <div className={cx('ui-empty', className)}>
      {illustration ? <img src="/edgar.svg" alt="" width={112} height={109} className="ui-empty-art" /> : null}
      <h2 className="ui-empty-title">{title}</h2>
      {has(description) ? <p className="ui-empty-description">{description}</p> : null}
      {action === undefined ? null : <div className="ui-empty-action">{action}</div>}
    </div>
  );
}
