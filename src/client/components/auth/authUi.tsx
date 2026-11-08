import React from 'react';
import { Loader2 } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { Wordmark } from '../BrandMark';
import { LanguagePicker } from '../LanguagePicker';

// The pieces every screen before the mailbox is made of (sign-in, unlock, the gates, Setup, forgot password): one centred card with the mascot, a
// title and a form, so the screens look like one flow and a layout fix lands in one place.

export const dangerColor = (t: ThemeTokens): string => (t.dark ? '#F97066' : '#B42318');

interface AuthCardProps {
  t: ThemeTokens;
  title: string;
  /** One short paragraph under the title. */
  lead?: string;
  /** The language picker is on every screen before sign-in; the gates come after it, so they leave it out. */
  picker?: boolean;
  wide?: boolean;
  /** A quiet action in the top-left corner, opposite the language picker (the unlock screen's Sign out): first on the page and in the tab order. */
  topAction?: React.ReactNode;
  onSubmit?: (event: React.SyntheticEvent) => void;
  children: React.ReactNode;
}

export const AuthCard: React.FC<AuthCardProps> = ({ t, title, lead, picker = false, wide = false, topAction, onSubmit, children }) => {
  const Tag = onSubmit === undefined ? 'div' : 'form';
  const heading = React.useRef<HTMLHeadingElement>(null);
  // C-9: a screen that replaces another one must not leave the keyboard and the screen reader on <body>, where the next Tab starts from the top of the
  // page. When nothing has focus, the title takes it (a screen with a field of its own, like sign-in, moves it on to that field right after).
  React.useEffect(() => {
    const active = document.activeElement;
    if (active === null || active === document.body) {
      heading.current?.focus({ preventScroll: true });
    }
  }, [title]);
  return (
    <main
      style={{
        minHeight: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        background: t.bg,
        color: t.text,
        overflowY: 'auto'
      }}
    >
      <Tag
        {...(onSubmit === undefined ? {} : { onSubmit, noValidate: true })}
        className="nm-fade-in"
        style={{
          width: '100%',
          maxWidth: wide ? 520 : 380,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'stretch',
          gap: 16,
          padding: 24,
          background: t.surface,
          border: `1px solid ${t.border}`,
          borderRadius: 16,
          boxShadow: '0 1px 2px rgba(16,24,40,0.05), 0 16px 40px -16px rgba(16,24,40,0.16)'
        }}
      >
        {picker || topAction !== undefined ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: topAction === undefined ? 'flex-end' : 'space-between',
              gap: 8
            }}
          >
            {topAction}
            {picker ? <LanguagePicker t={t} id="auth-language" /> : null}
          </div>
        ) : null}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, textAlign: 'center' }}>
          <img src="/edgar.svg" alt="" width={88} height={86} style={{ display: 'block' }} />
          <Wordmark t={t} />
          <h1
            ref={heading}
            tabIndex={-1}
            style={{ margin: 0, fontSize: 21, lineHeight: '27px', fontWeight: 600, letterSpacing: '-0.01em', outline: 'none' }}
          >
            {title}
          </h1>
          {lead === undefined ? null : <p style={{ margin: 0, fontSize: 14, lineHeight: '20px', color: t.text2 }}>{lead}</p>}
        </div>
        {children}
      </Tag>
    </main>
  );
};

export const inputStyle = (t: ThemeTokens): React.CSSProperties => ({
  width: '100%',
  height: 44,
  padding: '0 12px',
  border: `1px solid ${t.borderStrong}`,
  borderRadius: 10,
  background: t.raised,
  color: t.text,
  font: 'inherit',
  fontSize: 16
});

interface FieldProps {
  t: ThemeTokens;
  id: string;
  label: string;
  children: React.ReactNode;
  hint?: string;
}

