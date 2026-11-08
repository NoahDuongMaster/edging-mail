import React from 'react';
import { cx } from './cx';
import { has } from './Field';

interface SectionHeaderProps {
  title?: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  /** The level of the title in the page's outline. */
  headingLevel?: 2 | 3 | 4;
  titleId: string;
}

/** The title, the description and the actions of a Section or a Card. */
function SectionHeader({ title, description, actions, headingLevel = 2, titleId }: SectionHeaderProps) {
  if (!has(title) && actions === undefined) {
    return null;
  }
  const Heading = `h${headingLevel}` as const;
  return (
    <div className="ui-section-head">
      <div className="ui-section-heading">
        {has(title) ? (
          <Heading id={titleId} className="ui-section-title">
            {title}
          </Heading>
        ) : null}
        {description === undefined ? null : <p className="ui-section-description">{description}</p>}
      </div>
      {actions === undefined ? null : <div className="ui-section-actions">{actions}</div>}
    </div>
  );
}

interface SectionProps extends Omit<SectionHeaderProps, 'titleId'> {
  className?: string;
  children?: React.ReactNode;
}

/**
 * A part of a page with a title, an optional description and optional actions on the right (Settings, a form). It has no box: the space
 * and a hairline between sections do the separating. For a bordered surface use Card.
 */
export function Section({ className, children, ...header }: SectionProps): React.ReactElement {
  const titleId = React.useId();
  return (
    <section className={cx('ui-section', className)} aria-labelledby={has(header.title) ? titleId : undefined}>
      <SectionHeader titleId={titleId} {...header} />
      {children}
    </section>
  );
}

interface CardProps extends SectionProps {
  /** `none` when the content is a table or a list that runs to the edges. */
  padding?: 'md' | 'none';
}

/** A bordered surface (hairline, 8 px corners) for one self-contained thing: an account, a domain, a form. Do not put a Card in a Card. */
export function Card({ className, padding = 'md', children, ...header }: CardProps): React.ReactElement {
  const titleId = React.useId();
  return (
    <section className={cx('ui-card', className)} data-padding={padding} aria-labelledby={has(header.title) ? titleId : undefined}>
      <SectionHeader titleId={titleId} {...header} />
      {children}
    </section>
  );
}
