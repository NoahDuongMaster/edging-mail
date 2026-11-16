import { DURATION, EASING } from '../../shared/design/tokens';
import { durationFor, exitDuration, motionReduced } from '../ui/motion';

// The motion of the mailbox shell that CSS cannot do alone (DESIGN.md section 3: M9 on a phone, M14, M1 played backwards): a phone pane or the
// drawer that goes away plays its exit on an inert copy of itself, left where it was for the length of the exit, while the real element is
// gone at once (focus, Escape and screen readers have already moved on). Under reduced motion every one of them is a short fade in place.

/** Waits for an animation; a cancelled one counts as done. */
async function settled(animation: Animation): Promise<void> {
  try {
    await animation.finished;
  } catch {
    // cancelled: nothing to wait for
  }
}

/** The scroll offsets of the scrollers inside `node`, by their place in `node`'s tree, so a copy can be scrolled the same. */
function scrollOffsets(node: HTMLElement): [number, number][] {
  return [...node.querySelectorAll<HTMLElement>('*')].flatMap((el, index): [number, number][] =>
    el.scrollTop > 0 ? [[index, el.scrollTop]] : []
  );
}

/**
 * A copy of `node` that nobody can reach: no ids, hidden from screen readers, inert, its animations stopped (ui.css `[data-leaving]`). A mail
 * frame inside it becomes an empty box of its size: a copy of the frame would load the mail again.
 */
function inertCopy(node: HTMLElement): HTMLElement | null {
  const copy = node.cloneNode(true);
  if (!(copy instanceof HTMLElement)) {
    return null;
  }
  for (const element of [copy, ...copy.querySelectorAll('[id]')]) {
    element.removeAttribute('id');
  }
  for (const frame of copy.querySelectorAll('iframe')) {
    const standIn = document.createElement('div');
    standIn.className = frame.className;
    frame.replaceWith(standIn);
  }
  copy.setAttribute('aria-hidden', 'true');
  copy.inert = true;
  copy.dataset.leaving = 'true';
  return copy;
}

type Play = (copy: HTMLElement, width: number) => Animation[];

/**
 * Leaves an inert copy of `node` where it is and plays `play` on it, then removes it. Call it while `node` is still on the page (the cleanup
 * of its ref, which React runs before it takes the element out); nothing happens when the element turns out to stay (React's StrictMode).
 * `pinned`: the copy is laid over the same box of its parent (a pane in a flex column); otherwise it keeps its own position (a fixed layer).
 * `exit`: a name for the copy (`data-pane-exit`), so the stylesheet can stack it under or over what comes.
 */
function leaveCopy(node: HTMLElement, options: { pinned: boolean; exit?: string }, play: Play): void {
  const parent = node.parentElement;
  if (parent === null) {
    return;
  }
  const next = node.nextSibling;
  const box = { top: node.offsetTop, left: node.offsetLeft, width: node.offsetWidth, height: node.offsetHeight };
  const offsets = scrollOffsets(node);
  const copy = inertCopy(node);
  if (copy === null || box.width === 0) {
    return;
  }
  queueMicrotask(() => {
    if (node.isConnected || !parent.isConnected) {
      return;
    }
    if (options.pinned) {
      copy.style.position = 'absolute';
      copy.style.top = `${box.top}px`;
      copy.style.left = `${box.left}px`;
      copy.style.width = `${box.width}px`;
      copy.style.height = `${box.height}px`;
    }
    if (options.exit !== undefined) {
      copy.dataset.paneExit = options.exit;
    }
    copy.style.pointerEvents = 'none';
    parent.insertBefore(copy, next !== null && next.parentNode === parent ? next : null);
    const all = [...copy.querySelectorAll<HTMLElement>('*')];
    for (const [index, top] of offsets) {
      const el = all.at(index);
      if (el !== undefined) {
        el.scrollTop = top;
      }
    }
    void Promise.all(play(copy, box.width).map(settled)).then(() => {
      copy.remove();
    });
  });
}

