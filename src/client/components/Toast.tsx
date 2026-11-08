import React from 'react';
import type { ThemeTokens } from '../theme';
import { useT } from '../lib/i18n';

export interface ToastState {
  text: string;
  undo?: () => void;
}

interface ToastProps {
  t: ThemeTokens;
  toast: ToastState | null;
  onDismiss: () => void;
  /** Phone list pane: sit above the floating Compose button instead of covering part of it. */
  raised?: boolean;
  /** Desktop layout: bottom-left of the list column, clear of the reader toolbar that sits bottom-centre. */
  desktop?: boolean;
}

export const Toast: React.FC<ToastProps> = ({ t, toast, onDismiss, raised = false, desktop = false }) => {
  const tr = useT();
  // App passes a new onDismiss on every render: the timer must not restart each time (an Undo toast would never expire).
  const dismissRef = React.useRef(onDismiss);
  React.useLayoutEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  React.useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = window.setTimeout(() => dismissRef.current(), 6000);
    return () => window.clearTimeout(timer);
  }, [toast]);

  if (!toast) {
    return null;
  }

  return (
    <output
      aria-live="polite"
      className="nm-fade-in"
      style={{
        position: 'fixed',
        // 264 = 248px sidebar + 16px gap. A phone centres with auto margins, not a transform: nm-fade-in animates
        // `transform`, which would drop a translateX(-50%) for its 0.18 s and make the toast jump sideways.
        ...(desktop ? { left: 264 } : { left: 0, right: 0, marginInline: 'auto' }),
        bottom: raised ? 'calc(104px + env(safe-area-inset-bottom))' : desktop ? 24 : 28,
        zIndex: 80,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        // As wide as its text, but never wider than the screen: a long text (a snooze date) wraps instead of running off a phone.
        width: 'max-content',
        maxWidth: desktop ? 'calc(100vw - 296px)' : 'calc(100vw - 32px)', // 296 = 264 left offset + 32px right margin
        padding: '6px 6px 6px 16px',
        borderRadius: 12,
        background: t.toastBg,
        color: t.toastText,
        boxShadow: '0 12px 32px rgba(0,0,0,0.24)',
        fontSize: 14,
        whiteSpace: 'nowrap'
      }}
    >
      <span style={{ minWidth: 0, whiteSpace: 'normal' }}>{toast.text}</span>
      {toast.undo ? (
        <button
          type="button"
          className="nm-tap-h"
          onClick={() => {
            toast.undo?.();
            onDismiss();
          }}
          style={{
            height: 36,
            padding: '0 12px',
            border: 0,
            borderRadius: 8,
            background: 'transparent',
            color: t.toastAction,
            font: 'inherit',
            fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          {tr('toast.undo')}
        </button>
      ) : null}
    </output>
  );
};
