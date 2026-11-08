import React from 'react';
import { cx } from './cx';

export interface SecretBoxProps {
  /** What the secret is ("Recovery key", "Temporary password"): the name of the box for screen readers. */
  label: string;
  /** The secret: one value (a password), or its parts (the groups of a key, a list of codes). */
  value: string | readonly string[];
  /** How parts are laid out: `grid` (a cell each, default) or `inline` (one line that breaks only between parts, like an app's manual key). */
  layout?: 'grid' | 'inline';
  /** The number of grid columns. Default: as many columns of 150 px as fit. */
  columns?: number;
  /** A small caption over each part of a grid ("Group 3"), from its index (0 for the first). */
  partLabel?: (index: number) => string;
  /** The element that holds the text of a single value or an inline secret, so a screen can select it when copying fails. */
  valueRef?: React.Ref<HTMLElement>;
  /** Buttons inside the box, under the secret (Copy). */
  children?: React.ReactNode;
  className?: string;
  'data-testid'?: string;
}

/**
 * A secret the person must copy or write down, shown once: mono on a raised fill, never translated, a click selects a whole part. The
 * hold-open and focus rules of the screen that shows it stay with that screen. Keys and codes the person types go in a TextField (`mono`).
 */
export function SecretBox({
  label,
  value,
  layout = 'grid',
  columns,
  partLabel,
  valueRef,
  children,
  className,
  'data-testid': testId
}: SecretBoxProps): React.ReactElement {
  let secret: React.ReactNode;
  if (typeof value === 'string') {
    secret = (
      <code ref={valueRef} translate="no" className="ui-secret-value">
        {value}
      </code>
    );
  } else if (layout === 'inline') {
    // The parts are numbered by their place (two parts can be equal, and the order never changes).
    secret = (
      <code ref={valueRef} translate="no" className="ui-secret-value">
        {value.map((part, index) => (
          <React.Fragment key={`${index + 1}`}>
            {index === 0 ? null : ' '}
            <span className="ui-secret-nowrap">{part}</span>
          </React.Fragment>
        ))}
      </code>
    );
  } else {
    secret = (
      <ol
        role="list"
        translate="no"
        className="ui-secret-grid"
        style={columns === undefined ? undefined : { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
      >
        {value.map((part, index) => (
          <li key={`${index + 1}`} className="ui-secret-part">
            {partLabel === undefined ? null : <span className="ui-secret-caption">{partLabel(index)}</span>}
            <span className="ui-secret-value">{part}</span>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <div role="group" aria-label={label} className={cx('ui-secret', className)} data-testid={testId}>
      {secret}
      {children === undefined ? null : <div className="ui-secret-actions">{children}</div>}
    </div>
  );
}
