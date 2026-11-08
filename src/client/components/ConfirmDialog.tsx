import React from 'react';
import type { ThemeTokens } from '../theme';
import { useT } from '../lib/i18n';
import { trapTab } from '../lib/focusTrap';

interface ConfirmDialogProps {
  isOpen: boolean;
  t: ThemeTokens;
  title: string;
  body: string;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Asks before something that cannot be undone. Cancel has focus first (the safe choice); Escape and a tap on the scrim cancel. */
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({ isOpen, t, title, body, confirmLabel, onConfirm, onCancel }) => {
  const tr = useT();
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const cancelRef = React.useRef<HTMLButtonElement | null>(null);

  // Focus moves to Cancel on open and goes back to where it was on close.
  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    const opener = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus({ preventScroll: true });
    return () => opener?.focus({ preventScroll: true });
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onCancel();
      } else {
        trapTab(e, dialogRef.current);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onCancel]);

  if (!isOpen) {
    return null;
  }

  const danger = t.dark ? '#F97066' : '#B42318';
  const button: React.CSSProperties = {
    height: 44,
    padding: '0 18px',
    border: `1px solid ${t.borderStrong}`,
    borderRadius: 10,
    background: t.surface,
    color: t.text,
    font: 'inherit',
    fontSize: 14,
    fontWeight: 500,
    cursor: 'pointer'
  };

  return (
    <div
      ref={dialogRef}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-body"
      tabIndex={-1}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 90,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        outline: 'none'
      }}
    >
      <div
        role="presentation"
        onClick={onCancel}
        style={{ position: 'absolute', inset: 0, background: t.dark ? 'rgba(0,0,0,0.6)' : 'rgba(16,24,40,0.45)' }}
      />
      <div
        className="nm-fade-in"
        style={{
          position: 'relative',
          width: '100%',
          maxWidth: 400,
          padding: 20,
          background: t.surface,
          border: `1px solid ${t.border}`,
          borderRadius: 16,
          boxShadow: '0 24px 64px -24px rgba(16,24,40,0.32)'
        }}
      >
        <h2 id="confirm-title" style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
          {title}
        </h2>
        <p id="confirm-body" style={{ margin: '8px 0 0', color: t.text2, whiteSpace: 'pre-line' }}>
          {body}
        </p>
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8, marginTop: 20 }}>
          <button ref={cancelRef} type="button" onClick={onCancel} style={button}>
            {tr('common.cancel')}
          </button>
          <button type="button" onClick={onConfirm} style={{ ...button, borderColor: danger, color: danger }}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
