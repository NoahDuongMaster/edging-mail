import React from 'react';
import type { ThemeTokens } from '../../theme';
import { useT } from '../../lib/i18n';
import { AuthButton, ErrorLine, Field, inputStyle } from '../auth/authUi';
import { sixDigits } from '../auth/TwoFactorEnrolment';

// The small pieces the three views of the Security card share: the card look of Settings (the same padding, border and colours as its other
// sections), a frame with a Back button, the fields for a password and a six-digit code, and the closing line of a finished action.

export const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
export const CODE_LENGTH = 6;

export const cardStyle = (t: ThemeTokens): React.CSSProperties => ({
  padding: 12,
  borderRadius: 12,
  border: `1px solid ${t.border}`,
  background: t.raised,
  display: 'flex',
  flexDirection: 'column',
  gap: 4
});

export const mutedStyle = (t: ThemeTokens): React.CSSProperties => ({ margin: 0, color: t.text2, fontSize: 12.5, lineHeight: '19px' });

export const leadStyle = (t: ThemeTokens): React.CSSProperties => ({ margin: 0, color: t.text, fontSize: 13.5, lineHeight: '20px' });

/** A 16 px, 44 px high input that stands out from the raised card it sits in. */
export const controlStyle = (t: ThemeTokens): React.CSSProperties => ({ ...inputStyle(t), background: t.surface });

export const formStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 12, position: 'relative' };

interface ViewFrameProps {
  t: ThemeTokens;
  title: string;
  /** null where the view brings its own way out (a Cancel under a recovery key, a Back under a result). */
  onBack: (() => void) | null;
  children: React.ReactNode;
}

/** What replaces the rows of the card while one action is open: a Back button, the name of the action, and the action itself. */
export const ViewFrame: React.FC<ViewFrameProps> = ({ t, title, onBack, children }) => {
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, paddingTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        {onBack === null ? null : <AuthButton t={t} type="button" quiet label={tr('common.back')} onClick={onBack} />}
        <h4 ref={heading} tabIndex={-1} style={{ margin: 0, fontSize: 14, fontWeight: 600, outline: 'none' }}>
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <p role="status" style={{ margin: 0, fontSize: 14, lineHeight: '20px', color: t.dark ? '#4ADE80' : '#15803D' }}>
        {text}
      </p>
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
        <p role="status" style={mutedStyle(t)}>
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
}

/** A password typed into a plain input: it is handed to a function by the screen and never kept anywhere else. */
export const PasswordInput: React.FC<PasswordInputProps> = ({
  t,
  id,
  label,
  value,
  onChange,
  autoComplete = 'current-password',
  invalid = false,
  describedBy
}) => (
  <Field t={t} id={id} label={label}>
    <input
      id={id}
      type="password"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      autoComplete={autoComplete}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      style={controlStyle(t)}
    />
  </Field>
);

/** The six digits of the authenticator app (a pasted "123 456" keeps only the digits). */
export const CodeInput: React.FC<{ t: ThemeTokens; id: string; value: string; onChange: (value: string) => void; invalid?: boolean }> = ({
  t,
  id,
  value,
  onChange,
  invalid = false
}) => {
  const tr = useT();
  return (
    <Field t={t} id={id} label={tr('twofa.code_label')} hint={tr('twofa.code_hint')}>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(sixDigits(event.target.value))}
        inputMode="numeric"
        autoComplete="one-time-code"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        aria-invalid={invalid}
        aria-describedby={`${id}-hint`}
        style={{ ...controlStyle(t), fontFamily: MONO, letterSpacing: '0.2em' }}
      />
    </Field>
  );
};
