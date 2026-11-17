import React from 'react';
import { cx } from './cx';
import { has, HiddenHint, type HintMode } from './Field';
import { InfoTip } from './InfoTip';
import { nodeText } from './nodeText';
import { assignRef } from './refs';

export interface CheckboxProps extends Omit<React.ComponentProps<'input'>, 'type' | 'size' | 'onChange'> {
  /** The text beside the box. The whole row is clickable, and 44 px high on touch. */
  label: React.ReactNode;
  /** What the choice does: an InfoTip after the label (default), or one line under it (`hintMode="inline"`). */
  hint?: string;
  /** `tip` (default) or `inline` (Field's HintMode): inline only for what the person needs while choosing. */
  hintMode?: HintMode;
  /** The name of the InfoTip ("About {tipLabel}") when `label` is not plain text; default: the words of `label`. */
  tipLabel?: string;
  /** Neither checked nor unchecked: a "select all" when only some rows are selected. */
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
}

/**
 * A box that is ticked or not (a choice that is saved with a Save button, or one row of a list of rows). It is a real checkbox drawn in
 * the app's style, so the keyboard and screen readers work as they do everywhere. For a setting that applies at once use Switch; for one
 * choice among several use RadioGroup. With a hint in `tip` mode (the default) the row is a `div.ui-check` whose <label for> covers the
 * whole row (ui.css) and the InfoTip sits after the label words, outside the label, so a tap on it opens the tip without ticking the box
 * and the box is still named by its label alone; the hint stays in the page for `aria-describedby`.
 */
export function Checkbox({
  label,
  hint,
  hintMode = 'tip',
  tipLabel,
  indeterminate = false,
  onChange,
  className,
  id,
  ref,
  ...input
}: CheckboxProps): React.ReactElement {
  const generated = React.useId();
  const inputId = id ?? generated;
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const setRefs = React.useCallback(
    (node: HTMLInputElement | null) => {
      inputRef.current = node;
      assignRef(ref, node);
    },
    [ref]
  );
  React.useEffect(() => {
    if (inputRef.current !== null) {
      inputRef.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  const box = (
    // The box holds the real checkbox and the tick drawn over it (its stroke draws in when it is ticked, ui.css).
    <span className="ui-check-box">
      <input
        ref={setRefs}
        id={inputId}
        type="checkbox"
        className="ui-check-input"
        aria-describedby={has(hint) ? `${inputId}-hint` : undefined}
        onChange={(event) => onChange?.(event.target.checked)}
        {...input}
      />
      <svg className="ui-check-mark" viewBox="0 0 14 14" fill="none" aria-hidden="true">
        <path d="M3 7.4l2.6 2.6L11 4.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );

  if (has(hint) && hintMode === 'tip') {
    return (
      <div className={cx('ui-check', className)} data-tip="true" data-disabled={input.disabled === true ? 'true' : undefined}>
        {box}
        <span className="ui-check-text">
          <span className="ui-check-name">
            <label htmlFor={inputId} className="ui-check-label">
              {label}
            </label>
          </span>
          <InfoTip label={tipLabel ?? nodeText(label)}>{hint}</InfoTip>
        </span>
        <HiddenHint id={`${inputId}-hint`} text={hint} />
      </div>
    );
  }

  return (
    <label className={cx('ui-check', className)} data-disabled={input.disabled === true ? 'true' : undefined}>
      {box}
      <span className="ui-check-text">
        <span>{label}</span>
        {has(hint) ? (
          <span id={`${inputId}-hint`} className="ui-hint">
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}
