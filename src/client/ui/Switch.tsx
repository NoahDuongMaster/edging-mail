import React from 'react';
import { cx } from './cx';
import { has } from './Field';

export interface SwitchProps {
  /** What the switch turns on or off, as a short noun phrase or sentence ("Desktop notifications"). */
  label: string;
  /** One line under the label that says what it does. */
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
  className?: string;
}

/**
 * An on/off setting that takes effect at once (a notification setting). It is a button with role="switch": Space and Enter flip it, a
 * screen reader says "on" or "off". The label is on the left, the switch on the right, and the whole row is the touch target.
 * For a choice that is saved later with a Save button, use Checkbox.
 */
export function Switch({ label, hint, checked, onChange, disabled = false, id, className }: SwitchProps): React.ReactElement {
  const generated = React.useId();
  const switchId = id ?? generated;
  return (
    <div className={cx('ui-switch-row', className)} data-disabled={disabled ? 'true' : undefined}>
      <span className="ui-switch-text">
        <label htmlFor={switchId} className="ui-label">
          {label}
        </label>
        {has(hint) ? (
          <span id={`${switchId}-hint`} className="ui-hint">
            {hint}
          </span>
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
