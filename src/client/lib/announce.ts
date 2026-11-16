// Status messages for screen readers (WCAG 4.1.3): "Archived", "Message sent.", "3 results", "2 new messages". They go into ONE
// polite `role="status"` region (or, for failures, one `role="alert"` region) that `components/LiveRegion.tsx` mounts with the first
// render. A live region that appears together with its text is often not read at all, so no screen makes its own for these.

export type Politeness = 'polite' | 'assertive';

export interface Announcement {
  readonly text: string;
  /** Changes with every announcement, so the same text said twice is two announcements. */
  readonly id: number;
}

const EMPTY: Announcement = Object.freeze({ text: '', id: 0 });

/** How long the region is emptied before the next text goes in: a screen reader hears the same text again only after a change. */
export const ANNOUNCE_GAP_MS = 100;
/** The text is taken out again after this, so a reader that walks the page later does not find an old status at its end. */
export const ANNOUNCE_CLEAR_MS = 7000;

const current: Record<Politeness, Announcement> = { polite: EMPTY, assertive: EMPTY };
const timers: Record<Politeness, ReturnType<typeof setTimeout> | undefined> = { polite: undefined, assertive: undefined };
const listeners = new Set<() => void>();
let counter = 0;

function set(politeness: Politeness, next: Announcement): void {
  current[politeness] = next;
  for (const listener of listeners) {
    listener();
  }
}

/**
 * Says `text` to screen readers without moving focus: politely (after what is being read), or at once with `assertive` (failures that
 * need attention). Already translated text only. An empty text does nothing.
 */
export function announce(text: string, options?: { assertive?: boolean }): void {
  const trimmed = text.trim();
  if (trimmed === '') {
    return;
  }
  const politeness: Politeness = options?.assertive === true ? 'assertive' : 'polite';
  clearTimeout(timers[politeness]);
  counter += 1;
  const id = counter;
  // Empty first, then the text: the region changes even when the text is the same as the last one.
  set(politeness, { text: '', id });
  timers[politeness] = setTimeout(() => {
    set(politeness, { text: trimmed, id });
    timers[politeness] = setTimeout(() => {
      set(politeness, { text: '', id });
    }, ANNOUNCE_CLEAR_MS);
  }, ANNOUNCE_GAP_MS);
}

/** What one region says now. */
export function announcement(politeness: Politeness): Announcement {
  return current[politeness];
}

/** Calls `listener` whenever a region's text changes. Returns the unsubscribe. */
export function subscribeAnnouncements(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Empties both regions and stops pending texts (sign-out; tests). */
export function resetAnnouncements(): void {
  for (const politeness of ['polite', 'assertive'] as const) {
    clearTimeout(timers[politeness]);
    timers[politeness] = undefined;
    set(politeness, EMPTY);
  }
}
