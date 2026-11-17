import type React from 'react';
import { cx } from './cx';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ControlSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends Omit<React.ComponentProps<'button'>, 'type'> {
  /** `primary` is the one main action of a screen; `secondary` the others; `ghost` for toolbars and quiet actions; `danger` for what cannot be undone. */
  variant?: ButtonVariant;
  /** 32, 36 and 44 px high on a desktop; every size is 44 px on a phone or a touch screen. */
  size?: ControlSize;
  /** The work is running: the button shows a spinner, says `aria-busy`, and ignores clicks (it keeps focus and its text). */
  loading?: boolean;
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  /** As wide as its container (a sign-in form, a sheet on a phone). */
  fullWidth?: boolean;
  /** `submit` makes it the button that Enter presses in a form. Default: `button`. */
  type?: 'button' | 'submit';
  /** `pill`: fully rounded ends, for the Compose button and the phone's floating Compose. Default: the control radius. */
  shape?: 'pill';
  /**
   * A text button that stands inside a line of text ("See why", "Show all (3)"): it takes the font of its line, and its target grows to
   * 24 px with a mouse and 44 px on touch round the words, given back with negative margins so no text moves (ui.css `data-inline`).
   */
  inline?: boolean;
}

/**
 * The text button. Use `primary` once per screen for the action the screen is for, `secondary` for the rest, `ghost` where a row of
 * buttons would be too heavy, and `danger` for deleting. For an icon with no text use IconButton, which needs a label.
 */
export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  leadingIcon,
  trailingIcon,
  fullWidth = false,
  type = 'button',
  shape,
  inline = false,
  className,
  onClick,
  children,
  ...rest
}: ButtonProps): React.ReactElement {
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (loading) {
      event.preventDefault();
      return;
    }
    onClick?.(event);
  };
  return (
    <button
      type={type === 'submit' ? 'submit' : 'button'}
      className={cx('ui-btn', fullWidth && 'ui-btn-full', className)}
      data-variant={variant}
      data-size={size}
      data-shape={shape}
      data-inline={inline ? 'true' : undefined}
      aria-busy={loading ? true : undefined}
      aria-disabled={loading ? true : undefined}
      onClick={handleClick}
      {...rest}
    >
      {loading ? <Spinner decorative /> : leadingIcon}
      {children}
      {trailingIcon}
    </button>
  );
}
