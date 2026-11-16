import React from 'react';
import { assignRef } from './refs';
import { Tooltip, useTooltip } from './Tooltip';
import { cx } from './cx';
import type { ButtonVariant, ControlSize } from './Button';

export interface IconButtonProps extends Omit<React.ComponentProps<'button'>, 'type' | 'aria-label'> {
  /** What the button does. It is the accessible name AND the tooltip, so it is required. Pass a translated text. */
  label: string;
  variant?: ButtonVariant;
  size?: ControlSize;
  /** A pressed toggle (a star, a filter): sets `aria-pressed` and fills the button. */
  pressed?: boolean;
  type?: 'button' | 'submit';
  /**
   * A single-key shortcut that does the same ("E"): the tooltip says "Archive (E)" and the button carries `aria-keyshortcuts`; the
   * accessible name stays the label. Pass it only while single-key shortcuts are on (the `shortcuts` device preference).
   */
  shortcut?: string;
}

/**
 * A button that is only an icon (put the icon in `children`, 16-20 px, `aria-hidden`). It has no text, so `label` is required: it names the
 * button for screen readers and shows as a tooltip when the mouse rests on it (500 ms) and at once on keyboard focus (Escape hides it).
 * 32, 36 or 44 px square, 44 px on touch.
 */
export function IconButton({
  label,
  variant = 'ghost',
  size = 'md',
  pressed,
  type = 'button',
  shortcut,
  className,
  ref,
  children,
  onPointerEnter,
  onPointerMove,
  onPointerLeave,
  onPointerDown,
  onFocus,
  onBlur,
  onKeyDown,
  ...rest
}: IconButtonProps): React.ReactElement {
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const tip = useTooltip();
  // A button whose menu or popover is open says so with aria-expanded: its tooltip would cover the first row of that popup.
  const expanded = rest['aria-expanded'] === true || rest['aria-expanded'] === 'true';
  // The tooltip needs the element, and so does the caller (a Menu anchors its popup on its trigger).
  const setRefs = React.useCallback(
    (node: HTMLButtonElement | null) => {
      buttonRef.current = node;
      assignRef(ref, node);
    },
    [ref]
  );

  return (
    <>
      <button
        ref={setRefs}
        type={type === 'submit' ? 'submit' : 'button'}
        className={cx('ui-btn ui-icon-btn', className)}
        data-variant={variant}
        data-size={size}
        aria-label={label}
        aria-pressed={pressed}
        aria-keyshortcuts={shortcut}
        onPointerEnter={(event) => {
          tip.anchor.onPointerEnter(event);
          onPointerEnter?.(event);
        }}
        onPointerMove={(event) => {
          // The tooltip waits for the mouse to rest here (hover intent), never for a button that slid under a still pointer.
          tip.anchor.onPointerMove(event);
          onPointerMove?.(event);
        }}
        onPointerLeave={(event) => {
          // It stays a moment, so the pointer can move onto the bubble (1.4.13).
          tip.anchor.onPointerLeave();
          onPointerLeave?.(event);
        }}
        onPointerDown={(event) => {
          tip.show(false);
          onPointerDown?.(event);
        }}
        onFocus={(event) => {
          tip.show(event.currentTarget.matches(':focus-visible'));
          onFocus?.(event);
        }}
        onBlur={(event) => {
          tip.show(false);
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            tip.show(false);
          }
          onKeyDown?.(event);
        }}
        {...rest}
      >
        {children}
      </button>
      <Tooltip
        open={tip.open ? !expanded : false}
        text={shortcut === undefined ? label : `${label} (${shortcut})`}
        anchorRef={buttonRef}
        {...tip.bubble}
      />
    </>
  );
}
