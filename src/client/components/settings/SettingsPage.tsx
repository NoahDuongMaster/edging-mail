import React from 'react';
import { HiddenHint, InfoTip, Section, type HintMode } from '../../ui';
import './settings.css';

/** A line of a tip: plain words, or the name of a choice and what it does ('Reduce motion: nothing slides...'). */
export type TipLine = string | { term: string; text: string };

/**
 * The words of a tip of several lines, each a block of its own (settings.css `.st-tip-line`). Returned as nodes, not as a component, so the
 * InfoTip reads them for its announcement (nodeText); a space between the lines keeps the sentences apart there.
 */
export function tipLines(lines: readonly TipLine[]): React.ReactNode[] {
  return lines.flatMap((line, index) => [
    index === 0 ? null : ' ',
    typeof line === 'string' ? (
      <span key={line} className="st-tip-line">
        {line}
      </span>
    ) : (
      <span key={line.term} className="st-tip-line">
        <strong>{line.term}</strong> {line.text}
      </span>
    )
  ]);
}

interface SettingsPageProps {
  title: string;
  /** What the section is for: in an InfoTip after the title (DESIGN-v4m R1: no line of helper text under it). */
  description: string;
  /** The id of the title (the section is named by it); made up when left out. */
  titleId?: string;
  /** The title, for a section that moves the focus to it itself (Security, when a view opens or closes). */
  titleRef?: React.Ref<HTMLHeadingElement>;
  children: React.ReactNode;
}

/**
 * One section of Settings on the right of the nav: its title (an h3 under the dialog's h2, drawn at the page-title size) with what the
 * section is for in an InfoTip after it, then its groups of rows. The title can take the focus from script (tabIndex -1): on a phone it does
 * when the section opens from the list. A phone draws the title and the tip in the sheet's bar instead (SettingsBar); the heading stays for
 * screen readers.
 */
export function SettingsPage({ title, description, titleId, titleRef, children }: SettingsPageProps): React.ReactElement {
  const generated = React.useId();
  const id = titleId ?? generated;
  return (
    <section aria-labelledby={id} className="st-page">
      <header className="st-page-head ui-tip-row">
        <h3 id={id} ref={titleRef} tabIndex={-1} className="st-page-title st-focus-title">
          {title}
        </h3>
        <InfoTip label={title}>{description}</InfoTip>
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
  /** A longer explanation of the group, in an InfoTip after its title (DESIGN-v4m R1), instead of more lines under it. */
  info?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * One grouped card of rows (ui Section `grouped`): each direct child is a row, the label and its hint on the left and the control on the
 * right (settings.css lays the ui fields out that way), separated from the next by a hairline that starts at the text.
 */
export function SettingsGroup({ title, description, headingLevel = 4, info, children }: SettingsGroupProps): React.ReactElement {
  return (
    <Section grouped className="st-group" title={title} description={description} headingLevel={headingLevel} info={info}>
      {children}
    </Section>
  );
}

interface SettingRowProps {
  /** What the row is about, in the row's label type; a row that only explains its control has none. */
  label?: string;
  /** What the control does, or why it is not available yet: an InfoTip after the label (default), or a quiet line under it. */
  hint?: string;
  /** The id of the hint, for a control that names it with aria-describedby (kept in the page in both modes). */
  hintId?: string;
  /**
   * `tip` (default): the hint in an InfoTip after the label, its words kept for screen readers; `inline`: a visible line, for a state the
   * person must see (why a button is not available). A row without a label always shows its hint inline (there is nothing to put a tip on).
   */
  hintMode?: HintMode;
  /** The control on the right (a button); under the text on a narrow card. */
  children?: React.ReactNode;
}

/** A row of a group that is not a field: its words on the left, its control on the right. */
export function SettingRow({ label, hint, hintId, hintMode = 'tip', children }: SettingRowProps): React.ReactElement {
  const tip = label !== undefined && hint !== undefined && hintMode === 'tip';
  return (
    <div className="st-row">
      {label === undefined && hint === undefined ? null : (
        <div className="st-row-text">
          {label === undefined ? null : tip ? (
            <span className="st-row-label ui-tip-row">
              <span>{label}</span>
              <InfoTip label={label}>{hint}</InfoTip>
            </span>
          ) : (
            <span className="st-row-label">{label}</span>
          )}
          {hint === undefined ? null : tip ? (
            <HiddenHint id={hintId} text={hint} />
          ) : (
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
