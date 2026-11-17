import React from 'react';
import { ChevronLeft, CircleAlert, CircleCheck, type LucideIcon } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { useT } from '../../lib/i18n';
import { ActionBar, Banner, Button, Card, InfoTip, TextField } from '../../ui';
import { SecretField } from '../PasswordField';
import { AuthButton, AuthSteps, ErrorLine, type AuthStep } from '../auth/authUi';
import { sixDigits } from '../auth/TwoFactorEnrolment';
import { useSettingsView } from '../settings/SettingsBar';
import { tipLines } from '../settings/SettingsPage';
import '../settings/settings.css';

// The small pieces the views of the Security section share: the status cards of the overview, a frame with a Back button and the name of
// the action, the fields for a password and a six-digit code, the closing line of a finished action and the last failure. The look is in
// settings.css (the status and view classes); the steps shown once (the recovery key, the codes, the enrolment) come from auth/ and look
// the same here as there.

export const CODE_LENGTH = 6;

/** How a status card reads at a glance: on and fine (success), something to do (warning), or a plain fact (neutral). */
export type StatusTone = 'success' | 'warning' | 'neutral';

interface StatusRowProps {
  /** Prefix of the ids: the title is `${id}-label`. */
  id: string;
  icon: LucideIcon;
  title: string;
  /** The soft tone of the icon tile: the state of the thing, never decoration. */
  tone?: StatusTone;
  /** The state in a word after the title (StatusWord: On, Off, Saved, a count). */
  status?: React.ReactNode;
  /** What it is for: an InfoTip after the title (DESIGN-v4m R1), not a line under it. */
  info?: string;
  /** At most one plain line under the title: what the person must know at a glance (why there is no Turn off, what is locked). */
  lines: readonly string[];
  /** Facts about its state (a date, a device), quieter and in tabular figures under the lines. */
  facts?: readonly string[];
  /** The action (one, two at most), at the right; under the text in a narrow card. */
  children?: React.ReactNode;
}

/** No facts (one array for every row without any, so the default prop is stable). */
const NO_FACTS: readonly string[] = [];

/** The state of a status card in one word with an icon (a check for on and saved, an alert for what needs doing), in the tone's colour. */
export const StatusWord: React.FC<{ tone: StatusTone; children: React.ReactNode }> = ({ tone, children }) => {
  const Icon = tone === 'success' ? CircleCheck : CircleAlert;
  return (
    <span className="st-state" data-tone={tone}>
      <Icon size={14} strokeWidth={2} aria-hidden="true" />
      {children}
    </span>
  );
};

/**
 * One thing of the account's security on the overview, as a status card of its own: an icon tile in a soft tone of its state, its name with
 * what it is for in an InfoTip and its state in a word, at most one line, and what can be done about it on the right.
 */
export const StatusRow: React.FC<StatusRowProps> = ({
  id,
  icon: Icon,
  title,
  tone = 'neutral',
  status,
  info,
  lines,
  facts = NO_FACTS,
  children
}) => (
  // Read in order: the title and its status, what it means, then the action; settings.css puts the action at the right of the text and
  // under it in a narrow card, so a short action never squeezes the text into a narrow column.
  <Card className="st-status-card">
    <div className="st-status-row" data-tone={tone}>
      <span className="st-status-tile" aria-hidden="true">
        <Icon size={20} strokeWidth={1.75} />
      </span>
      <div className="st-status-top">
        {/* The tip stands beside the heading, not inside it: the card's name (and the name its buttons are described by) stays its title. */}
        <div className="st-status-name ui-tip-row">
          <h4 id={`${id}-label`} className="st-status-title">
            {title}
          </h4>
          {info === undefined ? null : <InfoTip label={title}>{info}</InfoTip>}
        </div>
        {status}
      </div>
      {lines.length === 0 && facts.length === 0 ? null : (
        <div className="st-status-lines">
          {lines.map((line) => (
            <p key={line} className="st-muted">
              {line}
            </p>
          ))}
          {facts.map((fact) => (
            <p key={fact} className="st-status-fact">
              {fact}
            </p>
          ))}
        </div>
      )}
      {children === undefined ? null : <div className="st-status-actions">{children}</div>}
    </div>
  </Card>
);

/** The status cards of the Security overview, one under the other (StatusRow). */
export const StatusList: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  // The list is the container whose width puts the actions under the text in a narrow card (settings.css).
  <div className="st-status-list">{children}</div>
);

interface ViewFrameProps {
  t: ThemeTokens;
  title: string;
  /** The name in a phone's bar where the title does not fit it at 320px ("Recovery key" for "Create a new recovery key"); the title stays
      the heading (read out, and drawn on a desktop). */
  barTitle?: string;
  /** What the view does beyond its one visible line, in paragraphs: an InfoTip after the title (in the sheet's bar on a phone). */
  info?: readonly string[];
  /** null where the view brings its own way out (a Cancel under a recovery key, a Back under a result). */
  onBack: (() => void) | null;
  /** Where this view is in a flow of several (turning on two-factor sign-in: password, app, codes): "Step 2 of 3" over the title. */
  step?: AuthStep;
  children: React.ReactNode;
}

