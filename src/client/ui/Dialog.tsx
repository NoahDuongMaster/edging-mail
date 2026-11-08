import { X } from 'lucide-react';
import React from 'react';
import { createPortal } from 'react-dom';
import { trapTab } from '../lib/focusTrap';
import { useT } from '../lib/i18n';
import { cx } from './cx';
import { IconButton } from './IconButton';
import { useLayer, useScrollLock } from './layers';
import { assignRef } from './refs';

export interface DialogProps {
  open: boolean;
  /** Called by Escape, a press on the scrim and the close button (not when `dismissible` is false or `closeDisabled` is true). */
  onClose: () => void;
  /** The heading of the dialog and its accessible name. */
  title: string;
  /** One or two sentences under the title; a screen reader reads them when the dialog opens. */
  description?: React.ReactNode;
  /** 400, 520 or 720 px wide on a desktop. On a phone every dialog is a sheet that rises from the bottom edge. */
  size?: 'sm' | 'md' | 'lg';
  /** The largest width in px, for a dialog whose content was laid out for a width between the sizes; it wins over `size`. */
  width?: number;
  /** `alertdialog` for a question that must be answered (the confirmation of a deletion). */
  role?: 'dialog' | 'alertdialog';
  /** A row between the heading and the content that stays put while the content scrolls (the tabs of Settings). */
  toolbar?: React.ReactNode;
  /** The buttons, right-aligned under the content. */
  footer?: React.ReactNode;
  /** The element that gets focus when the dialog opens. Without it: the first control of the content or the footer, else the dialog itself. */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Where focus goes on close when the element that opened the dialog is gone (a row that was deleted). */
  returnFocusRef?: React.RefObject<HTMLElement | null>;
  /** False for a dialog that must be finished through its own buttons: Escape and the scrim do nothing, and there is no close button. */
  dismissible?: boolean;
  /** False when the footer already has the button that closes it (a confirmation with Cancel): no X in the heading. Escape and the scrim still work. */
  closeButton?: boolean;
  /**
   * True while the dialog cannot be left for now (a request runs, a secret is on screen until it is saved): the X stays in its place but is
   * disabled, and Escape and the scrim do nothing.
   */
  closeDisabled?: boolean;
  /**
   * Draws the dialog where it stands in the page instead of at the end of <body>. It then also renders on the server (no portal, no
   * `document`), and it stays inside its parent's stacking order (a dialog of a full-screen console, under the toast).
   */
  inline?: boolean;
  /** Classes for the panel (the element with the role), to lay out its parts: `.x > .ui-dialog-body`. */
  className?: string;
  /** Classes for the scrim around the panel. */
  rootClassName?: string;
  /** The panel, the element with the role (`initialFocusRef={ref}` gives focus to the dialog itself). */
  ref?: React.Ref<HTMLDivElement>;
  children?: React.ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** The first control of the content or the footer that can take focus (the close button in the heading does not count). */
function firstControl(panel: HTMLElement): HTMLElement | null {
  for (const part of panel.querySelectorAll<HTMLElement>('.ui-dialog-body, .ui-dialog-foot')) {
    const control = [...part.querySelectorAll<HTMLElement>(FOCUSABLE)].find((element) => element.getClientRects().length > 0);
    if (control !== undefined) {
      return control;
    }
  }
  return null;
}

/** Gives focus back to the element that had it before the dialog opened; when that is gone, to `fallback`. */
function restoreFocus(opener: Element | null, fallback: React.RefObject<HTMLElement | null> | undefined): void {
  const gone = !(opener instanceof HTMLElement) || opener === document.body || !opener.isConnected;
  (gone ? fallback?.current : opener)?.focus({ preventScroll: true });
}

/**
 * A modal dialog: the page behind it cannot be used, Tab stays inside, Escape closes it, and focus returns to the control that opened it.
 * Use it for a task that needs the whole of the person's attention (a form, a confirmation, Settings); not for a message (Banner) or a list
 * of actions (Menu). A press on the scrim closes it only when the press also began there, so selecting text and letting go outside does
 * not. A control inside that has a use for Escape gets it first (a confirmation that takes itself back): when it stops the key or calls
 * preventDefault, the dialog stays open. On a phone it is a sheet from the bottom edge. Render it always and pass `open`; nothing is
 * mounted while it is closed.
 */
export function Dialog(props: DialogProps): React.ReactElement | null {
  return props.open ? <DialogPanel {...props} /> : null;
}

function DialogPanel({
  onClose,
  title,
  description,
  size = 'md',
  width,
  role = 'dialog',
  toolbar,
  footer,
  initialFocusRef,
  returnFocusRef,
  dismissible = true,
  closeButton = true,
  closeDisabled = false,
  inline = false,
  className,
  rootClassName,
  ref,
  children
}: DialogProps) {
  const tr = useT();
  const titleId = React.useId();
  const descriptionId = React.useId();
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const pressedOnScrim = React.useRef(false);
  const canClose = dismissible && !closeDisabled;
  const escape = () => {
    if (canClose) {
      onClose();
    }
  };
  // An Escape pressed inside the dialog comes to `onKeyDown` below; one pressed elsewhere (focus on the page behind) is taken by layers.ts.
  const isTop = useLayer(true, escape, rootRef);
  useScrollLock(true);

  // The panel is ours (focus, Tab) and the caller's (`ref`).
  const setPanel = React.useCallback(
    (node: HTMLDivElement | null) => {
      panelRef.current = node;
      assignRef(ref, node);
    },
    [ref]
  );

  // Focus moves into the dialog when it opens and back to the opener when it closes.
  React.useEffect(() => {
    const opener = document.activeElement;
    const panel = panelRef.current;
    const first = initialFocusRef?.current ?? (panel === null ? null : firstControl(panel)) ?? panel;
    first?.focus({ preventScroll: true });
    return () => {
      restoreFocus(opener, returnFocusRef);
    };
  }, [initialFocusRef, returnFocusRef]);

  // Tab stays inside, also when focus has slipped out to the page (a press on the scrim). A menu or list open above the dialog keeps its own Tab.
  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTop()) {
        trapTab(event, panelRef.current);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [isTop]);

