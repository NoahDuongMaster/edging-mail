import React from 'react';
import { CircleAlert, CircleCheck, Send, X } from 'lucide-react';
import { DURATION, EASING } from '../../shared/design/tokens';
import type { ThemeTokens } from '../theme';
import { announce, resetAnnouncements } from '../lib/announce';
import { tr as translate, useT } from '../lib/i18n';
import { createPausableTimer, type PausableTimer } from '../lib/pausableTimer';
import { isUndoShortcut } from '../lib/shortcuts';
import { motionReduced } from '../ui/motion';
import './toast.css';

/** A desktop toast's left edge: 16px inside the list sheet (the rail is --mb-rail-w wide, mailbox.css), and the room it has to the right. */
const DESK_LEFT = 'calc(var(--mb-rail-w, 264px) + 16px)';
const DESK_ROOM = 'calc(100vw - var(--mb-rail-w, 264px) - 48px)';

export interface ToastState {
  text: string;
  /** Takes the action back. It may return a promise: focus moves on (`returnFocus`) once that has settled. */
  undo?: () => unknown;
  /**
   * Where focus goes after Undo (the restored row, else the list), and after the toast closes while it held focus. Called when needed,
   * so it can look for an element that is only there once the undo has landed.
   */
  returnFocus?: () => HTMLElement | null;
  /** A failure: it has no timer (it stays until dismissed or replaced, WCAG 2.2.1) and it is read out at once (the alert region). */
  error?: boolean;
  /**
   * How long it stays (ms) when the default does not fit: "Sending..." stays the whole undo-send time (5 to 30 s), so its Undo lasts as
   * long as the wait. It pauses on hover, focus and a hidden tab as every toast does.
   */
  duration?: number;
  /**
   * The words of the action button when it is not an Undo ("Open" on "Draft saved"). Such an action is not an undo, so Ctrl/Cmd+Z does not
   * run it and the toast does not mention that key.
   */
  actionLabel?: string;
  /**
   * A held action behind the toast (undo send, lib/outbox.ts), J1-16: its clock is this toast's clock. The toast pauses it exactly when
   * its own countdown stops (hover, focus in it, a hidden tab) and resumes it with the time left; it has no timer of its own, and when
   * `done` settles (the message is on its way) the Undo goes and the words stay until what comes next replaces them ("Message sent.").
   * Its icon is the neutral Send (J6-35): it has not happened yet. Replaced or dismissed, it lets the hold run on.
   */
  hold?: { pause: () => void; resume: () => void; done: Promise<unknown> };
  /** What a keyboard user hears instead of "{text}. Press Ctrl+Z to undo." ("Sending… Press Undo or Ctrl+Z to take it back."). */
  undoHint?: string;
}

/** Longer than this, a toast with an Undo puts its actions under the words on a phone (about two lines of the words beside the Undo and the X at 390px). */
const STACK_FROM_CHARS = 28;
/** How long a toast with nothing to undo stays while nobody points at it or has focus in it. */
export const TOAST_MS = 6000;
/** How long a toast with Undo stays (research/02 M3: 8 s for an action; the time is the Undo's window, and it pauses as the others do). */
export const TOAST_UNDO_MS = 8000;
/** Its exit (0.7 of the 200 ms entrance), played before it is gone. */
export const TOAST_EXIT_MS = 140;

interface ToastProps {
  /** The theme (kept for the callers; the toast's colours are the variables of toast.css now). */
  t?: ThemeTokens;
  toast: ToastState | null;
  onDismiss: () => void;
  /** Phone list pane: sit above the floating Compose button instead of covering part of it. */
  raised?: boolean;
  /** Desktop layout: bottom-left of the list column, clear of the reader toolbar that sits bottom-centre. */
  desktop?: boolean;
  /** Where focus goes when a toast that holds focus closes and its state names no `returnFocus` (the list). */
  fallbackFocus?: () => HTMLElement | null;
}

type PauseReason = 'hover' | 'focus' | 'hidden';

