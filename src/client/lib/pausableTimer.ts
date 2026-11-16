// A one-shot timer that can be paused and resumed where it stopped: the life of a toast, which must not run out while the person points at
// it, has focus in it or looks at another tab (WCAG 2.2.1). The clock is a parameter so the logic can be tested without waiting.

export interface TimerClock {
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const realClock: TimerClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => {
    globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
  }
};

export interface PausableTimer {
  /** Stops the countdown; the time left is kept. Does nothing when paused, done or cancelled. */
  pause: () => void;
  /** Goes on from where it was paused. */
  resume: () => void;
  /** Stops for good: `onDone` is never called. */
  cancel: () => void;
  /** Milliseconds left (0 once done). */
  remaining: () => number;
  paused: () => boolean;
}

/** Calls `onDone` after `ms` of running time (time spent paused does not count). Starts running at once. */
export function createPausableTimer(ms: number, onDone: () => void, clock: TimerClock = realClock): PausableTimer {
  let left = Math.max(0, ms);
  let startedAt = clock.now();
  let handle: unknown;
  let state: 'running' | 'paused' | 'over' = 'running';

  const start = (): void => {
    startedAt = clock.now();
    handle = clock.setTimeout(() => {
      state = 'over';
      left = 0;
      onDone();
    }, left);
  };
  start();

  return {
    pause: () => {
      if (state !== 'running') {
        return;
      }
      clock.clearTimeout(handle);
      left = Math.max(0, left - (clock.now() - startedAt));
      state = 'paused';
    },
    resume: () => {
      if (state !== 'paused') {
        return;
      }
      state = 'running';
      start();
    },
    cancel: () => {
      if (state === 'running') {
        clock.clearTimeout(handle);
      }
      state = 'over';
    },
    remaining: () => (state === 'running' ? Math.max(0, left - (clock.now() - startedAt)) : left),
    paused: () => state === 'paused'
  };
}
