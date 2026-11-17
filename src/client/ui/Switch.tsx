import React from 'react';
import { cx } from './cx';
import { has, HiddenHint, type HintMode } from './Field';
import { InfoTip } from './InfoTip';

export interface SwitchProps {
  /** What the switch turns on or off, as a short noun phrase or sentence ("Desktop notifications"). */
  label: string;
  /** What it does: an InfoTip after the label (default), or one line under it (`hintMode="inline"`). */
  hint?: string;
  /** `tip` (default) or `inline` (Field's HintMode): inline for a state the person must see (why it is off, what it does now). */
  hintMode?: HintMode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * An on/off setting that takes effect at once (a notification setting). It is a button with role="switch": Space and Enter flip it, a
 * screen reader says "on" or "off". The label is on the left, the switch on the right, and the whole row is the touch target.
 * For a choice that is saved later with a Save button, use Checkbox. A hint in `tip` mode (the default) is an InfoTip after the label
 * words (outside the <label>, so the switch is named by its label alone), its words kept in the page for `aria-describedby`.
 */
export function Switch({
  label,
  hint,
  hintMode = 'tip',
  checked,
  onChange,
  disabled = false,
  id,
  className
}: SwitchProps): React.ReactElement {
  const generated = React.useId();
  const switchId = id ?? generated;
  const tip = has(hint) && hintMode === 'tip';
  return (
    <div className={cx('ui-switch-row', className)} data-disabled={disabled ? 'true' : undefined}>
      <span className="ui-switch-text">
        {tip ? (
          <span className="ui-label ui-tip-row">
            <label htmlFor={switchId}>{label}</label>
            <InfoTip label={label}>{hint}</InfoTip>
          </span>
        ) : (
          <label htmlFor={switchId} className="ui-label">
            {label}
          </label>
        )}
        {has(hint) ? (
          tip ? (
            <HiddenHint id={`${switchId}-hint`} text={hint} />
          ) : (
            <span id={`${switchId}-hint`} className="ui-hint">
              {hint}
            </span>
          )
        ) : null}
      </span>
      <button
        type="button"
        role="switch"
        id={switchId}
        aria-checked={checked}
        aria-describedby={has(hint) ? `${switchId}-hint` : undefined}
        disabled={disabled}
        className="ui-switch"
        onClick={() => onChange(!checked)}
      >
        <span className="ui-switch-thumb" />
      </button>
    </div>
  );
}
