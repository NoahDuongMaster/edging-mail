import React from 'react';
import { credentialErrorText, retryAfterOf } from './crypto/errors';

export interface Action {
  busy: boolean;
  /** The text of the last failure, in the UI language, or null. */
  error: string | null;
  /** Seconds a 429 asked the person to wait (null when the last failure was not one). */
  retryAfter: number | null;
  /** Runs `work`. Resolves with its result, or undefined when it failed (the error is then in `error`). Never rejects. */
  run: <T>(work: () => Promise<T>) => Promise<T | undefined>;
  clear: () => void;
}

/**
 * Busy flag and error text for one button or form of the sign-in, key and password screens. It does NOT go through react-query's useMutation:
 * a mutation keeps its variables in a cache for minutes, and a password or a code must never sit in one. The work is a closure, and nothing of
 * it is kept here. State updates after the screen unmounted are skipped.
 */
export function useAction(): Action {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [retryAfter, setRetryAfter] = React.useState<number | null>(null);
  const alive = React.useRef(true);
  React.useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const run = React.useCallback(async <T>(work: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    setRetryAfter(null);
    try {
      return await work();
    } catch (error_) {
      if (alive.current) {
        setError(credentialErrorText(error_));
        setRetryAfter(retryAfterOf(error_));
      }
      return undefined;
    } finally {
      if (alive.current) {
        setBusy(false);
      }
    }
  }, []);

  const clear = React.useCallback(() => {
    setError(null);
    setRetryAfter(null);
  }, []);

  return { busy, error, retryAfter, run, clear };
}
