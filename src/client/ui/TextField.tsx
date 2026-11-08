import React from 'react';
import { cx } from './cx';
import { describedBy, Field, has } from './Field';

interface FieldOptions {
  label: string;
  /** Keeps the label for screen readers only. */
  hideLabel?: boolean;
  hint?: string;
  /** The text of what is wrong. It turns the border red, sets `aria-invalid` and is read with the field. */
  error?: string;
  /** An icon or a small control inside the left edge (a search icon). */
  leading?: React.ReactNode;
  /** An icon or a small control inside the right edge (a show-password button, a unit). */
  trailing?: React.ReactNode;
  /** Keys, codes and addresses in a technical context: the mono face. */
  mono?: boolean;
}

export type TextFieldProps = FieldOptions & Omit<React.ComponentProps<'input'>, 'size'>;
export type TextAreaProps = FieldOptions & React.ComponentProps<'textarea'>;

interface ShellProps extends Pick<FieldOptions, 'leading' | 'trailing'> {
  invalid: boolean;
  disabled: boolean | undefined;
  multiline: boolean;
  children: React.ReactNode;
}

/** The bordered box around the input and its adornments. The focus ring is drawn on this box (see ui.css). */
function Shell({ invalid, disabled, multiline, leading, trailing, children }: ShellProps) {
  return (
    <div
      className="ui-input"
      data-invalid={invalid ? 'true' : undefined}
      data-disabled={disabled === true ? 'true' : undefined}
      data-multiline={multiline ? 'true' : undefined}
    >
      {leading === undefined ? null : <span className="ui-adorn">{leading}</span>}
      {children}
      {trailing === undefined ? null : <span className="ui-adorn">{trailing}</span>}
    </div>
  );
}

/**
 * A one-line text field with its label, hint and error: text, email, password, search, number. Use `leading` and `trailing` for an
 * icon or a button inside the box. Every field has a label (hide it with `hideLabel` when the layout says it already).
 */
export function TextField({
  label,
  hideLabel,
  hint,
  error,
  leading,
  trailing,
  mono,
  id,
  className,
  ...input
}: TextFieldProps): React.ReactElement {
  const generated = React.useId();
  const fieldId = id ?? generated;
  const describedby = [describedBy(fieldId, hint, error), input['aria-describedby']].filter(has).join(' ');
  return (
    <Field id={fieldId} label={label} hideLabel={hideLabel} hint={hint} error={error}>
      <Shell invalid={has(error)} disabled={input.disabled} multiline={false} leading={leading} trailing={trailing}>
        <input
          id={fieldId}
          className={cx('ui-input-el', mono === true && 'nm-mono', className)}
          aria-invalid={has(error) ? true : undefined}
          {...input}
          aria-describedby={describedby === '' ? undefined : describedby}
        />
      </Shell>
    </Field>
  );
}

/** A multi-line text field (a note, a message). It grows taller by dragging its corner. Same label, hint and error as TextField. */
export function TextArea({
  label,
  hideLabel,
  hint,
  error,
  leading,
  trailing,
  mono,
  id,
  className,
  ...textarea
}: TextAreaProps): React.ReactElement {
  const generated = React.useId();
  const fieldId = id ?? generated;
  const describedby = [describedBy(fieldId, hint, error), textarea['aria-describedby']].filter(has).join(' ');
  return (
    <Field id={fieldId} label={label} hideLabel={hideLabel} hint={hint} error={error}>
      <Shell invalid={has(error)} disabled={textarea.disabled} multiline leading={leading} trailing={trailing}>
        <textarea
          id={fieldId}
          rows={3}
          className={cx('ui-input-el', mono === true && 'nm-mono', className)}
          aria-invalid={has(error) ? true : undefined}
          {...textarea}
          aria-describedby={describedby === '' ? undefined : describedby}
        />
      </Shell>
    </Field>
  );
}
