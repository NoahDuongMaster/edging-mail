/**
 * Moves the keyboard (and a screen reader) to the first visible title of the page: the heading of the screen that has just appeared. A heading takes
 * focus only through script (`tabindex=-1`), so it is never a stop of the Tab key; the next Tab goes to the first control after it. Nothing happens
 * when the page has no visible `h1` (a phone shows one of two, the other is `display: none`).
 */
export function focusFirstTitle(): void {
  for (const heading of document.querySelectorAll<HTMLElement>('h1')) {
    if (heading.getClientRects().length > 0) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      return;
    }
  }
}
