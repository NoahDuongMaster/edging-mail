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

/**
 * A short message that goes away by itself after 6 seconds, with an Undo when the action can be taken back. It is the inverse of the
 * theme (dark on light, light on dark), so the colours come from `t`; the shape and the states are in ui.css (`ui-toast`).
 */
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
      className="ui-toast nm-fade-in"
      style={{
        // 256 = 240px sidebar + 16px gap. A phone centres with auto margins, not a transform: nm-fade-in animates
        // `transform`, which would drop a translateX(-50%) for its animation and make the toast jump sideways.
        ...(desktop ? { left: 256 } : { left: 0, right: 0, marginInline: 'auto' }),
        bottom: raised ? 'calc(104px + env(safe-area-inset-bottom))' : desktop ? 24 : 28,
        maxWidth: desktop ? 'calc(100vw - 288px)' : 'calc(100vw - 32px)', // 288 = 256 left offset + 32px right margin
        background: t.toastBg,
        color: t.toastText
      }}
    >
      <span className="ui-toast-text">{toast.text}</span>
      {toast.undo ? (
        <button
          type="button"
          className="ui-toast-action nm-tap-h"
          onClick={() => {
            toast.undo?.();
            onDismiss();
          }}
          style={{ color: t.toastAction }}
        >
          {tr('toast.undo')}
        </button>
      ) : null}
    </output>
  );
};
