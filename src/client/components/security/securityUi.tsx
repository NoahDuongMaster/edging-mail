import React from 'react';
import { ChevronLeft, type LucideIcon } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { useT } from '../../lib/i18n';
import { Banner, Button, Card, TextField } from '../../ui';
import { SecretField } from '../PasswordField';
import { AuthButton, AuthSteps, ErrorLine, type AuthStep } from '../auth/authUi';
import { sixDigits } from '../auth/TwoFactorEnrolment';
import '../settings/settings.css';

// The small pieces the views of the Security section share: the status card of the overview, a frame with a Back button and the name of
// the action, the fields for a password and a six-digit code, the closing line of a finished action and the last failure. The look is in
// settings.css (`st-status*`, `st-view*`); the steps shown once (the recovery key, the codes, the enrolment) come from auth/ and look the
// same here as there.

export const CODE_LENGTH = 6;

interface StatusRowProps {
  /** Prefix of the ids: the title is `${id}-label`. */
  id: string;
  icon: LucideIcon;
  title: string;
  /** A Badge after the title: the state in a word (On, Off, Saved, a count). */
  status?: React.ReactNode;
  /** Plain lines under the title (each one different): what it is for. */
  lines: readonly string[];
  /** Facts about its state (a date, a device), quieter and in tabular figures under the lines. */
  facts?: readonly string[];
  /** The action (one, two at most), at the right; under the text in a narrow card. */
  children?: React.ReactNode;
}

/** No facts (one array for every row without any, so the default prop is stable). */
const NO_FACTS: readonly string[] = [];

/**
 * One thing of the account's security on the overview: a row of the one Security card (StatusList), divided from the next by a hairline:
 * a small bare icon, its name and state, a line or two, and what can be done about it on the right.
 */
export const StatusRow: React.FC<StatusRowProps> = ({ id, icon: Icon, title, status, lines, facts = NO_FACTS, children }) => (
  // Read in order: the title and its status, what it means, then the action; settings.css puts the action at the right of the text and
  // under it in a narrow card, so a short action never squeezes the text into a narrow column.
  <div className="st-status-row">
    <Icon size={16} strokeWidth={1.75} aria-hidden="true" className="st-status-icon" />
    <div className="st-status-top">
      <h4 id={`${id}-label`} className="st-status-title">
        {title}
      </h4>
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
);

/** The one card of the Security overview: its rows (StatusRow) under each other, hairlines between (J3-09: no card per row). */
export const StatusList: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  // .st-cards is the container whose width puts the actions under the text in a narrow card (settings.css).
  <div className="st-cards">
    <Card padding="none" className="st-status-list">
      {children}
    </Card>
  </div>
);

interface ViewFrameProps {
  t: ThemeTokens;
  title: string;
  /** null where the view brings its own way out (a Cancel under a recovery key, a Back under a result). */
  onBack: (() => void) | null;
  /** Where this view is in a flow of several (turning on two-factor sign-in: password, app, codes): "Step 2 of 3" over the title. */
  step?: AuthStep;
  children: React.ReactNode;
}

/** What replaces the cards of the section while one action is open: a Back button above, the name of the action, and the action itself. */
export const ViewFrame: React.FC<ViewFrameProps> = ({ title, onBack, step, children }) => {
  const tr = useT();
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
      <h4 ref={heading} tabIndex={-1} className="st-view-title st-focus-title">
        {title}
      </h4>
      {children}
    </div>
  );
};

/** What an action says when it worked, and the way back to the cards. */
export const DoneNote: React.FC<{ t: ThemeTokens; text: string; onBack: () => void }> = ({ t, text, onBack }) => {
  const tr = useT();
  return (
    <div className="st-view-form">
      <Banner tone="success">{text}</Banner>
      <div>
        <AuthButton t={t} type="button" label={tr('common.back')} onClick={onBack} />
      </div>
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