/** A label above one control, with an optional hint under it. The control carries the same `id`. */
export const Field: React.FC<FieldProps> = ({ t, id, label, children, hint }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
    <label htmlFor={id} style={{ fontSize: 13, fontWeight: 500, color: t.text2 }}>
      {label}
    </label>
    {children}
    {hint === undefined ? null : (
      <span id={`${id}-hint`} style={{ fontSize: 12, lineHeight: '17px', color: t.text3 }}>
        {hint}
      </span>
    )}
  </div>
);

interface ButtonProps {
  t: ThemeTokens;
  label: string;
  busy?: boolean;
  disabled?: boolean;
  type?: 'submit' | 'button';
  onClick?: () => void;
  quiet?: boolean;
}

export const AuthButton: React.FC<ButtonProps> = ({
  t,
  label,
  busy = false,
  disabled = false,
  type = 'submit',
  onClick,
  quiet = false
}) => {
  const inactive = busy || disabled;
  return (
    <button
      type={type === 'submit' ? 'submit' : 'button'}
      disabled={inactive}
      aria-busy={busy}
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        minHeight: 44,
        padding: '0 16px',
        border: quiet ? `1px solid ${t.borderStrong}` : 0,
        borderRadius: 10,
        background: quiet ? t.surface : t.accent,
        color: quiet ? t.text : '#FFFFFF',
        fontSize: 15,
        fontWeight: 600,
        cursor: busy ? 'progress' : disabled ? 'not-allowed' : 'pointer',
        opacity: inactive ? 0.6 : 1
      }}
    >
      {busy ? <Loader2 size={18} className="nm-spin" aria-hidden="true" /> : null}
      {label}
    </button>
  );
};

/** A link-looking button, for "Forgot password?" and "Sign out" next to a form. `action` names it for the tests (`data-action`). */
export const TextButton: React.FC<{ t: ThemeTokens; label: string; onClick: () => void; disabled?: boolean; action?: string }> = ({
  t,
  label,
  onClick,
  disabled = false,
  action
}) => (
  <button
    type="button"
    data-action={action}
    onClick={onClick}
    disabled={disabled}
    style={{
      alignSelf: 'center',
      minHeight: 44,
      minWidth: 44,
      padding: '0 8px',
      border: 0,
      background: 'none',
      color: t.link,
      font: 'inherit',
      fontSize: 14,
      textDecoration: 'underline',
      cursor: 'pointer'
    }}
  >
    {label}
  </button>
);

export const ErrorLine: React.FC<{ t: ThemeTokens; id: string; text: string | null }> = ({ t, id, text }) =>
  text === null ? null : (
    <p id={id} role="alert" style={{ margin: 0, fontSize: 13, lineHeight: '18px', color: dangerColor(t) }}>
      {text}
    </p>
  );

/** The text of a plain checkbox with a label and an explanation under it (the "shared device" choice). */
export const CheckboxRow: React.FC<{
  t: ThemeTokens;
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The choice is not the person's to change here (the server knows this session is a shared-device one): ticked and disabled. */
  locked?: boolean;
}> = ({ t, id, label, hint, checked, onChange, locked = false }) => (
  // The whole row is the label (C-12): a tap anywhere on it toggles the box, and the row is 44 px high. The box is named by the label text alone and
  // described by the hint.
  <label
    className="nm-tap-h"
    style={{ display: 'flex', gap: 10, alignItems: 'flex-start', padding: '2px 0', cursor: locked ? 'default' : 'pointer' }}
  >
    <input
      id={id}
      type="checkbox"
      checked={checked}
      disabled={locked}
      onChange={(event) => onChange(event.target.checked)}
      aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-hint`}
      style={{ width: 20, height: 20, marginTop: 1, flex: '0 0 auto' }}
    />
    <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span id={`${id}-label`} style={{ fontSize: 14, fontWeight: 500 }}>
        {label}
      </span>
      <span id={`${id}-hint`} style={{ fontSize: 12, lineHeight: '17px', color: t.text3 }}>
        {hint}
      </span>
    </span>
  </label>
);