/**
 * What replaces the cards of the section while one action is open: a Back button above, where it is in its flow (Step 2 of 3), the name of
 * the action at the page-title size with its InfoTip, and the action itself. On a phone the sheet's bar shows the name, the tip and Back
 * (useSettingsView); here they stay for a desktop, and the heading for screen readers.
 */
export const ViewFrame: React.FC<ViewFrameProps> = ({ title, barTitle, info, onBack, step, children }) => {
  const tr = useT();
  useSettingsView({ title: barTitle ?? title, back: onBack, info });
  const heading = React.useRef<HTMLHeadingElement>(null);
  const first = React.useRef(title);
  React.useEffect(() => {
    if (first.current !== title) {
      first.current = title;
      heading.current?.focus();
    }
  }, [title]);
  return (
    <div className="st-view">
      {onBack === null ? null : (
        <div className="st-view-back">
          <Button variant="ghost" size="sm" leadingIcon={<ChevronLeft size={16} aria-hidden="true" />} onClick={onBack}>
            {tr('common.back')}
          </Button>
        </div>
      )}
      {step === undefined ? null : <AuthSteps current={step.current} total={step.total} />}
      <div className="st-view-heading ui-tip-row">
        <h4 ref={heading} tabIndex={-1} className="st-view-title st-focus-title">
          {title}
        </h4>
        {info === undefined ? null : <InfoTip label={title}>{tipLines(info)}</InfoTip>}
      </div>
      <div className="st-view-card">{children}</div>
    </div>
  );
};

/** What an action says when it worked, and the way back to the cards (the bottom bar of the sheet on a phone). */
export const DoneNote: React.FC<{ t: ThemeTokens; text: string; onBack: () => void }> = ({ t, text, onBack }) => {
  const tr = useT();
  return (
    <div className="st-view-form">
      <Banner tone="success">{text}</Banner>
      <ActionBar>
        <AuthButton t={t} type="button" label={tr('common.back')} onClick={onBack} />
      </ActionBar>
    </div>
  );
};

/** The last failure of an action, and how long to wait when the server asked for it (a 429). */
export const Failure: React.FC<{ t: ThemeTokens; id: string; error: string | null; wait: number }> = ({ t, id, error, wait }) => {
  const tr = useT();
  return (
    <>
      <ErrorLine t={t} id={id} text={error} />
      {error !== null && wait > 0 ? (
        <p role="status" className="st-muted">
          {tr('auth.try_again_in', { seconds: wait })}
        </p>
      ) : null}
    </>
  );
};

interface PasswordInputProps {
  t: ThemeTokens;
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete?: 'current-password' | 'new-password';
  /** The name of the Show button when the form has several password fields ('Show current password'); 'Show password' by default. */
  showLabel?: string;
  invalid?: boolean;
  describedBy?: string;
  /** What is missing, as an alert under the field (`${id}-error`). A form that uses it always passes it (null while nothing is missing), so the
   * field never moves into another box when the line appears and keeps the keyboard. */
  error?: string | null;
}

const showsError = (error: string | null | undefined): error is string => error !== undefined && error !== null;

/** The field and, for a form that passes `error`, the line under it, 6px apart like a field's own hint. */
const WithError: React.FC<{ t: ThemeTokens; id: string; error: string | null | undefined; children: React.ReactElement }> = ({
  t,
  id,
  error,
  children
}) =>
  error === undefined ? (
    children
  ) : (
    <div className="au-row">
      {children}
      <ErrorLine t={t} id={`${id}-error`} text={error} />
    </div>
  );

/** The ids that describe a field: the caller's, then its error line while it shows. */
const describedIds = (id: string, describedBy: string | undefined, error: string | null | undefined): string | undefined =>
  showsError(error) ? [describedBy, `${id}-error`].filter((ref) => ref !== undefined).join(' ') : describedBy;

/**
 * A password typed into a masked field with a Show button (SecretField, WCAG 3.3.8: what was typed or pasted can be checked); paste and
 * password managers work. It is handed to a function by the screen and never kept anywhere else.
 */
export const PasswordInput: React.FC<PasswordInputProps> = ({
  t,
  id,
  label,
  value,
  onChange,
  autoComplete = 'current-password',
  showLabel,
  invalid = false,
  describedBy,
  error
}) => (
  <WithError t={t} id={id} error={error}>
    <SecretField
      id={id}
      label={label}
      showLabel={showLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      autoComplete={autoComplete}
      aria-invalid={invalid || showsError(error)}
      aria-describedby={describedIds(id, describedBy, error)}
    />
  </WithError>
);

/** The six digits of the authenticator app (a pasted "123 456" keeps only the digits). `error` as for PasswordInput. */
export const CodeInput: React.FC<{
  t: ThemeTokens;
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  error?: string | null;
}> = ({ t, id, value, onChange, invalid = false, error }) => {
  const tr = useT();
  return (
    <WithError t={t} id={id} error={error}>
      <TextField
        id={id}
        label={tr('twofa.code_label')}
        hint={tr('twofa.code_hint')}
        mono
        className="st-code"
        value={value}
        onChange={(event) => onChange(sixDigits(event.target.value))}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={invalid || showsError(error)}
        aria-describedby={describedIds(id, undefined, error)}
      />
    </WithError>
  );
};
