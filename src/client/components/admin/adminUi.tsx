import React from 'react';
import { X } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { trapTab } from '../../lib/focusTrap';
import { useT } from '../../lib/i18n';

/** Styles shared by the admin screens, from the same theme tokens as the rest of the app. */
export function adminStyles(t: ThemeTokens) {
  const danger = t.dark ? '#F97066' : '#B42318';
  const good = t.dark ? '#4ADE80' : '#15803D';
  const warn = t.dark ? '#FBBF24' : '#B45309';
  const button: React.CSSProperties = {
    height: 40,
    padding: '0 16px',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    border: `1px solid ${t.borderStrong}`,
    borderRadius: 10,
    background: t.surface,
    color: t.text,
    font: 'inherit',
    fontSize: 13.5,
    fontWeight: 500,
    cursor: 'pointer'
  };
  return {
    danger,
    good,
    warn,
    button,
    primary: { ...button, border: 0, background: t.accent, color: '#FFFFFF', fontWeight: 600 } satisfies React.CSSProperties,
    dangerButton: { ...button, borderColor: danger, color: danger } satisfies React.CSSProperties,
    input: {
      width: '100%',
      height: 44,
      padding: '0 12px',
      border: `1px solid ${t.borderStrong}`,
      borderRadius: 10,
      background: t.raised,
      color: t.text,
      font: 'inherit',
      fontSize: 16
    } satisfies React.CSSProperties,
    label: { fontSize: 13, fontWeight: 500, color: t.text2 } satisfies React.CSSProperties,
    muted: { margin: 0, color: t.text2, fontSize: 12.5, lineHeight: '19px' } satisfies React.CSSProperties,
    card: { padding: 14, border: `1px solid ${t.border}`, borderRadius: 12, background: t.surface } satisfies React.CSSProperties,
    h3: { margin: 0, fontSize: 14, fontWeight: 600 } satisfies React.CSSProperties
  };
}

export type AdminStyles = ReturnType<typeof adminStyles>;

/** A small coloured word (role, status): colour never carries the meaning alone. */
export const Badge: React.FC<{ t: ThemeTokens; tone: 'neutral' | 'good' | 'warn' | 'danger'; children: React.ReactNode }> = ({
  t,
  tone,
  children
}) => {
  const s = adminStyles(t);
  const color = { neutral: t.text2, good: s.good, warn: s.warn, danger: s.danger }[tone];
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 8px',
        border: `1px solid ${color}`,
        borderRadius: 999,
        color,
        fontSize: 11.5,
        fontWeight: 600,
        lineHeight: '18px',
        whiteSpace: 'nowrap'
      }}
    >
      {children}
    </span>
  );
};

/** Moves focus to the visible account avatar (the one that opens Settings): where focus belongs when a screen opened from Settings closes. */
export function focusAccountButton(): void {
  const buttons = [...document.querySelectorAll<HTMLElement>('button[data-account-button]')];
  buttons.find((button) => button.getClientRects().length > 0)?.focus({ preventScroll: true });
}

interface ModalFrameProps {
  t: ThemeTokens;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  /** A request is running: the dialog cannot be dismissed until it answers. */
  locked?: boolean;
  maxWidth?: number;
  /** Role "alertdialog" for a dialog that asks before something that cannot be undone. */
  alert?: boolean;
}

/**
 * The frame of every admin dialog: scrim, card, title, close button, Escape, a focus trap, focus into the first field when it opens and back
 * to the opener when it closes. Dialogs are siblings, never nested, so Escape and Tab only ever act on the one on top.
 */
export const ModalFrame: React.FC<ModalFrameProps> = ({ t, title, onClose, children, locked = false, maxWidth = 480, alert = false }) => {
  const tr = useT();
  const ref = React.useRef<HTMLDivElement | null>(null);
  const titleId = React.useId();
  const pressedScrim = React.useRef(false);

  React.useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>(
      '[data-autofocus], input:not([disabled]), textarea:not([disabled]), button:not([disabled])'
    );
    first?.focus({ preventScroll: true });
    return () => {
      const openerGone = !opener || opener === document.body || !opener.isConnected;
      if (openerGone) {
        focusAccountButton();
      } else {
        opener.focus({ preventScroll: true });
      }
    };
  }, []);

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (!locked) {
        onClose();
      }
      return;
    }
    trapTab(event.nativeEvent, ref.current);
  };

  return (
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- a dialog (the role is chosen at run time): the scrim click is a pointer shortcut; Escape and the Close button are the keyboard routes
    <div
      ref={ref}
      role={alert ? 'alertdialog' : 'dialog'}
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        pressedScrim.current = e.target === e.currentTarget;
      }}
      onClick={() => {
        if (pressedScrim.current && !locked) {
          pressedScrim.current = false;
          onClose();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 75,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 12,
        background: t.dark ? 'rgba(0,0,0,0.6)' : 'rgba(16,24,40,0.45)',
        outline: 'none'
      }}
    >
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions -- only stops clicks from reaching the scrim; not an interactive control */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="nm-fade-in nm-admin"
        style={{
          width: '100%',
          maxWidth,
          maxHeight: '92dvh',
          display: 'flex',
          flexDirection: 'column',
          background: t.surface,
          border: `1px solid ${t.border}`,
          borderRadius: 16,
          boxShadow: '0 24px 64px -24px rgba(16,24,40,0.32)',
          overflow: 'hidden'
        }}
      >
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px 12px 20px', borderBottom: `1px solid ${t.divider}` }}
        >
          <h2 id={titleId} style={{ margin: 0, fontSize: 15, fontWeight: 600, flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
            {title}
          </h2>
          <button
            type="button"
            className="nm-tap"
            onClick={onClose}
            disabled={locked}
            aria-label={tr('common.close')}
            style={{
              width: 36,
              height: 36,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 0,
              borderRadius: 10,
              background: 'transparent',
              color: t.text2,
              cursor: locked ? 'not-allowed' : 'pointer'
            }}
          >
            <X size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
        <div style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
      </div>
    </div>
  );
};
