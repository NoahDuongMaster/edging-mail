import type React from 'react';
import { X } from 'lucide-react';
import { cx } from './cx';
import { IconButton } from './IconButton';

/** The colours of a label of the person (`getLabelChip` in theme.ts): its hue is data, so it is set inline. */
export interface ChipColors {
  bg: string;
  fg: string;
  dot: string;
}

interface ChipOwnProps extends Omit<React.ComponentProps<'span'>, 'children' | 'color' | 'style'> {
  /** The text. A static chip cuts it with an ellipsis; a removable one shows it whole (it wraps). */
  children: React.ReactNode;
  /** A label's colours: a tinted chip with a dot of the hue. Without them the chip is a quiet outline (a snooze time, a recipient). */
  colors?: ChipColors;
  /** A small icon before the text (12 px). */
  icon?: React.ReactNode;
}

type RemoveProps =
  | {
      /** A token the person can take back (a recipient): an X button after the text. */
      onRemove: () => void;
      /** The name of the X button, which says what goes ("Remove ana@example.com"). */
      removeLabel: string;
    }
  | { onRemove?: undefined; removeLabel?: undefined };

export type ChipProps = ChipOwnProps & RemoveProps;

/**
 * A small token next to text: a label of a message (with its colour), a snooze time, or a recipient the person can remove. Static chips
 * are 20 px and say what they are in words; the colour only adds to it. For a status ("Admin", "Unverified") use Badge.
 */
export function Chip({ children, colors, icon, onRemove, removeLabel, className, ...rest }: ChipProps): React.ReactElement {
  return (
    <span
      className={cx('ui-chip', className)}
      data-kind={colors === undefined ? 'plain' : 'label'}
      data-removable={onRemove === undefined ? undefined : 'true'}
      style={colors === undefined ? undefined : { background: colors.bg, color: colors.fg }}
      {...rest}
    >
      {colors === undefined ? null : <span aria-hidden="true" className="ui-chip-dot" style={{ background: colors.dot }} />}
      {icon === undefined ? null : (
        <span aria-hidden="true" className="ui-chip-icon">
          {icon}
        </span>
      )}
      <span className="ui-chip-text">{children}</span>
      {onRemove === undefined ? null : (
        <IconButton label={removeLabel} size="sm" className="ui-chip-x" onClick={onRemove}>
          <X size={14} strokeWidth={2} aria-hidden="true" />
        </IconButton>
      )}
    </span>
  );
}