/**
 * Undo (M1 backwards): when the returning row's content starts to slide back in, after its slot has begun to open. The slot opens 200 ms on
 * the standard curve, so it is about 80 % open at 100 ms: the slide overlaps the opening as the forward M1 overlaps its collapse (J2-15).
 * The reader swaps to the restored mail at that moment too (App undoFor).
 */
export const RETURN_SLIDE_DELAY_MS = DURATION.base / 2;

/** A short fade, the reduced-motion form of every move here (110 ms: under the 150 ms that stays). */
function fade(el: Element, from: number, to: number): Animation {
  return el.animate([{ opacity: from }, { opacity: to }], { duration: DURATION.fast, easing: 'linear', fill: 'forwards' });
}

/** Which pane of a phone is shown: the list, or the open message. */
export type PhonePane = 'list' | 'reader';

/**
 * M9 on a phone, the pane that goes: opening a message pushes the list a quarter to the left and dims it while the reader slides over it;
 * Back slides the reader away to the right (0.7 of the time, the exit rule) and the list comes back from under it, both on ONE curve (the
 * standard one) for the same time, the list travelling a quarter of the reader's way: the push played backwards (J2-18).
 */
export function leavePane(node: HTMLElement, pane: PhonePane): void {
  leaveCopy(node, { pinned: true, exit: pane }, (copy, width) => {
    if (motionReduced()) {
      return [fade(copy, 1, 0)];
    }
    const ms = durationFor(width);
    return pane === 'list'
      ? [
          copy.animate(
            [
              { transform: 'none', opacity: 1 },
              { transform: 'translateX(-25%)', opacity: 0.9 }
            ],
            { duration: ms, easing: EASING.emphEnter, fill: 'forwards' }
          )
        ]
      : [
          copy.animate([{ transform: 'none' }, { transform: 'translateX(100%)' }], {
            duration: exitDuration(ms),
            easing: EASING.standard,
            fill: 'forwards'
          })
        ];
  });
}

/**
 * M9 on a phone, the pane that comes: the reader slides in from the right edge; the list comes back from a quarter to the left, opaque from
 * its first frame: it is the page that was there all along under the reader, not a new one fading in.
 */
export function enterPane(node: HTMLElement, pane: PhonePane): void {
  if (motionReduced()) {
    fade(node, 0, 1);
    return;
  }
  const ms = durationFor(node.offsetWidth);
  if (pane === 'reader') {
    node.animate([{ transform: 'translateX(100%)' }, { transform: 'none' }], { duration: ms, easing: EASING.emphEnter });
  } else {
    node.animate([{ transform: 'translateX(-25%)' }, { transform: 'none' }], { duration: exitDuration(ms), easing: EASING.standard });
  }
}

/** M14, the drawer that closes: the panel slides back out to the left (0.7 of its 300 ms entrance), the scrim fades (0.7 of its 250 ms). */
export function leaveDrawer(node: HTMLElement): void {
  leaveCopy(node, { pinned: false }, (copy) => {
    if (motionReduced()) {
      return [fade(copy, 1, 0)];
    }
    const panel = copy.querySelector('.mb-drawer');
    const scrim = copy.querySelector('.mb-drawer-scrim');
    return [
      ...(panel === null
        ? []
        : [
            panel.animate([{ transform: 'none' }, { transform: 'translateX(-100%)' }], {
              duration: exitDuration(DURATION.slow),
              easing: EASING.standard,
              fill: 'forwards'
            })
          ]),
      ...(scrim === null
        ? []
        : [
            scrim.animate([{ opacity: 1 }, { opacity: 0 }], { duration: exitDuration(DURATION.gentle), easing: 'linear', fill: 'forwards' })
          ])
    ];
  });
}

/**
 * M1 played backwards (Undo): the row that left comes back where it was. Its height opens (200 ms, standard) and, once the slot is about 80 %
 * open (100 ms), its content slides back in from 24 px to the left, the side it left to, and fades in (150 ms, enter): 250 ms in all, the
 * mirror of the forward overlap (J2-15). Undo reads as the archive taken back, not as new mail (new mail drops in from above: ui/motion
 * `enterRow`). Under reduced motion it is just there.
 */
