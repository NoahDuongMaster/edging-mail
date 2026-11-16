import type React from 'react';
import { Button, IconButton, type IconButtonProps } from '../../ui';
import { cx } from '../../ui/cx';

export interface ToolButtonProps extends Omit<IconButtonProps, 'label' | 'children' | 'pressed' | 'variant'> {
  /** What the button does: its words when `labelled`, else its accessible name and tooltip. */
  label: string;
  /** The icon (16-20 px, aria-hidden). */
  icon: React.ReactNode;
  /** The toolbar has room for words (the `labelled` density): the label is shown beside the icon. */
  labelled?: boolean;
  /** Delete forever: the one red button of the bar. */
  danger?: boolean;
  /**
   * The phone's bottom bar: a short word under the icon ("Trash" for Move to Trash). It is part of `label` (the accessible name), so what
   * is seen is what a voice user says (2.5.3).
   */
  short?: string;
}

/**
 * One button of the reader's toolbars: an IconButton (named by its label, which is also its tooltip) or, where the pane has room, a ghost
 * Button with the icon and the words (`.rd-lbl`, the width reader/barDensity.ts counts with). Same element type either way, so focus and
 * the toolbar's Tab stop survive a change of density. On the phone's bottom bar (`short`): the icon over a short word (`.rd-tab`, 44 px
 * and more), so Archive and Move to Trash are never two look-alike outlines side by side.
 */
export const ToolButton: React.FC<ToolButtonProps> = ({
  label,
  icon,
  labelled = false,
  danger = false,
  short,
  shortcut,
  size = 'sm',
  className,
  ...rest
}) => {
  if (short !== undefined) {
    return (
      <button type="button" aria-label={label} className={cx('rd-tab', danger && 'rd-danger', className)} {...rest}>
        {icon}
        <span aria-hidden="true" className="rd-tab-text">
          {short}
        </span>
      </button>
    );
  }
  return labelled ? (
    <Button
      variant="ghost"
      size={size}
      className={cx('rd-lbl', danger && 'rd-danger', className)}
      leadingIcon={icon}
      aria-keyshortcuts={shortcut}
      {...rest}
    >
      {label}
    </Button>
  ) : (
    <IconButton label={label} size={size} shortcut={shortcut} className={cx(danger && 'rd-danger', className)} {...rest}>
      {icon}
    </IconButton>
  );
};
