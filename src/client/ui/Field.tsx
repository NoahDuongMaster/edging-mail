import type React from 'react';

/** True when an optional text has something in it. */
export const has = (text: string | undefined): text is string => text !== undefined && text !== '';

/** The `aria-describedby` of a control: the ids of its hint and its error, when it has them. */
export function describedBy(id: string, hint: string | undefined, error: string | undefined): string | undefined {
  const ids = [has(hint) ? `${id}-hint` : '', has(error) ? `${id}-error` : ''].filter((value) => value !== '');
  return ids.length > 0 ? ids.join(' ') : undefined;
}

interface FieldProps {
  /** The id of the control. The label is `${id}-label`, the hint `${id}-hint` and the error `${id}-error`. */
  id: string;
  label: string;
  /** Keeps the label for screen readers but does not show it (a search box, a field whose purpose the layout already says). */
  hideLabel?: boolean;
  hint?: string;
  error?: string;
  /** True when the control is a native input, so the label is a real <label for>. A custom control (Select) names itself with aria-labelledby instead. */
  native?: boolean;
  children: React.ReactNode;
}

/**
 * The frame of a form control: the label above, the control, then its hint and, when something is wrong, the error. Used inside
 * TextField, TextArea and Select; use it directly only to build another control of the same kind.
 */
export function Field({ id, label, hideLabel = false, hint, error, native = true, children }: FieldProps): React.ReactElement {
  const className = hideLabel ? 'ui-visually-hidden' : 'ui-label';
  return (
    <div className="ui-field">
      {native ? (
        <label id={`${id}-label`} htmlFor={id} className={className}>
          {label}
        </label>
      ) : (
        <span id={`${id}-label`} className={className}>
          {label}
        </span>
      )}
      {children}
      {has(hint) ? (
        <p id={`${id}-hint`} className="ui-hint">
          {hint}
        </p>
      ) : null}
      {has(error) ? (
        <p id={`${id}-error`} className="ui-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
