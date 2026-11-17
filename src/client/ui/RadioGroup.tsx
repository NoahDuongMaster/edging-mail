import React from 'react';
import { cx } from './cx';
import { has, HiddenHint, type HintMode } from './Field';
import { InfoTip } from './InfoTip';

export interface RadioOption {
  value: string;
  label: string;
  /** What this choice means: an InfoTip after its label (the group's `hintMode`, default `tip`) or a line under it. */
  hint?: string;
  /** This option's own HintMode, over the group's. */
  hintMode?: HintMode;
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
  /** How the options show their hints: `tip` (default, an InfoTip after the option's label) or `inline` (Field's HintMode). */
  hintMode?: HintMode;
  className?: string;
}

/**
 * One choice among a few (2 to 5) that should all be visible: a language, a frequency. They are real radio buttons drawn in the app's
 * style: Tab enters the group, Up/Down/Left/Right move AND choose, as in every browser. With more options use Select. An option with a
 * hint in `tip` mode is a `div.ui-check` (the radio stays its direct child) whose <label for> covers the row, with the InfoTip after the
 * label words, outside the label.
 */
export function RadioGroup({
  label,
  options,
  value,
  onChange,
  name,
  disabled = false,
  hintMode = 'tip',
  className
}: RadioGroupProps): React.ReactElement {
  const generated = React.useId();
  const groupName = name ?? generated;
  return (
    <fieldset className={cx('ui-radio-group', className)} disabled={disabled}>
      <legend className="ui-label">{label}</legend>
      {options.map((option) => {
        const hintId = `${groupName}-${option.value}-hint`;
        const rowDisabled = option.disabled === true || disabled ? 'true' : undefined;
        const radio = (inputId?: string) => (
          <input
            id={inputId}
            type="radio"
            className="ui-radio-input"
            name={groupName}
            value={option.value}
            checked={option.value === value}
            disabled={option.disabled}
            aria-describedby={has(option.hint) ? hintId : undefined}
            onChange={() => onChange(option.value)}
          />
        );
        if (has(option.hint) && (option.hintMode ?? hintMode) === 'tip') {
          const inputId = `${groupName}-${option.value}`;
          return (
            <div key={option.value} className="ui-check" data-tip="true" data-disabled={rowDisabled}>
              {radio(inputId)}
              <span className="ui-check-text">
                <span className="ui-check-name">
                  <label htmlFor={inputId} className="ui-check-label">
                    {option.label}
                  </label>
                </span>
                <InfoTip label={option.label}>{option.hint}</InfoTip>
              </span>
              <HiddenHint id={hintId} text={option.hint} />
            </div>
          );
        }
        return (
          <label key={option.value} className="ui-check" data-disabled={rowDisabled}>
            {radio()}
            <span className="ui-check-text">
              <span>{option.label}</span>
              {has(option.hint) ? (
                <span id={hintId} className="ui-hint">
                  {option.hint}
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
