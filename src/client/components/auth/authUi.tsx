import React from 'react';
import { CircleAlert } from 'lucide-react';
import { DARK, LIGHT } from '../../../shared/design/tokens';
import type { ThemeTokens } from '../../theme';
import { Button, Checkbox } from '../../ui';
import { BrandMark } from '../BrandMark';
import { LanguagePicker } from '../LanguagePicker';
import './auth.css';

// The pieces every screen before the mailbox is made of (sign-in, unlock, the gates, Setup, forgot password): one centred column with the mark
// and the language list on one row over one card with a title and a form, so the screens look like one flow and a layout fix lands in one
// place. The look is in auth.css (`au-*`) and the ui/ primitives; `t` stays in the props for the callers (Settings uses these pieces too).

export const dangerColor = (t: ThemeTokens): string => (t.dark ? DARK.danger : LIGHT.danger);

interface AuthCardProps {
  t: ThemeTokens;
  title: string;
  /** One short paragraph under the title. */
  lead?: string;
  /** The language picker is on every screen before sign-in; the gates come after it, so they leave it out. */
  picker?: boolean;
  wide?: boolean;
  /** A quiet action on the row over the card, before the language picker (the unlock screen's Sign out): first on the page and in the tab order. */
  topAction?: React.ReactNode;
  /** A short line above the title (Setup's "Step 1 of 2"). */
  eyebrow?: string;
  /** Edgar, small (96 px), beside the title (above it on a phone): only for a screen that reports a blocked state, never on a form. */
  illustration?: boolean;
  onSubmit?: (event: React.SyntheticEvent) => void;
  children: React.ReactNode;
}

export const AuthCard: React.FC<AuthCardProps> = ({
  t,
  title,
  lead,
  picker = false,
  wide = false,
  topAction,
  eyebrow,
  illustration = false,
  onSubmit,
  children
}) => {
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
    <main className="au-page">
      <div className="au-column" data-wide={wide ? 'true' : undefined}>
        {/* One row over the card, as wide as the card: the mark on the left, the quiet action and the language list on the right, so every
            control lines up with the card's edges (in the page's corner the list overshot the card by the page margin). */}
        <div className="au-top">
          <BrandMark t={t} />
          {picker || topAction !== undefined ? (
            <div className="au-top-actions">
              {topAction}
              {picker ? <LanguagePicker t={t} id="auth-language" /> : null}
            </div>
          ) : null}
        </div>
        <Tag {...(onSubmit === undefined ? {} : { onSubmit, noValidate: true })} className="au-card nm-fade-in">
          <div className="au-head">
            <div className="au-head-text">
              {eyebrow === undefined ? null : <p className="au-eyebrow">{eyebrow}</p>}
              <h1 ref={heading} tabIndex={-1} className="au-title">
                {title}
              </h1>
              {lead === undefined ? null : <p className="au-lead">{lead}</p>}
            </div>
            {illustration ? <img src="/edgar.svg" alt="" width={96} height={93} className="au-art" /> : null}
          </div>
          {children}
        </Tag>
      </div>
    </main>
  );
};

/** The look of a bare input element next to these pieces (Settings > Security still has some). New fields use ui/TextField instead. */
export const inputStyle = (_t: ThemeTokens): React.CSSProperties => ({
  width: '100%',
  height: 44,
  padding: '0 12px',
  border: '1px solid var(--control)',
  borderRadius: 'var(--radius-control)',
  background: 'var(--surface)',
  color: 'var(--text)',
  font: 'inherit',
  fontSize: 'var(--ui-field-size)'
});

interface FieldProps {
  t: ThemeTokens;
  id: string;
  label: string;
  children: React.ReactNode;
  hint?: string;
}

/** A label above one bare control, with an optional hint under it. The control carries the same `id`. New fields use ui/TextField instead. */
export const Field: React.FC<FieldProps> = ({ id, label, children, hint }) => (
  <div className="ui-field">
    <label htmlFor={id} className="ui-label">
      {label}
    </label>
    {children}
    {hint === undefined ? null : (
      <p id={`${id}-hint`} className="ui-hint">
        {hint}
      </p>
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
  /** An icon before the label (16 px, aria-hidden), so a quiet button reads as one pair with the CopyButton beside it. */
  icon?: React.ReactNode;
}

/**
 * The button of a form on these screens: the primary one (one per screen), or `quiet` (secondary) for Copy, Download and Retry. 44px high.
 * A way back (Back, Cancel) is a TextButton. Busy: a spinner (still under reduced motion, C-11), `aria-busy` and no clicks.
 */
export const AuthButton: React.FC<ButtonProps> = ({
  label,
  busy = false,
  disabled = false,
  type = 'submit',
  onClick,
  quiet = false,
  icon
}) => (
  <Button
    type={type === 'submit' ? 'submit' : 'button'}
    variant={quiet ? 'secondary' : 'primary'}
    size="lg"
    className="au-btn"
    loading={busy}
    disabled={busy || disabled}
    aria-busy={busy}
    leadingIcon={icon}
    onClick={onClick}
  >
    {label}
  </Button>
);

/** A quiet button, for "Forgot password" and "Sign out" next to a form. `action` names it for the tests (`data-action`). */
export const TextButton: React.FC<{ t: ThemeTokens; label: string; onClick: () => void; disabled?: boolean; action?: string }> = ({
  label,
  onClick,
  disabled = false,
  action
}) => (
  // C-12: 44px high (size lg on every screen) and never under 44px wide (auth.css), so a short label (vi "Hủy", zh "返回") is still a tap target.
  <Button variant="ghost" size="lg" className="au-text-btn" data-action={action} onClick={onClick} disabled={disabled}>
    {label}
  </Button>
);

export const ErrorLine: React.FC<{ t: ThemeTokens; id: string; text: string | null }> = ({ id, text }) =>
  text === null ? null : (
    <p id={id} role="alert" className="ui-error au-error">
      <CircleAlert size={16} aria-hidden="true" />
      <span>{text}</span>
    </p>
  );

/** A checkbox with a label and an explanation under it (the "shared device" choice). */
export const CheckboxRow: React.FC<{
  t: ThemeTokens;
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The choice is not the person's to change here (the server knows this session is a shared-device one): ticked and disabled. */
  locked?: boolean;
}> = ({ id, label, hint, checked, onChange, locked = false }) => (
  // C-12: ui/Checkbox makes the whole row one label (a tap anywhere on it toggles the box), 44px high on touch. The box is named by the label text
  // alone and described by the hint.
  <Checkbox
    id={id}
    label={
      <span id={`${id}-label`} className="au-check-label">
        {label}
      </span>
    }
    hint={hint}
    checked={checked}
    disabled={locked}
    onChange={onChange}
    aria-labelledby={`${id}-label`}
  />
);
