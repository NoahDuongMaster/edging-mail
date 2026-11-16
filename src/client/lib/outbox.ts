// Undo send (J6-02): a sent message waits in this browser for the seconds the person chose (Settings, `undoSend` in lib/prefs.ts: Off, 5,
// 10, 20, 30, 60 or 120 s) before it leaves, so Undo can still take it back. The compose closes at once; the app shows "Sending..." with
// Undo for that time, then "Message sent.". Nothing here touches the message: it only says when it may leave. A tab closed during the wait
// sends nothing: the draft the compose saved before it closed stays in Drafts (docs/mail-features.md).
// The wait is the "Sending..." toast's own time (J1-16, WCAG 2.2.1): the toast pauses the hold while it is pointed at, holds focus or the tab
// is hidden, exactly when its countdown bar stops, and resumes it with the time that was left. One pausable clock (lib/pausableTimer).

import { createPausableTimer, type PausableTimer, type TimerClock } from './pausableTimer';

/** One message held back before it leaves. */
export interface OutboxHold {
  /** Resolves true when the time is up (the message leaves now), false when it was taken back with Undo. */
  readonly done: Promise<boolean>;
  /** Takes the message back before it leaves. False when it is too late (it has gone, or Undo was used already). */
  undo: () => boolean;
  /** Stops the clock (the toast is pointed at, holds focus or the tab is hidden): the message does not leave while it is paused. */
  pause: () => void;
  /** Goes on with the time that was left. */
  resume: () => void;
  /** Milliseconds left before it leaves (0 once it has gone or was taken back). */
  remaining: () => number;
}

/** The holds that are waiting now (a count: several messages can wait at once). */
let waiting = 0;

/** How many sent messages are still waiting for their Undo time to pass. */
export function pendingSends(): number {
  return waiting;
}

const noop = (): void => {
  // nothing to pause: the message left at once
};

/** Holds a message for `seconds` of running time (0: it leaves at once). `clock` is for the tests. */
export function holdForUndo(seconds: number, clock?: TimerClock): OutboxHold {
  if (seconds <= 0) {
    return { done: Promise.resolve(true), undo: () => false, pause: noop, resume: noop, remaining: () => 0 };
  }
  let settle: ((go: boolean) => void) | null = null;
  let open = true;
  let timer: PausableTimer | null = null;
  waiting += 1;
  const done = new Promise<boolean>((resolve) => {
    settle = resolve;
  });
  const finish = (go: boolean): boolean => {
    if (!open) {
      return false;
    }
    open = false;
    waiting -= 1;
    timer?.cancel();
    settle?.(go);
    return true;
  };
  const clockOfHold = createPausableTimer(seconds * 1000, () => finish(true), clock);
  timer = clockOfHold;
  return {
    done,
    undo: () => finish(false),
    pause: () => {
      clockOfHold.pause();
    },
    resume: () => {
      clockOfHold.resume();
    },
    remaining: () => (open ? clockOfHold.remaining() : 0)
  };
}

/** Thrown into a send that was taken back with Undo: nothing left, the compose is open again. */
export class SendUndone extends Error {
  constructor() {
    super('the send was undone');
    this.name = 'SendUndone';
  }
}
