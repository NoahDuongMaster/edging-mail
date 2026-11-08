import React from 'react';
import { cx } from './cx';
import { has } from './Field';

export interface RadioOption {
  value: string;
  label: string;
  hint?: string;
  disabled?: boolean;
}

export interface RadioGroupProps {
  /** The question the options answer. It is the legend of the group, read before each option. */
  label: string;
  options: readonly RadioOption[];
  value: string;
  onChange: (value: string) => void;
  /** Shared by the radios; made up when left out. */
  name?: string;
  disabled?: boolean;
  className?: string;
}

/**
 * One choice among a few (2 to 5) that should all be visible: a language, a frequency. They are real radio buttons drawn in the app's
 * style: Tab enters the group, Up/Down/Left/Right move AND choose, as in every browser. With more options use Select.
 */
export function RadioGroup({ label, options, value, onChange, name, disabled = false, className }: RadioGroupProps): React.ReactElement {
  const generated = React.useId();
  const groupName = name ?? generated;
  return (
    <fieldset className={cx('ui-radio-group', className)} disabled={disabled}>
      <legend className="ui-label">{label}</legend>
      {options.map((option) => (
        <label key={option.value} className="ui-check" data-disabled={option.disabled === true || disabled ? 'true' : undefined}>
          <input
            type="radio"
            className="ui-radio-input"
            name={groupName}
            value={option.value}
            checked={option.value === value}
            disabled={option.disabled}
            aria-describedby={has(option.hint) ? `${groupName}-${option.value}-hint` : undefined}
            onChange={() => onChange(option.value)}
          />
          <span className="ui-check-text">
            <span>{option.label}</span>
            {has(option.hint) ? (
              <span id={`${groupName}-${option.value}-hint`} className="ui-hint">
                {option.hint}
              </span>
            ) : null}
          </span>
        </label>
      ))}
    </fieldset>
  );
}