const ENTER: Keyframe[] = [
  { opacity: 0, transform: 'translateY(8px)' },
  { opacity: 1, transform: 'translateY(0)' }
];
const LEAVE: Keyframe[] = [
  { opacity: 1, transform: 'translateY(0)' },
  { opacity: 0, transform: 'translateY(8px)' }
];
const FADE_IN: Keyframe[] = [{ opacity: 0 }, { opacity: 1 }];
const FADE_OUT: Keyframe[] = [{ opacity: 1 }, { opacity: 0 }];
const COUNTDOWN: Keyframe[] = [{ transform: 'scaleX(1)' }, { transform: 'scaleX(0)' }];

/** Element.animate on an element that may not be there: the motion is a layer on top, nothing waits for it. */
function play(el: Element | null, frames: Keyframe[], options: KeyframeAnimationOptions): Animation | null {
  return el?.animate(frames, options) ?? null;
}

/** Its action takes something back (an Undo): Ctrl/Cmd+Z runs it. An action with words of its own ("Open") is not one. */
const isUndo = (toast: ToastState): boolean => toast.undo !== undefined && toast.actionLabel === undefined;

/** A keyboard user is told about Ctrl+Z; on a phone (no keyboard to speak of) the toast's text is enough. */
function spokenText(toast: ToastState): string {
  const keyboard = typeof window !== 'undefined' && window.matchMedia('(any-pointer: fine)').matches;
  if (!isUndo(toast) || !keyboard) {
    return toast.text;
  }
  return toast.undoHint ?? translate('toast.undo_hint', { text: toast.text });
}

/** How long a toast stays: a failure until dismissed (0), else its own duration, else 8 s with an action and 6 s without. */
function lifetimeOf(toast: ToastState): number {
  if (toast.error === true) {
    return 0;
  }
  return toast.duration ?? (toast.undo === undefined ? TOAST_MS : TOAST_UNDO_MS);
}

/**
 * Focus what `target` names as soon as it is there (it may be a row that only comes back once the undo has been drawn), checking once a
 * frame for up to a second; then `fallback` (the list) instead, so focus never stays on <body>. `visible`: the person used the keyboard,
 * so the focus ring shows where they landed (a script's focus alone would not draw it).
 */
function focusWhenThere(
  target: (() => HTMLElement | null) | undefined,
  fallback: (() => HTMLElement | null) | undefined,
  visible: boolean
): void {
  const start = performance.now();
  const attempt = () => {
    const el = target?.() ?? null;
    if (el !== null) {
      el.focus({ focusVisible: visible });
    } else if (target !== undefined && performance.now() - start < 1000) {
      window.requestAnimationFrame(attempt);
    } else {
      fallback?.()?.focus({ focusVisible: visible });
    }
  };
  window.requestAnimationFrame(attempt);
}

/**
 * A short message with an Undo when the action can be taken back. It goes away by itself (8 seconds with an Undo, 6 without), but the time
 * stops while the pointer is over it, focus is in it or the tab is hidden, and goes on from where it was (WCAG 2.2.1); a 2 px bar shows the
 * time left and stops with it. A failure stays until it is dismissed. Ctrl/Cmd+Z is Undo while it is shown (not while typing in a field),
 * and the X dismisses it. Its text is read through the app's live region (`lib/announce`), never by a region made with it.
 * It is the landing's notification card (toast.css): the surface, a hairline, the layered pop shadow, an icon in the accent (a check) or the
 * danger colour (a failure), the Undo and the bar in the one indicator blue. Enter: fade + 8 px rise in 200 ms, only when no toast is on
 * screen; a toast that replaces the one on screen keeps the card where it is and cross-fades its words (150 ms), restarting the bar and
 * the time. Exit 140 ms; reduced motion: fades only, no bar.
 */
