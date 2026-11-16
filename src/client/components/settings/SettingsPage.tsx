import React from 'react';
import { Section } from '../../ui';
import './settings.css';

interface SettingsPageProps {
  title: string;
  /** One line under the title: what the section is for. */
  description: string;
  /** The id of the title (the section is named by it); made up when left out. */
  titleId?: string;
  /** The title, for a section that moves the focus to it itself (Security, when a view opens or closes). */
  titleRef?: React.Ref<HTMLHeadingElement>;
  children: React.ReactNode;
}

/**
 * One section of Settings on the right of the nav: its title (an h3 under the dialog's h2, drawn at the page-title size), one line that
 * says what it is for, then its groups of rows. The title can take the focus from script (tabIndex -1): on a phone it does when the section
 * opens from the list.
 */
export function SettingsPage({ title, description, titleId, titleRef, children }: SettingsPageProps): React.ReactElement {
  const generated = React.useId();
  const id = titleId ?? generated;
  return (
    <section aria-labelledby={id} className="st-page">
      <header className="st-page-head">
        <h3 id={id} ref={titleRef} tabIndex={-1} className="st-page-title st-focus-title">
          {title}
        </h3>
        <p className="st-page-desc">{description}</p>
      </header>
      {children}
    </section>
  );
}

interface SettingsGroupProps {
  /** A quiet title over the card ('Motion'); a group whose page title already says it has none. */
  title?: string;
  description?: string;
  /** The level of the title in the outline: 4 under a page of Settings (its title is an h3). */
  headingLevel?: 2 | 3 | 4;
  children: React.ReactNode;
}

/**
 * One grouped card of rows (ui Section `grouped`): each direct child is a row, the label and its hint on the left and the control on the
 * right (settings.css lays the ui fields out that way), separated from the next by a hairline that starts at the text.
 */
export function SettingsGroup({ title, description, headingLevel = 4, children }: SettingsGroupProps): React.ReactElement {
  return (
    <Section grouped className="st-group" title={title} description={description} headingLevel={headingLevel}>
      {children}
    </Section>
  );
}

interface SettingRowProps {
  /** What the row is about, in the row's label type; a row that only explains its control has none. */
  label?: string;
  /** One quiet line under the label (or alone): what the control does, or why it is not available yet. */
  hint?: string;
  /** The id of the hint, for a control that names it with aria-describedby. */
  hintId?: string;
  /** The control on the right (a button); under the text on a narrow card. */
  children?: React.ReactNode;
}

/** A row of a group that is not a field: its words on the left, its control on the right. */
export function SettingRow({ label, hint, hintId, children }: SettingRowProps): React.ReactElement {
  return (
    <div className="st-row">
      {label === undefined && hint === undefined ? null : (
        <div className="st-row-text">
          {label === undefined ? null : <span className="st-row-label">{label}</span>}
          {hint === undefined ? null : (
            <span id={hintId} className="st-row-hint">
              {hint}
            </span>
          )}
        </div>
      )}
      {children === undefined ? null : <div className="st-row-control">{children}</div>}
    </div>
  );
}
