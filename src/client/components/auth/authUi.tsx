import React from 'react';
import { CircleAlert, Lock } from 'lucide-react';
import { DARK, DURATION, EASING, LIGHT } from '../../../shared/design/tokens';
import { BRAND_NAME } from '../../../shared/i18n';
import type { ThemeTokens } from '../../theme';
import { useDocumentTitle } from '../../lib/documentTitle';
import { tRich, useT } from '../../lib/i18n';
import { Button, Checkbox } from '../../ui';
import { useIdleBeat } from '../../ui/EmptyState';
import { motionReduced } from '../../ui/motion';
import { LanguagePicker } from '../LanguagePicker';
import './auth.css';

// The pieces every screen before the mailbox is made of (sign-in, unlock, the gates, Setup, forgot password): the landing's hero ground (a
// faint grid that fades out round the card, one soft accent glow behind it), the quiet page actions top right (the language list, Sign out),
// the brand over one centred card with a title and a form, so the screens look like one flow and a layout fix lands in one place. The look
// is in auth.css (`au-*`) and the ui/ primitives; `t` stays in the props for the callers (Settings uses these pieces too).

export const dangerColor = (t: ThemeTokens): string => (t.dark ? DARK.danger : LIGHT.danger);

// The product name is never translated: its first word is semibold, the rest regular (as the Wordmark of the app's header).
const [BRAND_FIRST = '', ...BRAND_REST] = BRAND_NAME.split(' ');

/** Whether a card has been on this page yet: the first one rises in (M: 250 ms fade + 8 px), every later screen or step only fades in. */
let cardShown = false;

/** The host of this page (the server the password is for), or nothing outside a browser (the server-side render of the tests). */
const pageHost = (): string => (typeof location === 'undefined' ? '' : location.host);

/** The place of this screen in a flow of several (Setup, forgot password, break-glass, the gates of a first sign-in). */
export interface AuthStep {
  current: number;
  total: number;
}

/** "Step 2 of 3" with one thin segment per step, the done and current ones in the indicator colour. The words carry it; the bar is a picture. */
export const AuthSteps: React.FC<AuthStep> = ({ current, total }) => {
  const tr = useT();
  return (
    <div className="au-steps">
      <span className="au-steps-bar" aria-hidden="true">
        {Array.from({ length: total }, (_, index) => (
          <span
            key={index}
            className="au-steps-seg"
            data-on={index < current ? 'true' : undefined}
            data-current={index === current - 1 ? 'true' : undefined}
          />
        ))}
      </span>
      <p className="au-steps-text">{tr('auth.step', { current, total })}</p>
    </div>
  );
};

interface AuthCardProps {
  t: ThemeTokens;
  title: string;
  /** The name of the tab when it differs from the title (sign-in: the title greets, the tab says 'Sign in'). */
  pageTitle?: string;
  /** One short paragraph under the title. */
  lead?: string;
  /**
   * Which server the password goes to, as quiet text under the title: 'Sign in to mail.example.com' before sign-in, 'Signed in to ...' on
   * the unlock screen. The host of the page, as text (never a link), so a person with accounts on several servers sees which one this is.
   */
  server?: 'sign-in' | 'unlock';
  /** The language picker is on every screen before sign-in; the gates come after it, so they leave it out. */
  picker?: boolean;
  /** The card for a secret shown once (recovery key, two-factor QR): 560 px instead of 440 px. */
  wide?: boolean;
  /** A quiet action top right, before the language picker (the unlock screen's Sign out): first on the page and in the tab order. */
  topAction?: React.ReactNode;
  /** Where this screen is in a flow of several: "Step 1 of 2" over the title. */
  step?: AuthStep;
  /** A short line above the title, for a screen that is not a numbered step. */
  eyebrow?: string;
  /**
   * Edgar (112 px) over a centred title: only for a screen that reports a blocked state (Setup not ready), never on a form. He gives his
   * idle beats the first time the screen shows (M20, ui EmptyState).
   */
  illustration?: boolean;
  onSubmit?: (event: React.SyntheticEvent) => void;
  children: React.ReactNode;
}

