import React from 'react';

/** Counts `seconds` down to 0 once per second; a new value restarts it. `null` is "nothing to wait for". */
export function useCountdown(seconds: number | null): number {
  const [left, setLeft] = React.useState(0);
  React.useEffect(() => {
    const until = Date.now() + Math.max(0, seconds ?? 0) * 1000;
    const remaining = () => Math.max(0, Math.ceil((until - Date.now()) / 1000));
    // State is set from timer callbacks only, never while the effect runs.
    const first = window.setTimeout(() => {
      setLeft(remaining());
    }, 0);
    if (seconds === null || seconds <= 0) {
      return () => {
        window.clearTimeout(first);
      };
    }
    const timer = window.setInterval(() => {
      const value = remaining();
      setLeft(value);
      if (value === 0) {
        window.clearInterval(timer);
      }
    }, 250);
    return () => {
      window.clearTimeout(first);
      window.clearInterval(timer);
    };
  }, [seconds]);
  return left;
}
