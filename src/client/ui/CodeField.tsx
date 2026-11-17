import React from 'react';
import { cx } from './cx';
import { describedBy, Field, has, type HintMode } from './Field';

export type CodeFieldProps = Omit<React.ComponentProps<'input'>, 'value' | 'onChange' | 'size' | 'type' | 'maxLength' | 'children'> & {
  label: string;
  /** Keeps the label for screen readers only. */
  hideLabel?: boolean;
  hint?: string;
  /** `tip` (default): the hint behind an InfoTip after the label; `inline`: a visible line under the boxes. */
  hintMode?: HintMode;
  /** The text of what is wrong: every box turns red, `aria-invalid` is set and the text is read with the field. */
  error?: string;
  /** The digits typed so far (anything else is dropped before `onChange`). */
  value: string;
  /** Called with the digits only, at most `length` of them: a pasted "123 456" arrives as "123456". */
  onChange: (value: string) => void;
  /** How many digits the code has. Default 6 (an authenticator app's code). */
  length?: number;
};

const digitsOf = (text: string, length: number): string => text.replaceAll(/\D/g, '').slice(0, length);

/** True when the whole code is selected (Ctrl+A, a double tap): the next key or paste replaces it, like in any field. */
const allSelected = (element: HTMLInputElement): boolean =>
  element.value !== '' && element.selectionStart === 0 && element.selectionEnd === element.value.length;

// A tap in the middle of the row or an arrow key would put the caret inside the code; it goes back to the end. A selection of the
// whole code stays (it is how a code is cleared or replaced at once).
const keepEnd = (element: HTMLInputElement): void => {
  const end = element.value.length;
  if (!allSelected(element) && (element.selectionStart !== end || element.selectionEnd !== end)) {
    element.setSelectionRange(end, end);
  }
};

/**
 * The code after an edit. The caret is always at the end, so text that keeps the old code in front was added after it: a whole code
 * pasted or autofilled there (the phone offers it while two digits are typed) takes the field's place; a digit or a part of a code
 * is added, up to `length`. Anything else (Backspace, a replaced selection) is the field's new text.
 */
export function nextCode(previous: string, text: string, length: number): string {
  const typed = text.replaceAll(/\D/g, '');
  if (typed.length > previous.length && typed.startsWith(previous)) {
    const added = typed.slice(previous.length);
    return added.length >= length ? added.slice(0, length) : typed.slice(0, length);
  }
  return typed.slice(0, length);
}

/**
 * A one-time code as a row of boxes, one digit each (the authenticator app's six digits), with a wider gap in the middle where the app
 * prints its space. Underneath it is ONE ordinary input laid over the whole row, so everything a code field must do keeps working:
 * the phone's one-time-code autofill and the browser's paste ("123 456" too), one label and one name for screen readers, Backspace,
 * select-all and the form's Enter. The input's own text is invisible; the boxes draw the digits, the box that takes the next digit
 * (with a caret while the field has focus) and the red of an error. The caret always stays at the end, so a code is typed and erased
 * from its end, like on every authenticator prompt; Ctrl+A selects the whole code (every box tinted) for one key to clear or replace,
 * and a whole code pasted over a half-typed one replaces it (nextCode).
 */
export function CodeField({
  label,
  hideLabel,
  hint,
  hintMode,
  error,
  value,
  onChange,
  length = 6,
  id,
  className,
  disabled,
  ref,
  onFocus,
  onBlur,
  onSelect,
  ...input
}: CodeFieldProps): React.ReactElement {
  const generated = React.useId();
  const fieldId = id ?? generated;
  const [focused, setFocused] = React.useState(false);
  const [selected, setSelected] = React.useState(false);
  const digits = digitsOf(value, length);
  const invalid = has(error) || input['aria-invalid'] === true || input['aria-invalid'] === 'true';
  const describedby = [describedBy(fieldId, hint, error), input['aria-describedby']].filter(has).join(' ');
  // The box that takes the next digit; the last one once the code is complete.
  const next = Math.min(digits.length, length - 1);
  const half = Math.floor(length / 2);

  return (
    <Field id={fieldId} label={label} hideLabel={hideLabel} hint={hint} hintMode={hintMode} error={error}>
      <div
        className={cx('ui-otp', className)}
        data-invalid={invalid ? 'true' : undefined}
        data-disabled={disabled === true ? 'true' : undefined}
        data-focused={focused ? 'true' : undefined}
        data-selected={focused && selected && digits !== '' ? 'true' : undefined}
      >
        <input
          ref={ref}
          id={fieldId}
          className="ui-otp-input"
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]*"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          translate="no"
          disabled={disabled}
          aria-invalid={invalid ? true : undefined}
          {...input}
          value={digits}
          // No maxLength: it would cut a pasted "123 456" before its space is dropped.
          onChange={(event) => onChange(nextCode(digits, event.target.value, length))}
          onFocus={(event) => {
            setFocused(true);
            keepEnd(event.currentTarget);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          onSelect={(event) => {
            keepEnd(event.currentTarget);
            setSelected(allSelected(event.currentTarget));
            onSelect?.(event);
          }}
          aria-describedby={describedby === '' ? undefined : describedby}
        />
        <div className="ui-otp-slots" aria-hidden="true">
          {Array.from({ length }, (_, index) => (
            <span
              key={index}
              className="ui-otp-slot"
              data-filled={index < digits.length ? 'true' : undefined}
              data-next={index === next ? 'true' : undefined}
              data-split={index === half - 1 && length > 4 ? 'true' : undefined}
            >
              {index < digits.length ? digits[index] : index === next ? <span className="ui-otp-caret" /> : null}
            </span>
          ))}
        </div>
      </div>
    </Field>
  );
}
