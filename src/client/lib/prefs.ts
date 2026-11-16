import React from 'react';

// The preferences of this device (not of the account): how much the app may move, and whether keys pressed on their own are shortcuts.
// They are kept in localStorage, read before the first render (main.tsx calls applyMotionPref next to applyTheme), and shared by every
// screen through `usePrefs()`. Another tab of the app that changes one is followed through the `storage` event.

/** 'system' follows `prefers-reduced-motion`; 'reduce' turns motion down on this device whatever the system says. */
export type MotionPref = 'system' | 'reduce';

/** How tall a message row is: 'comfortable' (avatar, three lines) or 'compact' (one line per message, more rows on screen). */
export type DensityPref = 'comfortable' | 'compact';

/**
 * How long a sent message waits in this browser before it leaves, so Undo can take it back. 0 sends at once. Up to 120 s, twelve times the
 * 10 s default (WCAG 2.2.1 "Adjust": at least ten times the default; J1-16).
 */
export const UNDO_SEND_CHOICES = [0, 5, 10, 20, 30, 60, 120] as const;
export type UndoSendSeconds = (typeof UNDO_SEND_CHOICES)[number];

export interface DevicePrefs {
  readonly motion: MotionPref;
  /** Single-key shortcuts (`/`, `c`, `j`, `k`): on by default, can be turned off (WCAG 2.1.4). Shortcuts with Ctrl/Cmd stay. */
  readonly shortcuts: boolean;
  readonly density: DensityPref;
  /** Seconds a sent message can still be taken back with Undo (WCAG 2.2.1: the person chooses the length, or turns it off). */
  readonly undoSend: UndoSendSeconds;
}

/** The localStorage key of the preferences (one JSON object). */
export const PREFS_STORAGE_KEY = 'edging-mail-prefs';

export const DEFAULT_PREFS: DevicePrefs = Object.freeze({ motion: 'system', shortcuts: true, density: 'comfortable', undoSend: 10 });

/** The preferences in a stored text: anything missing, unknown or unreadable takes its default. */
export function parsePrefs(raw: string | null): DevicePrefs {
  if (raw === null || raw === '') {
    return DEFAULT_PREFS;
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return DEFAULT_PREFS;
  }
  if (typeof value !== 'object' || value === null) {
    return DEFAULT_PREFS;
  }
  const stored = value as Partial<Record<keyof DevicePrefs, unknown>>;
  return {
    motion: stored.motion === 'reduce' ? 'reduce' : 'system',
    shortcuts: typeof stored.shortcuts === 'boolean' ? stored.shortcuts : DEFAULT_PREFS.shortcuts,
    density: stored.density === 'compact' ? 'compact' : 'comfortable',
    undoSend: UNDO_SEND_CHOICES.find((seconds) => seconds === stored.undoSend) ?? DEFAULT_PREFS.undoSend
  };
}

/** localStorage, or null where there is none (the server render, a browser that blocks storage). */
function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readStored(): DevicePrefs {
  try {
    return parsePrefs(storage()?.getItem(PREFS_STORAGE_KEY) ?? null);
  } catch {
    return DEFAULT_PREFS;
  }
}

// One snapshot object until something changes, as useSyncExternalStore requires.
let snapshot: DevicePrefs | null = null;
const listeners = new Set<() => void>();

/** The preferences as they are now. */
export function readPrefs(): DevicePrefs {
  snapshot ??= readStored();
  return snapshot;
}

function publish(next: DevicePrefs): void {
  snapshot = next;
  applyMotionPref(next);
  applyDensityPref(next);
  for (const listener of listeners) {
    listener();
  }
}

/** Changes one preference, stores it (a browser that refuses storage keeps it for this visit) and tells every screen. */
export function setPref<K extends keyof DevicePrefs>(key: K, value: DevicePrefs[K]): void {
  const next: DevicePrefs = { ...readPrefs(), [key]: value };
  try {
    storage()?.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // storage full or blocked: the choice still holds until the page is closed
  }
  publish(next);
}

/** Forgets the snapshot so the next read comes from storage again (another tab wrote it; tests). */
export function reloadPrefs(): void {
  publish(readStored());
}

function onStorage(event: StorageEvent): void {
  if (event.key === PREFS_STORAGE_KEY || event.key === null) {
    reloadPrefs();
  }
}

/** Calls `listener` whenever a preference changes, here or in another tab. Returns the unsubscribe. */
export function subscribePrefs(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1 && typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
    }
  };
}

const serverPrefs = (): DevicePrefs => DEFAULT_PREFS;

/** The preferences as React state: the component renders again when one changes. The defaults on the server. */
export function usePrefs(): DevicePrefs {
  return React.useSyncExternalStore(subscribePrefs, readPrefs, serverPrefs);
}

/**
 * Makes the motion choice visible to CSS and to `ui/motion.ts`: `data-motion="reduce"` on <html> for 'reduce', no attribute for
 * 'system' (the media query decides then). Call it before the first render so nothing moves once before the choice applies.
 */
export function applyMotionPref(prefs: DevicePrefs = readPrefs()): void {
  if (typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  if (prefs.motion === 'reduce') {
    root.dataset.motion = 'reduce';
  } else {
    delete root.dataset.motion;
  }
}

/** Makes the row density visible to CSS: `data-density="compact"` on <html>, no attribute for the comfortable default. */
export function applyDensityPref(prefs: DevicePrefs = readPrefs()): void {
  if (typeof document === 'undefined') {
    return;
  }
  const root = document.documentElement;
  if (prefs.density === 'compact') {
    root.dataset.density = 'compact';
  } else {
    delete root.dataset.density;
  }
}
