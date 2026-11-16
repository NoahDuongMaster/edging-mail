import React from 'react';
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
 * One section of Settings on the right of the nav: its title (an h3 under the dialog's h2), one line that says what it is for, then its
 * cards. The title can take the focus from script (tabIndex -1): on a phone it does when the section opens from the list.
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
