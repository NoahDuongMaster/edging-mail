import type React from 'react';
import { cx } from './cx';
import { has } from './Field';

interface StepsProps {
  /** The `Step`s, in order. */
  children: React.ReactNode;
  className?: string;
}

/**
 * Things to do one after the other (deploy the app, set up a domain, fix a deployment): an ordered list whose numbers stand in small
 * circles in front of each step. Each step is a `Step`. For a list whose order does not matter, use a plain list.
 */
export function Steps({ children, className }: StepsProps): React.ReactElement {
  return (
    <ol role="list" className={cx('ui-steps', className)}>
      {children}
    </ol>
  );
}

interface StepProps {
  /** A short heading for a step that has more than a sentence under it (a command and a note). */
  title?: string;
  /** The level of that heading in the page's outline. */
  headingLevel?: 3 | 4;
  /** One sentence, or for a step with a title the blocks under it. */
  children?: React.ReactNode;
}

/** One step of `Steps`: one sentence, or a title with the blocks under it (a CodeBlock, a note). */
export function Step({ title, headingLevel = 3, children }: StepProps): React.ReactElement {
  if (!has(title)) {
    return <li className="ui-step">{children}</li>;
  }
  const Heading = `h${headingLevel}` as const;
  return (
    <li className="ui-step">
      <Heading className="ui-step-title">{title}</Heading>
      {children === undefined ? null : <div className="ui-step-body">{children}</div>}
    </li>
  );
}
