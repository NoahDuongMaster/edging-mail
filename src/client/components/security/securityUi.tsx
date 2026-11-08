import React from 'react';
import { ChevronLeft } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { useT } from '../../lib/i18n';
import { Banner, Button, TextField } from '../../ui';
import { AuthButton, ErrorLine } from '../auth/authUi';
import { sixDigits } from '../auth/TwoFactorEnrolment';
import '../settings/settings.css';

// The small pieces the views of the Security section share: a frame with a Back button and the name of the action, the fields for a
// password and a six-digit code (ui/TextField), the closing line of a finished action and the last failure. The look is in settings.css
// (`st-view*`); the steps shown once (the recovery key, the codes, the enrolment) come from auth/ and look the same here as there.

export const CODE_LENGTH = 6;

interface ViewFrameProps {
  t: ThemeTokens;
  title: string;
  /** null where the view brings its own way out (a Cancel under a recovery key, a Back under a result). */
  onBack: (() => void) | null;
  children: React.ReactNode;
}

/** What replaces the rows of the section while one action is open: a Back button, the name of the action, and the action itself. */
export const ViewFrame: React.FC<ViewFrameProps> = ({ title, onBack, children }) => {
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
      <div className="st-view-head">
        {onBack === null ? null : (
          <Button variant="ghost" size="md" leadingIcon={<ChevronLeft size={16} aria-hidden="true" />} onClick={onBack}>
            {tr('common.back')}
          </Button>
        )}
        <h4 ref={heading} tabIndex={-1} className="st-view-title st-focus-title">
          {title}
        </h4>
      </div>
      {children}
    </div>
  );
};

/** What an action says when it worked, and the way back to the rows. */
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

/** A password typed into a plain field: it is handed to a function by the screen and never kept anywhere else. */
export const PasswordInput: React.FC<PasswordInputProps> = ({
  t,
  id,
  label,
  value,
  onChange,
  autoComplete = 'current-password',
  invalid = false,
  describedBy,
  error
}) => (
  <WithError t={t} id={id} error={error}>
    <TextField
      id={id}
      label={label}
      type="password"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      autoComplete={autoComplete}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
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
