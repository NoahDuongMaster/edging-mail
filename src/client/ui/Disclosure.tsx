import type React from 'react';
import { ChevronDown } from 'lucide-react';
import { Button, type ControlSize } from './Button';
import { cx } from './cx';

export interface DisclosureProps extends Omit<
  React.ComponentProps<'button'>,
  'type' | 'onClick' | 'children' | 'aria-expanded' | 'aria-controls'
> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The id of the region it shows and hides. Leave it out only when the button shows more of itself (a line cut short that opens in place). */
  controls?: string;
  /** `text` (default): no box, the font and the colour of the line it sits in (a recipients line, a badge). `button`: a ghost Button. */
  look?: 'text' | 'button';
  /** The size of the `button` look. */
  size?: ControlSize;
  /** What it opens, in words (or a Badge that says it). The chevron comes after it. */
  children: React.ReactNode;
}

/**
 * A control that shows or hides more of something in place (the recipients of a mail, the setup steps of a domain, the note of a badge):
 * a button with a chevron that turns when it is open, `aria-expanded`, and `aria-controls` naming the region. The caller renders the
 * region where it belongs (right after it, or in the next table row). The chevron does not turn under reduced motion, it flips.
 */
export function Disclosure({
  open,
  onOpenChange,
  controls,
  look = 'text',
  size = 'sm',
  className,
  children,
  ...rest
}: DisclosureProps): React.ReactElement {
  const chevron = (
    <ChevronDown size={look === 'button' ? 16 : 14} strokeWidth={1.75} aria-hidden="true" className="ui-disclosure-chevron" />
  );
  if (look === 'button') {
    return (
      <Button
        variant="ghost"
        size={size}
        className={cx('ui-disclosure', className)}
        aria-expanded={open}
        aria-controls={controls}
        trailingIcon={chevron}
        onClick={() => onOpenChange(!open)}
        {...rest}
      >
        {children}
      </Button>
    );
  }
  return (
    <button
      type="button"
      className={cx('ui-disclosure', className)}
      data-look="text"
      aria-expanded={open}
      aria-controls={controls}
      onClick={() => onOpenChange(!open)}
      {...rest}
    >
      {children}
      {chevron}
    </button>
  );
}
