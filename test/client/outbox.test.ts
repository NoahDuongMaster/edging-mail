import { describe, expect, it } from 'vitest';
import { holdForUndo, pendingSends } from '../../src/client/lib/outbox';
import type { TimerClock } from '../../src/client/lib/pausableTimer';

// Undo send (lib/outbox.ts, J1-16): the wait before a sent message leaves is the "Sending..." toast's own time. The toast pauses the hold
// while it is pointed at, holds focus or the tab is hidden, and resumes it with the time that was left, so the bar and the real deadline
// agree (WCAG 2.2.1). The wiring to the toast's pause hooks is for the browser check; here the hold's clock is moved by hand.

/** A clock the test moves by hand. */
function manualClock(): TimerClock & { advance: (ms: number) => void } {
  let now = 0;
  let pending: { at: number; callback: () => void; handle: number }[] = [];
  let handles = 0;
  return {
    now: () => now,
    setTimeout: (callback, ms) => {
      handles += 1;
      pending.push({ at: now + ms, callback, handle: handles });
      return handles;
    },
    clearTimeout: (handle) => {
      pending = pending.filter((entry) => entry.handle !== handle);
    },
    advance: (ms) => {
      now += ms;
      const due = pending.filter((entry) => entry.at <= now);
      pending = pending.filter((entry) => entry.at > now);
      for (const entry of due) {
        entry.callback();
      }
    }
  };
}

/** Whether the promise has settled yet, and with what (microtasks run first). */
async function state<T>(promise: Promise<T>): Promise<{ settled: boolean; value?: T }> {
  const marker = Symbol('pending');
  const value = await Promise.race([promise, Promise.resolve().then(() => marker)]);
  return value === marker ? { settled: false } : { settled: true, value: value as T };
}

describe('holdForUndo (the undo-send wait)', () => {
  it('lets the message leave after its time when nothing pauses it', async () => {
    const clock = manualClock();
    const hold = holdForUndo(10, clock);
    expect(pendingSends()).toBe(1);
    clock.advance(9999);
    expect(await state(hold.done)).toEqual({ settled: false });
    clock.advance(1);
    expect(await state(hold.done)).toEqual({ settled: true, value: true });
    expect(pendingSends()).toBe(0);
    expect(hold.undo()).toBe(false);
  });

  it('does not leave while paused (the toast is hovered or holds focus) and goes on with the time that was left', async () => {
    const clock = manualClock();
    const hold = holdForUndo(10, clock);
    clock.advance(4000);
    hold.pause();
    expect(hold.remaining()).toBe(6000);
    // Undo focused for a minute: the time does not run out under it.
    clock.advance(60_000);
    expect(await state(hold.done)).toEqual({ settled: false });
    expect(hold.remaining()).toBe(6000);
    hold.resume();
    clock.advance(5999);
    expect(await state(hold.done)).toEqual({ settled: false });
    clock.advance(1);
    expect(await state(hold.done)).toEqual({ settled: true, value: true });
    expect(hold.remaining()).toBe(0);
  });

  it('pauses and resumes any number of times, and a second pause or resume changes nothing', async () => {
    const clock = manualClock();
    const hold = holdForUndo(5, clock);
    for (let i = 0; i < 3; i += 1) {
      clock.advance(1000);
      hold.pause();
      hold.pause();
      clock.advance(30_000);
      hold.resume();
      hold.resume();
    }
    expect(hold.remaining()).toBe(2000);
    clock.advance(2000);
    expect(await state(hold.done)).toEqual({ settled: true, value: true });
  });

  it('is taken back by Undo while it waits, paused or not, and then never leaves', async () => {
    const clock = manualClock();
    const hold = holdForUndo(20, clock);
    clock.advance(3000);
    hold.pause();
    expect(hold.undo()).toBe(true);
    expect(await state(hold.done)).toEqual({ settled: true, value: false });
    expect(pendingSends()).toBe(0);
    hold.resume();
    clock.advance(60_000);
    expect(hold.undo()).toBe(false);
    expect(hold.remaining()).toBe(0);
  });

  it('sends at once when Undo send is off, and its pause and resume do nothing', async () => {
    const hold = holdForUndo(0);
    hold.pause();
    hold.resume();
    expect(await state(hold.done)).toEqual({ settled: true, value: true });
    expect(hold.undo()).toBe(false);
    expect(hold.remaining()).toBe(0);
    expect(pendingSends()).toBe(0);
  });
});