export async function returnRow(el: HTMLElement): Promise<void> {
  if (motionReduced()) {
    return;
  }
  const child = el.children.length === 1 ? el.firstElementChild : null;
  let open: Animation;
  if (child instanceof HTMLElement) {
    el.style.setProperty('display', 'grid');
    child.style.minHeight = '0';
    child.style.overflow = 'hidden';
    open = el.animate([{ gridTemplateRows: '0fr' }, { gridTemplateRows: '1fr' }], {
      duration: DURATION.base,
      easing: EASING.standard,
      fill: 'backwards'
    });
  } else {
    const height = `${el.getBoundingClientRect().height}px`;
    el.style.setProperty('overflow', 'hidden');
    open = el.animate([{ height: '0px' }, { height }], { duration: DURATION.base, easing: EASING.standard, fill: 'backwards' });
  }
  const slide = el.animate(
    [
      { opacity: 0, transform: 'translateX(-24px)' },
      { opacity: 1, transform: 'none' }
    ],
    { duration: DURATION.quick, delay: RETURN_SLIDE_DELAY_MS, easing: EASING.enter, fill: 'backwards' }
  );
  await Promise.all([settled(open), settled(slide)]);
  el.style.removeProperty('display');
  el.style.removeProperty('overflow');
  if (child instanceof HTMLElement) {
    child.style.removeProperty('min-height');
    child.style.removeProperty('overflow');
  }
}

// ---- J2-23: the list head and the selection bar trade places by a fade-through ----

/** How long the copy of a head that gives its place fades out (ms): about 90, so it is gone before most of what comes in has appeared. */
export const HEAD_FADE_OUT_MS = 90;
/** What comes in waits this long (ms; messagelist.css and mailbox.css animation-delay): the two never share pixels at more than a third. */
export const HEAD_FADE_IN_DELAY_MS = 60;

/**
 * The head of the list (or the phone's app bar) and the selection bar trade places by a fade-through (J2-23, as M8 does for unrelated
 * headers): the one that goes leaves an inert copy over its old place that fades out in 90 ms (the selection bar's copy also lifts 8px,
 * the way it came), and the one that comes fades in after 60 ms (its stylesheet's animation-delay). Call it from the ref cleanup of the
 * element that goes, while it is still on the page; `replacedBy` is checked once it is gone (on its old parent): the copy plays only when
 * that is what took its place (not when the whole list goes, or a folder switch redraws it). Reduced motion: the same fade, no lift.
 */
export function fadeOutInPlace(node: HTMLElement, options: { lift: boolean; replacedBy: string }): void {
  const parent = node.parentElement;
  const host = node.offsetParent;
  if (parent === null || !(host instanceof HTMLElement)) {
    return;
  }
  const next = node.nextSibling;
  const rect = node.getBoundingClientRect();
  const box = host.getBoundingClientRect();
  const copy = inertCopy(node);
  if (copy === null) {
    return;
  }
  Object.assign(copy.style, {
    position: 'absolute',
    left: `${rect.left - box.left - host.clientLeft + host.scrollLeft}px`,
    top: `${rect.top - box.top - host.clientTop + host.scrollTop}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    zIndex: 'var(--z-raise)',
    animation: 'none',
    pointerEvents: 'none'
  });
  queueMicrotask(() => {
    if (node.isConnected || !parent.isConnected || parent.querySelector(`:scope > ${options.replacedBy}`) === null) {
      // Still there (StrictMode), gone with its parent, or something else took the place: nothing to play.
      return;
    }
    parent.insertBefore(copy, next !== null && next.parentNode === parent ? next : null);
    const lift = options.lift && !motionReduced();
    const animation = copy.animate(
      lift
        ? [
            { opacity: 1, transform: 'none' },
            { opacity: 0, transform: 'translateY(-8px)' }
          ]
        : [{ opacity: 1 }, { opacity: 0 }],
      { duration: HEAD_FADE_OUT_MS, easing: EASING.exit, fill: 'forwards' }
    );
    void settled(animation).then(() => {
      copy.remove();
    });
  });
}
