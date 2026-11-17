import React from 'react';
import { cx } from './cx';
import { has } from './Field';
import { InfoTip } from './InfoTip';

interface SectionHeaderProps {
  title?: string;
  /** At most one visible line under the title (DESIGN-v4m R1); a longer explanation goes into `info`. */
  description?: React.ReactNode;
  /** An explanation behind an InfoTip right after the title (it needs a title). */
  info?: React.ReactNode;
  actions?: React.ReactNode;
  /** The level of the title in the page's outline. */
  headingLevel?: 2 | 3 | 4;
  titleId: string;
}

/** The title, the description and the actions of a Section or a Card. */
function SectionHeader({ title, description, info, actions, headingLevel = 2, titleId }: SectionHeaderProps) {
  if (!has(title) && actions === undefined) {
    return null;
  }
  const Heading = `h${headingLevel}` as const;
  const heading = has(title) ? (
    <Heading id={titleId} className="ui-section-title">
      {title}
    </Heading>
  ) : null;
  return (
    <div className="ui-section-head">
      <div className="ui-section-heading">
        {/* The tip stands beside the heading, not inside it: the heading's name stays its title. */}
        {has(title) && info !== undefined ? (
          <div className="ui-tip-row">
            {heading}
            <InfoTip label={title}>{info}</InfoTip>
          </div>
        ) : (
          heading
        )}
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
 * A part of a page with a title, an optional description and optional actions on the right (Settings, a form). It has no box: space sets
 * sections apart. With `grouped` its rows sit in one card (the iOS-like settings group): each direct child is a row, separated from the
 * next by a hairline that starts at the text. For a single bordered surface use Card.
 */
export function Section({ className, children, grouped = false, ...header }: SectionProps & { grouped?: boolean }): React.ReactElement {
  const titleId = React.useId();
  return (
    <section className={cx('ui-section', className)} aria-labelledby={has(header.title) ? titleId : undefined}>
      <SectionHeader titleId={titleId} {...header} />
      {grouped ? <div className="ui-group">{children}</div> : children}
    </section>
  );
}

interface CardProps extends SectionProps {
  /** `none` when the content is a table or a list that runs to the edges. */
  padding?: 'md' | 'none';
  /**
   * The whole card is one link or button (a domain card that opens its page): it lifts 1 px with a deeper shadow on hover. Put the link or
   * button inside; never on a card that only holds controls, and never on message rows.
   */
  interactive?: boolean;
}

/**
 * A floating surface (the v3 sheet material: the surface, 14 px corners and the sheet shadow, no hairline) for one self-contained thing:
 * an account, a domain, a form, a security status. Do not put a Card in a Card.
 */
export function Card({ className, padding = 'md', interactive = false, children, ...header }: CardProps): React.ReactElement {
  const titleId = React.useId();
  return (
    <section
      className={cx('ui-card', className)}
      data-padding={padding}
      data-interactive={interactive ? 'true' : undefined}
      aria-labelledby={has(header.title) ? titleId : undefined}
    >
      <SectionHeader titleId={titleId} {...header} />
      {children}
    </section>
  );
}
