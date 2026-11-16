import React from 'react';
import { cx } from './cx';
import { has } from './Field';
import { assignRef } from './refs';

export interface CheckboxProps extends Omit<React.ComponentProps<'input'>, 'type' | 'size' | 'onChange'> {
  /** The text beside the box. The whole label is clickable, and 44 px high on touch. */
  label: React.ReactNode;
  /** One line under the label. */
  hint?: string;
  /** Neither checked nor unchecked: a "select all" when only some rows are selected. */
  indeterminate?: boolean;
  onChange?: (checked: boolean) => void;
}

/**
 * A box that is ticked or not (a choice that is saved with a Save button, or one row of a list of rows). It is a real checkbox drawn in
 * the app's style, so the keyboard and screen readers work as they do everywhere. For a setting that applies at once use Switch; for one
 * choice among several use RadioGroup.
 */
export function Checkbox({
  label,
  hint,
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

  return (
    <label className={cx('ui-check', className)} data-disabled={input.disabled === true ? 'true' : undefined}>
      {/* The box holds the real checkbox and the tick drawn over it (its stroke draws in when it is ticked, ui.css). */}
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