  // Escape pressed inside the dialog arrives here after every control inside had its turn: a control that used it stopped it or called
  // preventDefault, and the dialog stays open. Nothing behind the dialog gets the key (React's own tree included, through a portal).
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Escape' || event.nativeEvent.isComposing) {
      return;
    }
    event.stopPropagation();
    if (!event.defaultPrevented && isTop()) {
      event.preventDefault();
      escape();
    }
  };

  const dialog = (
    // The scrim is the whole screen behind the panel. A press on it is a pointer shortcut for the close button; Escape is the keyboard route.
    // It counts only when the press began AND ended on the scrim (a drag from or into the panel, selecting text, does not).
    <div
      ref={rootRef}
      role="presentation"
      className={cx('ui-dialog-root', rootClassName)}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        pressedOnScrim.current = event.target === event.currentTarget;
      }}
      onPointerUp={(event) => {
        if (event.target !== event.currentTarget) {
          pressedOnScrim.current = false;
        }
      }}
      onClick={(event) => {
        if (canClose && pressedOnScrim.current && event.target === event.currentTarget) {
          onClose();
        }
        pressedOnScrim.current = false;
      }}
    >
      <div
        ref={setPanel}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description === undefined ? undefined : descriptionId}
        tabIndex={-1}
        className={cx('ui-dialog', className)}
        data-size={size}
        style={width === undefined ? undefined : { maxWidth: width }}
      >
        <div className="ui-dialog-head">
          <h2 id={titleId} className="ui-dialog-title">
            {title}
          </h2>
          {dismissible && closeButton ? (
            <IconButton label={tr('common.close')} size="sm" onClick={onClose} disabled={closeDisabled}>
              <X size={18} aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
        {description === undefined ? null : (
          <p id={descriptionId} className="ui-dialog-description">
            {description}
          </p>
        )}
        {toolbar === undefined ? null : <div className="ui-dialog-toolbar">{toolbar}</div>}
        <div className="ui-dialog-body">{children}</div>
        {footer === undefined ? null : <div className="ui-dialog-foot">{footer}</div>}
      </div>
    </div>
  );
  return inline ? dialog : createPortal(dialog, document.body);
}
