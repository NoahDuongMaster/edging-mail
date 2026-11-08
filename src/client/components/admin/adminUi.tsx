import React from 'react';
import { CircleAlert } from 'lucide-react';
import type { ThemeTokens } from '../../theme';
import { adminErrorText } from '../../lib/admin/types';
import { useT } from '../../lib/i18n';
import { Banner, Button, Dialog } from '../../ui';

/** The visible account avatar (the one that opens Settings), if there is one on screen. */
function accountButton(): HTMLElement | null {
  const buttons = [...document.querySelectorAll<HTMLElement>('button[data-account-button]')];
  return buttons.find((button) => button.getClientRects().length > 0) ?? null;
}

/** Moves focus to the visible account avatar (the one that opens Settings): where focus belongs when a screen opened from Settings closes. */
export function focusAccountButton(): void {
  accountButton()?.focus({ preventScroll: true });
}

/** The account avatar as a ref for ui/Dialog's `returnFocusRef`: looked up when a dialog closes and its opener is gone, never earlier. */
const ACCOUNT_BUTTON: React.RefObject<HTMLElement | null> = {
  get current(): HTMLElement | null {
    return accountButton();
  }
};

/** What went wrong, as words with an icon in the danger colour. Announced as soon as it appears; `id` lets a field point at it. */
export const ErrorText: React.FC<{ id?: string; children: React.ReactNode }> = ({ id, children }) => (
  <p id={id} role="alert" className="ad-error">
    <CircleAlert size={16} aria-hidden="true" />
    <span>{children}</span>
  </p>
);

/** A list that could not be loaded at all: the reason, and Try again. */
export const LoadError: React.FC<{ error: unknown; onRetry: () => void }> = ({ error, onRetry }) => {
  const tr = useT();
  return (
    <Banner
      tone="danger"
      action={
        <Button size="sm" onClick={onRetry}>
          {tr('common.retry')}
        </Button>
      }
    >
      {adminErrorText(error)}
    </Banner>
  );
};

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
 * The control that takes focus when an admin dialog opens: the first, in the order of the page, that is marked data-autofocus or is an
 * enabled field or button. That is the close button of the title bar unless it is disabled; a dialog that wants focus on another control
 * moves it in its own effect, which runs after ui/Dialog's (DeleteUserDialog).
 */
const FIRST_CONTROL = '[data-autofocus], input:not([disabled]), textarea:not([disabled]), button:not([disabled])';

/**
 * The frame of every admin dialog: a ui Dialog drawn in place (inside the console, so it stays under the toast as the console does) with
 * the title, the close button, Escape, the scrim, the focus trap, focus on FIRST_CONTROL when it opens and back to the opener when it
 * closes (to the account avatar when the opener is gone). `locked` disables the close button, Escape and the scrim. Dialogs are siblings,
 * never nested, so Escape and Tab only ever act on the one on top. A control inside answers Escape first: the confirmation of the person
 * dialog takes itself back before the dialog closes (D-6).
 */
export const ModalFrame: React.FC<ModalFrameProps> = ({ title, onClose, children, locked = false, maxWidth = 480, alert = false }) => {
  const firstRef = React.useRef<HTMLElement | null>(null);
  // Looked up as soon as the panel is in the page, so it is ready when ui/Dialog's effect gives the focus.
  const findFirst = React.useCallback((panel: HTMLDivElement | null) => {
    firstRef.current = panel?.querySelector<HTMLElement>(FIRST_CONTROL) ?? null;
  }, []);

  return (
    <Dialog
      inline
      open
      onClose={onClose}
      closeDisabled={locked}
      title={title}
      role={alert ? 'alertdialog' : 'dialog'}
      width={maxWidth}
      className="nm-admin ad-dialog"
      ref={findFirst}
      initialFocusRef={firstRef}
      returnFocusRef={ACCOUNT_BUTTON}
    >
      {children}
    </Dialog>
  );
};
