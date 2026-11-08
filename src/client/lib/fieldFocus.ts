import React from 'react';

// A form whose button is always pressable: a press while something is missing shows every field's error and moves the keyboard to the first
// field to fix, instead of a disabled button that never says what it waits for.

/** One field of a form, in the order of the form: its id and whether it keeps the form from going on. */
export type FieldState = readonly [id: string, invalid: boolean];

/** The id of the first field that keeps the form from going on, or undefined when none does. */
export const firstInvalid = (fields: readonly FieldState[]): string | undefined => fields.find(([, invalid]) => invalid)?.[0];

const byId = (id: string): HTMLElement | null => document.querySelector<HTMLElement>(`#${CSS.escape(id)}`);

/**
 * Moves the keyboard to a field and brings it into view with what it says about itself: first the lowest of the texts that describe it (its
 * error, a password's verdict), then its label, so both are in sight when they fit and the label wins when they do not. Scrolling keeps to
 * the scroll padding of the page, which holds a field clear of a docked footer (the Continue bar of Setup, auth.css).
 */
export function focusField(id: string): void {
  const input = byId(id);
  if (input === null) {
    return;
  }
  input.focus({ preventScroll: true });
  const notes = (input.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .map((ref) => (ref === '' ? null : byId(ref)))
    .filter((note): note is HTMLElement => note !== null);
  const lowest = notes.reduce<HTMLElement>(
    (low, note) => (note.getBoundingClientRect().bottom > low.getBoundingClientRect().bottom ? note : low),
    input
  );
  lowest.scrollIntoView({ block: 'nearest' });
  const label = input instanceof HTMLInputElement ? input.labels?.[0] : undefined;
  (label ?? input).scrollIntoView({ block: 'nearest' });
}

/** `focusField` once the next render is on the page: the errors that a press reveals move the fields down, so the scroll is measured after them. */
export function useFieldFocus(): (id: string) => void {
  const [request, setRequest] = React.useState<{ id: string } | null>(null);
  React.useEffect(() => {
    if (request !== null) {
      focusField(request.id);
    }
  }, [request]);
  return React.useCallback((id: string) => {
    setRequest({ id });
  }, []);
}
