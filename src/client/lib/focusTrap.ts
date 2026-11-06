const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [contenteditable="true"], [tabindex]:not([tabindex="-1"])';

/**
 * Keeps Tab and Shift+Tab inside a modal dialog: from the last control it wraps to the first and the other way round,
 * and a focus that sits outside the dialog (or on the dialog itself) is pulled in. Call it from the dialog's keydown handler.
 */
export function trapTab(event: Pick<KeyboardEvent, 'key' | 'shiftKey' | 'preventDefault'>, container: HTMLElement | null): void {
  if (event.key !== 'Tab' || container === null) {
    return;
  }
  // Hidden controls (display: none, collapsed panels) have no client rects and cannot take focus.
  const items = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((item) => item.getClientRects().length > 0);
  const first = items.at(0);
  const last = items.at(-1);
  if (first === undefined || last === undefined) {
    event.preventDefault();
    container.focus();
    return;
  }
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !container.contains(active) || active === container) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
  } else if (event.shiftKey && active === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