export const AuthCard: React.FC<AuthCardProps> = ({
  t,
  title,
  pageTitle,
  lead,
  server,
  picker = false,
  wide = false,
  topAction,
  step,
  eyebrow,
  illustration = false,
  onSubmit,
  children
}) => {
  const Tag = onSubmit === undefined ? 'div' : 'form';
  const heading = React.useRef<HTMLHeadingElement>(null);
  const card = React.useRef<HTMLElement | null>(null);
  const art = React.useRef<HTMLImageElement | null>(null);
  // The first card of the page rises in by CSS (data-enter); this one is decided once, when it mounts.
  const rise = React.useMemo(() => !cardShown, []);
  const shownTitle = React.useRef<string | null>(null);
  useIdleBeat(art, illustration, title);
  // WCAG 2.4.2: the tab is named after the screen ("Sign in - Edging Mail", "Set up Edging Mail").
  useDocumentTitle([pageTitle ?? title]);
  const host = server === undefined ? '' : pageHost();

  // A new screen or a new step of one (its title changed): the content fades in where the card stands (150 ms, no move: errors and steps
  // never shake or slide), the window goes back to its top, and the keyboard and the screen reader start at the new title. A screen
  // that wants a field instead moves the focus on in its own effect, which runs after this one.
  React.useLayoutEffect(() => {
    if (shownTitle.current === title) {
      return;
    }
    const first = shownTitle.current === null;
    shownTitle.current = title;
    if (first && rise) {
      cardShown = true;
      return;
    }
    cardShown = true;
    if (!first) {
      window.scrollTo({ top: 0 });
    }
    for (const part of card.current?.children ?? []) {
      part.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: motionReduced() ? DURATION.fast : DURATION.quick,
        easing: EASING.standard
      });
    }
  }, [title, rise]);

  // C-9: a screen that replaces another one must not leave the keyboard and the screen reader on <body>, where the next Tab starts from the top of the
  // page. When nothing has focus, the title takes it (a screen with a field of its own, like sign-in, moves it on to that field right after); a new
  // step of the same screen moves it there too.
  const focusedTitle = React.useRef<string | null>(null);
  React.useEffect(() => {
    const active = document.activeElement;
    const newStep = focusedTitle.current !== null && focusedTitle.current !== title;
    focusedTitle.current = title;
    if (newStep || active === null || active === document.body) {
      heading.current?.focus({ preventScroll: true });
    }
  }, [title]);

  return (
    <div className="au-page">
      {picker || topAction !== undefined ? (
        // The page's quiet actions, top right: Sign out first (the unlock screen, CK-17), then the language list.
        <div className="au-bar">
          {topAction}
          {picker ? <LanguagePicker t={t} id="auth-language" /> : null}
        </div>
      ) : null}
      <main className="au-column" data-wide={wide ? 'true' : undefined}>
        <p className="au-brand">
          <img src="/logo.svg" alt="" width={36} height={36} className="au-brand-mark" />
          <span className="au-brand-name">
            <span className="au-brand-first">{BRAND_FIRST}</span> {BRAND_REST.join(' ')}
          </span>
        </p>
        {/* The stage carries the soft accent glow, centred on the card whatever its height (auth.css), behind it. */}
        <div className="au-stage">
          <Tag
            {...(onSubmit === undefined ? {} : { onSubmit, noValidate: true })}
            ref={(node: HTMLElement | null) => {
              card.current = node;
            }}
            className="au-card"
            data-enter={rise ? 'rise' : undefined}
            data-status={illustration ? 'true' : undefined}
          >
            <div className="au-head">
              {illustration ? <img ref={art} src="/edgar.svg" alt="" width={112} height={109} className="au-art ui-empty-art" /> : null}
              {step === undefined ? null : <AuthSteps current={step.current} total={step.total} />}
              {eyebrow === undefined ? null : <p className="au-eyebrow">{eyebrow}</p>}
              <h1 ref={heading} tabIndex={-1} className="au-title">
                {title}
              </h1>
              {host === '' ? null : (
                <p className="au-host">
                  {tRich(server === 'unlock' ? 'keys.unlock_host' : 'auth.sign_in_host', {
                    host: (
                      <span className="au-host-name" translate="no">
                        {host}
                      </span>
                    )
                  })}
                </p>
              )}
              {lead === undefined ? null : <p className="au-lead">{lead}</p>}
            </div>
            {children}
          </Tag>
        </div>
      </main>
    </div>
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
 * The button of a form on these screens: the primary one (one per screen, full width), or `quiet` (secondary) for Copy, Download and Retry.
 * 44px high. A way back (Back, Cancel) is a TextButton. Busy: a spinner (still under reduced motion, C-11), `aria-busy` and no clicks.
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

/** A quiet button, for "Forgot password" and "Sign out" next to a form: a text link in look. `action` names it for the tests (`data-action`). */
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

/**
 * A way to another screen that reads as a link ('Forgot password' under the sign-in button): the accent's text, underlined under the pointer
 * and with the keyboard, the ui focus ring, 32px high with a mouse (44px on touch), and one line under it that says what the other screen
 * needs (it also describes the button for a screen reader).
 */
export const HintedLink: React.FC<{ id: string; label: string; hint: string; onClick: () => void }> = ({ id, label, hint, onClick }) => (
  <div className="au-hinted">
    <Button variant="ghost" size="sm" className="au-link-btn" aria-describedby={`${id}-hint`} onClick={onClick}>
      {label}
    </Button>
    <p id={`${id}-hint`} className="au-link-hint">
      {hint}
    </p>
  </div>
);

/** One quiet line at the foot of the sign-in and unlock cards: what protects the mail, with a lock (not an alert, not a badge). */
export const TrustLine: React.FC = () => {
  const tr = useT();
  return (
    <p className="au-trust">
      <Lock size={14} aria-hidden="true" />
      <span>{tr('auth.trust_line')}</span>
    </p>
  );
};

/** An error about a whole form (the server's answer, a wrong code): announced at once, faded in (never shaken). Field errors go under their field. */
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
  /** What the choice does, always shown: the sign-in screens give one short line, and the longer one once the box is ticked (what to do then). */
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** The choice is not the person's to change here (the server knows this session is a shared-device one): ticked and disabled. */
  locked?: boolean;
  /** Pressing the form's button without ticking a box that must be ticked ("I have saved these codes"): what to do, under the row. */
  error?: string | null;
}> = ({ id, label, hint, checked, onChange, locked = false, error = null }) => (
  // C-12: ui/Checkbox makes the whole row one label (a tap anywhere on it toggles the box), 44px high on touch. The box is named by the label text
  // alone and described by the hint.
  <>
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
      {...(error === null
        ? {}
        : { 'aria-invalid': true, 'aria-describedby': hint === undefined ? `${id}-error` : `${id}-hint ${id}-error` })}
    />
    {error === null ? null : (
      <p id={`${id}-error`} className="ui-error au-error">
        <CircleAlert size={16} aria-hidden="true" />
        <span>{error}</span>
      </p>
    )}
  </>
);
