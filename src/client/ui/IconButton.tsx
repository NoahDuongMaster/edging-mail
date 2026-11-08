import React from 'react';
import { assignRef } from './refs';
import { Tooltip } from './Tooltip';
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
}

/**
 * A button that is only an icon (put the icon in `children`, 16-20 px, `aria-hidden`). It has no text, so `label` is required: it names the
 * button for screen readers and shows as a tooltip on hover and keyboard focus (Escape hides it). 32, 36 or 44 px square, 44 px on touch.
 */
export function IconButton({
  label,
  variant = 'ghost',
  size = 'md',
  pressed,
  type = 'button',
  className,
  ref,
  children,
  onPointerEnter,
  onPointerLeave,
  onPointerDown,
  onFocus,
  onBlur,
  onKeyDown,
  ...rest
}: IconButtonProps): React.ReactElement {
  const buttonRef = React.useRef<HTMLButtonElement | null>(null);
  const [tip, setTip] = React.useState(false);
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
        onPointerEnter={(event) => {
          setTip(event.pointerType === 'mouse');
          onPointerEnter?.(event);
        }}
        onPointerLeave={(event) => {
          setTip(false);
          onPointerLeave?.(event);
        }}
        onPointerDown={(event) => {
          setTip(false);
          onPointerDown?.(event);
        }}
        onFocus={(event) => {
          setTip(event.currentTarget.matches(':focus-visible'));
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setTip(false);
          onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setTip(false);
          }
          onKeyDown?.(event);
        }}
        {...rest}
      >
        {children}
      </button>
      <Tooltip open={tip ? !expanded : false} text={label} anchorRef={buttonRef} />
    </>
  );
}
