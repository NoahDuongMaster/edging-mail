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
      <input
        ref={setRefs}
        id={inputId}
        type="checkbox"
        className="ui-check-input"
        aria-describedby={has(hint) ? `${inputId}-hint` : undefined}
        onChange={(event) => onChange?.(event.target.checked)}
        {...input}
      />
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
