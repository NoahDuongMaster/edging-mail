import React from 'react';

/**
 * A screen that shows a secret exactly once (the recovery codes of two-factor sign-in) holds the way out of the app until the person says the
 * secret is saved: Escape, the backdrop and the Close buttons of the Settings dialog, and the system Back button on a phone (`useBackStack`),
 * all wait. One count for the whole page, so the dialog and the history layer read the same answer.
 */
let holders = 0;
const listeners = new Set<() => void>();

function change(by: number): void {
  holders += by;
  for (const listener of listeners) {
    listener();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Holds the way out until the returned function is called (once; a second call does nothing). */
export function holdSecret(): () => void {
  let released = false;
  change(1);
  return () => {
    if (!released) {
      released = true;
      change(-1);
    }
  };
}

/** True while a screen shows a secret that cannot be shown again. */
export const isSecretHeld = (): boolean => holders > 0;

/** Re-renders with the answer of `isSecretHeld`. */
export function useSecretHeld(): boolean {
  return React.useSyncExternalStore(subscribe, isSecretHeld, isSecretHeld);
}

/** While `held` is true this component keeps the way out closed. Released when `held` turns false or the component goes away. */
export function useSecretHold(held: boolean): void {
  React.useEffect(() => {
    return held ? holdSecret() : undefined;
  }, [held]);
}