export const Toast: React.FC<ToastProps> = ({ toast, onDismiss, raised = false, desktop = false, fallbackFocus }) => {
  const tr = useT();
  // App passes new callbacks on every render: the timer must not restart each time (an Undo toast would never expire).
  const dismissRef = React.useRef(onDismiss);
  const fallbackRef = React.useRef(fallbackFocus);
  // The toast on screen now, for the end of an exit that a newer toast may have overtaken.
  const shownRef = React.useRef(toast);
  React.useLayoutEffect(() => {
    dismissRef.current = onDismiss;
    fallbackRef.current = fallbackFocus;
    shownRef.current = toast;
  }, [onDismiss, fallbackFocus, toast]);

  const rootRef = React.useRef<HTMLDivElement | null>(null);
  const textRef = React.useRef<HTMLSpanElement | null>(null);
  const barRef = React.useRef<HTMLSpanElement | null>(null);
  const timerRef = React.useRef<PausableTimer | null>(null);
  const barMotion = React.useRef<Animation | null>(null);
  const exitMotion = React.useRef<Animation | null>(null);
  const closingRef = React.useRef<ToastState | null>(null);
  // The toast the card showed before this one, and the card's element then (another element, or none before: the card is new, so it enters).
  const previous = React.useRef<{ toast: ToastState; card: HTMLDivElement | null } | null>(null);
  const reasons = React.useRef(new Set<PauseReason>());
  // The held action of the toast on screen (undo send): paused and resumed with it.
  const holdRef = React.useRef<ToastState['hold'] | null>(null);
  // A held toast whose time is over (the message is on its way): no Undo any more, the words stay until they are replaced.
  const [spent, setSpent] = React.useState<ToastState | null>(null);
  const spentRef = React.useRef<ToastState | null>(null);
  // The control that lost focus with no new focus (to <body>): either the person left (it is still there a frame later) or React took it
  // out of the card (an Undo the next toast does not have); in that case focus stays in the card.
  const droppedRef = React.useRef<Element | null>(null);

  const applyPause = React.useCallback(() => {
    const paused = reasons.current.size > 0;
    rootRef.current?.toggleAttribute('data-paused', paused);
    if (closingRef.current !== null) {
      return;
    }
    if (paused) {
      timerRef.current?.pause();
      barMotion.current?.pause();
      holdRef.current?.pause();
    } else {
      timerRef.current?.resume();
      holdRef.current?.resume();
      if (barMotion.current?.playState === 'paused') {
        barMotion.current.play();
      }
    }
  }, []);

  const setPaused = React.useCallback(
    (reason: PauseReason, on: boolean) => {
      if (on) {
        reasons.current.add(reason);
      } else {
        reasons.current.delete(reason);
      }
      applyPause();
    },
    [applyPause]
  );

  // A new element (the toast came back after none) starts with nothing over it or in it: a pointer or focus that left with the old
  // element never said goodbye. (Whether the card is new is told by its element, in the effect below, not here: StrictMode detaches and
  // re-attaches the ref of a new element once in development, which would make every replacement look like a new card.)
  const setRoot = React.useCallback((node: HTMLDivElement | null) => {
    rootRef.current = node;
    if (node === null) {
      reasons.current.delete('hover');
      reasons.current.delete('focus');
      droppedRef.current = null;
    }
  }, []);

  // Plays the exit, then tells App. Focus that was in the toast goes where the toast says (or the list) instead of to <body>.
  const close = React.useCallback(
    (refocus: boolean, byKeyboard = false) => {
      if (toast === null || closingRef.current === toast) {
        return;
      }
      closingRef.current = toast;
      timerRef.current?.cancel();
      barMotion.current?.pause();
      const root = rootRef.current;
      const hadFocus = root?.contains(document.activeElement) === true;
      exitMotion.current = play(root, motionReduced() ? FADE_OUT : LEAVE, {
        duration: TOAST_EXIT_MS,
        easing: EASING.exit,
        fill: 'forwards'
      });
      const closing = toast;
      window.setTimeout(() => {
        if (shownRef.current === closing) {
          dismissRef.current();
        }
      }, TOAST_EXIT_MS);
      if (refocus && hadFocus) {
        focusWhenThere(closing.returnFocus, fallbackRef.current, byKeyboard);
      }
    },
    [toast]
  );

  const runUndo = React.useCallback(
    (byKeyboard: boolean) => {
      if (toast?.undo === undefined || closingRef.current === toast || spentRef.current === toast) {
        return;
      }
      const { undo, returnFocus } = toast;
      close(false);
      // Focus follows the restored mail once the undo has landed (M3), from the button or from Ctrl+Z alike.
      void Promise.resolve()
        .then(undo)
        .catch((error: unknown) => {
          console.error('Undo failed', error);
        })
        .then(() => {
          focusWhenThere(returnFocus, fallbackRef.current, byKeyboard);
        });
    },
    [toast, close]
  );

  // One lifetime per toast: announce it, play its entrance (or, replacing one on screen, cross-fade its words) and its countdown, run its
  // timer, and listen for the pointer and focus on it (they pause it), a hidden tab (pauses it too) and Ctrl+Z.
  React.useEffect(() => {
    if (toast === null) {
      return;
    }
    const last = previous.current;
    const before = last !== null && last.card === rootRef.current ? last.toast : null;
    previous.current = { toast, card: rootRef.current };
    closingRef.current = null;
    // A toast that comes while the last one is leaving takes the card back at once (the exit's end state would hide it).
    exitMotion.current?.cancel();
    exitMotion.current = null;
    // J4-43: a toast that turns into its failure (the request behind it failed: offline, a server error) takes back what it said, so only the
    // failure is heard, never Archived after No connection: nothing was changed.
    if (before !== null && toast.error === true && before.error !== true) {
      resetAnnouncements();
    }
    announce(spokenText(toast), { assertive: toast.error === true });

    const reduced = motionReduced();
    const ms = lifetimeOf(toast);
    if (before === null) {
      play(rootRef.current, reduced ? FADE_IN : ENTER, { duration: reduced ? DURATION.quick : DURATION.base, easing: EASING.enter });
    } else if (before.text !== toast.text || before.error !== toast.error) {
      // J2-03: the card stays put; only its words change, in a 150 ms cross-fade (the same words: nothing moves at all).
      play(textRef.current, FADE_IN, { duration: DURATION.quick, easing: EASING.standard });
    }
    barMotion.current = reduced || ms === 0 ? null : play(barRef.current, COUNTDOWN, { duration: ms, easing: 'linear', fill: 'forwards' });
    // A held toast (undo send) has no timer of its own: the hold is the clock, paused and resumed with the bar (J1-16).
    const hold = toast.hold;
    holdRef.current = hold ?? null;
    let current = true;
    timerRef.current =
      ms === 0 || hold !== undefined
        ? null
        : createPausableTimer(ms, () => {
            close(true);
          });
    void hold?.done.then(() => {
      if (current) {
        spentRef.current = toast;
        setSpent(toast);
      }
    });
    // Pointer and focus pause no interaction of their own (nothing to operate), so they are listened to on the element directly.
    const root = rootRef.current;
    const onEnter = () => setPaused('hover', true);
    const onLeave = () => setPaused('hover', false);
    const onFocusIn = () => setPaused('focus', true);
    const onFocusOut = (event: FocusEvent) => {
      if (!(event.relatedTarget instanceof Node && root?.contains(event.relatedTarget) === true)) {
        setPaused('focus', false);
      }
      const left = event.target;
      if (event.relatedTarget === null && left instanceof Element) {
        droppedRef.current = left;
        window.requestAnimationFrame(() => {
          if (left.isConnected && droppedRef.current === left) {
            droppedRef.current = null;
          }
        });
      }
    };
    root?.addEventListener('pointerenter', onEnter);
    root?.addEventListener('pointerleave', onLeave);
    root?.addEventListener('focusin', onFocusIn);
    root?.addEventListener('focusout', onFocusOut);
    // The focused control went with the toast it belonged to (the Undo of "Sending...", which "Message sent." does not have): focus stays
    // in the card, on its X, instead of falling to <body> (J1-16).
    const active = document.activeElement;
    if (before !== null && (droppedRef.current !== null || reasons.current.has('focus')) && (active === null || active === document.body)) {
      root?.querySelector<HTMLElement>('.tst-dismiss')?.focus();
    }
    droppedRef.current = null;
    // Focus may still be in the element a newer toast took over.
    reasons.current.delete('focus');
    if (root?.contains(document.activeElement) === true) {
      reasons.current.add('focus');
    }
    const onVisibility = () => setPaused('hidden', document.visibilityState === 'hidden');
    onVisibility();
    document.addEventListener('visibilitychange', onVisibility);

    const onKey = (event: KeyboardEvent) => {
      if (isUndoShortcut(event, event.target instanceof HTMLElement ? event.target : null)) {
        event.preventDefault();
        runUndo(true);
      }
    };
    if (isUndo(toast)) {
      window.addEventListener('keydown', onKey);
    }
    return () => {
      current = false;
      timerRef.current?.cancel();
      timerRef.current = null;
      barMotion.current?.cancel();
      barMotion.current = null;
      // Replaced or gone: the held action runs on with the time it has left (nothing on screen pauses it any more).
      holdRef.current = null;
      hold?.resume();
      root?.removeEventListener('pointerenter', onEnter);
      root?.removeEventListener('pointerleave', onLeave);
      root?.removeEventListener('focusin', onFocusIn);
      root?.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keydown', onKey);
    };
  }, [toast, close, runUndo, setPaused]);

  if (!toast) {
    return null;
  }

  const held = toast.hold !== undefined;
  // J6-35: "Sending..." has not happened yet: the neutral Send glyph; the check is for what is done.
  const Icon = toast.error === true ? CircleAlert : held ? Send : CircleCheck;
  const canAct = toast.undo !== undefined && spent !== toast;
  // A long text beside an Undo and an X leaves the words a sliver of a phone's width (8 lines at 320px): from this length the actions take a row of
  // their own under the words (toast.css, phone widths only).
  const stacked = canAct && toast.text.length > STACK_FROM_CHARS;
  return (
    <div
      ref={setRoot}
      className="ui-toast tst-root"
      data-error={toast.error === true ? 'true' : undefined}
      data-held={held ? 'true' : undefined}
      data-stacked={stacked ? 'true' : undefined}
      style={{
        // A desktop: 16px inside the list sheet's bottom-left corner (the rail's width, mailbox.css --mb-rail-w, and 16px). A phone centres
        // with auto margins, not a transform: the entrance animates `transform`, which would drop a translateX(-50%) while it runs and make
        // the toast jump sideways.
        ...(desktop ? { left: DESK_LEFT } : { left: 0, right: 0, marginInline: 'auto' }),
        bottom: raised ? 'calc(104px + env(safe-area-inset-bottom, 0px))' : 28,
        maxWidth: desktop ? DESK_ROOM : 'calc(100vw - 32px)',
        // J2-16: one width for the common words ("Archived", "Moved to Trash", "Sending…", "Message sent." and their vi/zh-CN forms), so
        // a replaced toast keeps its Undo and X where they were; only a longer text widens it. Never wider than the space it has.
        minWidth: desktop ? `min(20rem, ${DESK_ROOM})` : 'min(20rem, calc(100vw - 32px))'
      }}
    >
      <Icon size={18} strokeWidth={1.75} aria-hidden="true" className="tst-icon" />
      <span ref={textRef} className="ui-toast-text">
        {toast.text}
      </span>
      {canAct ? (
        <button
          type="button"
          className="ui-toast-action tst-undo nm-tap-h"
          aria-keyshortcuts={isUndo(toast) ? 'Control+Z Meta+Z' : undefined}
          // A click with no pointer behind it (detail 0) is Enter or Space: the keyboard.
          onClick={(e) => runUndo(e.detail === 0)}
        >
          {toast.actionLabel ?? tr('toast.undo')}
        </button>
      ) : null}
      <button type="button" className="tst-dismiss nm-tap" aria-label={tr('toast.dismiss')} onClick={(e) => close(true, e.detail === 0)}>
        <X size={16} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {/* While a send is held, the countdown is the airmail edge whose stripes slide (DESIGN-v3 H6); else the indicator bar. */}
      {toast.error === true ? null : (
        <span ref={barRef} aria-hidden="true" className={held ? 'tst-bar ui-airmail' : 'tst-bar'} data-moving={held ? '' : undefined} />
      )}
    </div>
  );
};
