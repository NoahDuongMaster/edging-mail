import React from 'react';

// The title of the browser tab per view (WCAG 2.4.2): "Inbox (2) - Edging Mail", "Settings - Edging Mail". Every screen that is a view
// of its own calls `useDocumentTitle`; the one opened last wins (Settings over the mailbox), and when it closes the one under it comes
// back. With none, the page keeps the title it loaded with (index.html).

/** The product name: never translated. */
export const APP_NAME = 'Edging Mail';
const SEPARATOR = ' - ';

/**
 * "Security - Settings - Edging Mail": the parts of a view from the most specific, then the app; empty parts are skipped. A last part that
 * already names the app ("Set up Edging Mail") is the whole title: the name is not said twice.
 */
export function documentTitle(parts: readonly (string | null | undefined | false)[]): string {
  const named = parts.filter((part): part is string => typeof part === 'string' && part.trim() !== '').map((part) => part.trim());
  return (named.at(-1)?.includes(APP_NAME) === true ? named : [...named, APP_NAME]).join(SEPARATOR);
}

interface Entry {
  readonly owner: string;
  title: string;
  /** When it became active: the latest one is on top. A title that only changes its text (a count) keeps its place. */
  readonly since: number;
}

const entries: Entry[] = [];
let activations = 0;
let original: string | null = null;

function show(): void {
  if (typeof document === 'undefined') {
    return;
  }
  original ??= document.title;
  const top = entries.reduce<Entry | null>((best, entry) => (best === null || entry.since > best.since ? entry : best), null);
  const next = top?.title ?? original;
  if (document.title !== next) {
    document.title = next;
  }
}

/** Sets (or, with null, withdraws) the title of `owner`. Exported for the tests; screens use the hook. */
export function setViewTitle(owner: string, title: string | null): void {
  const index = entries.findIndex((entry) => entry.owner === owner);
  if (title === null) {
    if (index !== -1) {
      entries.splice(index, 1);
    }
  } else if (index === -1) {
    activations += 1;
    entries.push({ owner, title, since: activations });
  } else {
    entries[index].title = title;
  }
  show();
}

/** The title the tab shows now, or null when no view has set one. For the tests. */
export function currentViewTitle(): string | null {
  const top = entries.reduce<Entry | null>((best, entry) => (best === null || entry.since > best.since ? entry : best), null);
  return top?.title ?? null;
}

/**
 * Names the browser tab after this view while it is shown: `useDocumentTitle([tr('folder.inbox')])` gives "Inbox - Edging Mail".
 * `null` (a closed dialog) withdraws the title, and so does unmounting.
 */
export function useDocumentTitle(parts: readonly (string | null | undefined | false)[] | null): void {
  const owner = React.useId();
  const title = parts === null ? null : documentTitle(parts);
  React.useEffect(() => {
    setViewTitle(owner, title);
  }, [owner, title]);
  React.useEffect(
    () => () => {
      setViewTitle(owner, null);
    },
    [owner]
  );
}
