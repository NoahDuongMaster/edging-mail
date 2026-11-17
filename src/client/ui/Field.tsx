import type React from 'react';
import { CircleAlert } from 'lucide-react';
import { InfoTip } from './InfoTip';

/** True when an optional text has something in it. */
export const has = (text: string | undefined): text is string => text !== undefined && text !== '';

/**
 * How a control shows its hint (DESIGN-v4m R1). `tip` (the default): an InfoTip right after the label, and the words kept in the page as
 * visually hidden text with the hint's id, so `aria-describedby` still reads them with the control. `inline`: a visible line under the
 * control, only for what a person needs WHILE acting (the rules of a password as it is typed, a format the field enforces, a live count),
 * never for a background explanation. A control whose label is hidden (or that has none) shows its hint inline whatever the mode.
 */
export type HintMode = 'tip' | 'inline';

/** The `aria-describedby` of a control: the ids of its hint and its error, when it has them. */
export function describedBy(id: string, hint: string | undefined, error: string | undefined): string | undefined {
  const ids = [has(hint) ? `${id}-hint` : '', has(error) ? `${id}-error` : ''].filter((value) => value !== '');
  return ids.length > 0 ? ids.join(' ') : undefined;
}

/** A hint kept for screen readers only (the `tip` mode): the target of the control's `aria-describedby`. */
export function HiddenHint({ id, text }: { id: string | undefined; text: string }): React.ReactElement {
  return (
    <span id={id} className="ui-visually-hidden">
      {text}
    </span>
  );
}

interface FieldProps {
  /** The id of the control. The label is `${id}-label`, the hint `${id}-hint` and the error `${id}-error`. */
  id: string;
  label: string;
  /** Keeps the label for screen readers but does not show it (a search box, a field whose purpose the layout already says). */
  hideLabel?: boolean;
  hint?: string;
  /** `tip` (default): the hint in an InfoTip after the label; `inline`: a visible line under the control (HintMode). */
  hintMode?: HintMode;
  error?: string;
  /** True when the control is a native input, so the label is a real <label for>. A custom control (Select) names itself with aria-labelledby instead. */
  native?: boolean;
  children: React.ReactNode;
}

/**
 * The frame of a form control: the label above, the control, then its hint and, when something is wrong, the error. Used inside
 * TextField, TextArea and Select; use it directly only to build another control of the same kind. With `hintMode="tip"` (the default)
 * the hint is an InfoTip after the label words: the label row (`.ui-label.ui-tip-row`) holds the label element and the tip side by side,
 * so the label's own text stays the control's accessible name.
 */
export function Field({
  id,
  label,
  hideLabel = false,
  hint,
  hintMode = 'tip',
  error,
  native = true,
  children
}: FieldProps): React.ReactElement {
  const tip = has(hint) && hintMode === 'tip' && !hideLabel;
  const className = hideLabel ? 'ui-visually-hidden' : 'ui-label';
  const labelElement = native ? (
    <label id={`${id}-label`} htmlFor={id} className={tip ? undefined : className}>
      {label}
    </label>
  ) : (
    <span id={`${id}-label`} className={tip ? undefined : className}>
      {label}
    </span>
  );
  return (
    <div className="ui-field">
      {tip ? (
        <div className="ui-label ui-tip-row">
          {labelElement}
          <InfoTip label={label}>{hint}</InfoTip>
        </div>
      ) : (
        labelElement
      )}
      {children}
      {has(hint) ? (
        tip ? (
          <HiddenHint id={`${id}-hint`} text={hint} />
        ) : (
          <p id={`${id}-hint`} className="ui-hint">
            {hint}
          </p>
        )
      ) : null}
      {has(error) ? (
        <p id={`${id}-error`} className="ui-error">
          <CircleAlert size={14} strokeWidth={2.25} aria-hidden="true" className="ui-error-icon" />
          {error}
        </p>
      ) : null}
    </div>
  );
}
