import React from 'react';
import { DURATION, EASING } from '../../shared/design/tokens';

// The motion of the app that CSS cannot do alone (research/02-motion-system, DESIGN.md section 3). Every helper reads `motionReduced()`
// first: under reduced motion nothing moves (no translate, scale, arc or loop); a fade of 150 ms or less may stay. Nothing here waits for
// an animation before data, selection or focus change: the caller changes them at once and the motion is a layer on top that can be cut.
// Only `transform` and `opacity` are animated, except the height of a row that leaves or arrives (grid rows, or its height).

const REDUCE_QUERY = '(prefers-reduced-motion: reduce)';

/** The short fade that replaces a move under reduced motion (a leave, a closing layer): under the 150 ms cap of a reduced fade. */
const REDUCED_FADE_MS = DURATION.micro + 30;

/** True when motion should be reduced: the system setting, or the in-app choice (`data-motion="reduce"` on <html>, set before the first render). */
export function motionReduced(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return true;
  }
  return document.documentElement.dataset.motion === 'reduce' || window.matchMedia(REDUCE_QUERY).matches;
}

function subscribeMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCE_QUERY);
  query.addEventListener('change', onChange);
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-motion'] });
  return () => {
    query.removeEventListener('change', onChange);
    observer.disconnect();
  };
}

/** `motionReduced()` as React state: the component renders again when the system setting or the in-app choice changes. False on the server. */
export function useMotionReduced(): boolean {
  return React.useSyncExternalStore(subscribeMotion, motionReduced, () => false);
}

/** The duration in ms of a move of `px` pixels: clamp(150, 90 + 9 x sqrt(px), 400). A longer way takes longer, but never drags. */
export function durationFor(px: number): number {
  return Math.min(400, Math.max(150, Math.round(90 + 9 * Math.sqrt(Math.max(0, px)))));
}

/** The duration of a leave: 0.7 of the enter it answers, to the nearest 10 ms (300 -> 210, 250 -> 180, 200 -> 140). */
export function exitDuration(enterMs: number): number {
  return Math.round((enterMs * 0.7) / 10) * 10;
}

/** Waits for an animation; a cancelled one (its element went away, a newer one replaced it) counts as done. */
async function settled(animation: Animation): Promise<void> {
  try {
    await animation.finished;
  } catch {
    // cancelled: nothing to wait for
  }
}

/** Animates the height of `el` to or from zero: grid rows (1fr <-> 0fr) when it has one child, else its height and vertical box. */
function heightAnimation(el: HTMLElement, closing: boolean, options: KeyframeAnimationOptions): Animation {
  const child = el.children.length === 1 ? el.firstElementChild : null;
  if (child instanceof HTMLElement) {
    el.style.setProperty('display', 'grid');
    child.style.minHeight = '0';
    child.style.overflow = 'hidden';
    const rows = [{ gridTemplateRows: '1fr' }, { gridTemplateRows: '0fr' }];
    return el.animate(closing ? rows : rows.toReversed(), options);
  }
  const style = getComputedStyle(el);
  const open: Keyframe = {
    height: `${el.getBoundingClientRect().height}px`,
    paddingTop: style.paddingTop,
    paddingBottom: style.paddingBottom,
    marginTop: style.marginTop,
    marginBottom: style.marginBottom
  };
  const shut: Keyframe = { height: '0px', paddingTop: '0px', paddingBottom: '0px', marginTop: '0px', marginBottom: '0px' };
  el.style.setProperty('overflow', 'hidden');
  return el.animate(closing ? [open, shut] : [shut, open], options);
}

/**
 * M1, a message leaves the list (archive, trash, spam, snooze, move): its content fades and slides 24 px toward `dir` in 140 ms, then its
 * height closes in 200 ms from 100 ms on (300 ms in all). `dir` 'none' fades without a slide (Delete forever: not a journey). Under reduced
 * motion: a 100 ms fade. Resolves when it is over; remove the row from the list then (the animation keeps its end state until you do).
 * Move focus to the next row at once, not after this promise.
 */
export async function leaveRow(el: HTMLElement, dir: 'left' | 'right' | 'none' = 'left'): Promise<void> {
  if (motionReduced()) {
    await settled(el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: REDUCED_FADE_MS, easing: 'linear', fill: 'forwards' }));
    return;
  }
  const x = { left: -24, right: 24, none: 0 }[dir];
  const fade = el.animate(
    [
      { opacity: 1, transform: 'none' },
      { opacity: 0, transform: `translateX(${x}px)` }
    ],
    {
      duration: exitDuration(DURATION.base),
      easing: EASING.exit,
      fill: 'forwards'
    }
  );
  const collapse = heightAnimation(el, true, { duration: DURATION.base, delay: 100, easing: EASING.standard, fill: 'forwards' });
  await Promise.all([settled(fade), settled(collapse)]);
}

/**
 * M1 backwards (Undo) and M4 (new mail at the top of the list): the row's height opens in 200 ms, then its content fades in and comes down
 * 8 px from 60 ms on. Instant under reduced motion. Call it right after the row is in the DOM.
 */
export async function enterRow(el: HTMLElement): Promise<void> {
  if (motionReduced()) {
    return;
  }
  const open = heightAnimation(el, false, { duration: DURATION.base, easing: EASING.standard, fill: 'backwards' });
  const fade = el.animate(
    [
      { opacity: 0, transform: 'translateY(-8px)' },
      { opacity: 1, transform: 'none' }
    ],
    {
      duration: DURATION.base,
      delay: 60,
      easing: EASING.enter,
      fill: 'backwards'
    }
  );
  await Promise.all([settled(open), settled(fade)]);
  // The grid or the clipped height was only for the move: the row lays itself out again.
  el.style.removeProperty('display');
  el.style.removeProperty('overflow');
}

/**
 * FLIP for the children of `container`: call it BEFORE the DOM changes (it measures where every child is), change the DOM, then call the
 * function it returns: each child that stayed slides from its old place to its new one in 200 ms (standard), with transform only. For a
 * bulk move (more than 3 rows) instead of one collapse per row. Under reduced motion the function does nothing.
 */
export function flip(container: HTMLElement): () => Promise<void> {
  const before = new Map<Element, DOMRect>();
  for (const child of container.children) {
    before.set(child, child.getBoundingClientRect());
  }
  return async () => {
    if (motionReduced()) {
      return;
    }
    const moves: Animation[] = [];
    for (const child of container.children) {
      const old = before.get(child);
      if (old === undefined) {
        continue;
      }
      const now = child.getBoundingClientRect();
      const dx = old.left - now.left;
      const dy = old.top - now.top;
      if (Math.abs(dx) >= 1 || Math.abs(dy) >= 1) {
        moves.push(
          child.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], {
            duration: DURATION.base,
            easing: EASING.standard
          })
        );
      }
    }
    await Promise.all(moves.map(settled));
  };
}

/** What leaves when a layer closes: a dialog (scrim + panel, or a phone sheet), a popup (menu, popover, select list) or a tooltip. */
export type ExitKind = 'dialog' | 'popup' | 'tooltip';

/**
 * Plays the exit of a layer that React has already removed, on an inert copy of it: the layer itself goes at once (focus returns, Escape and
 * Tab are released, screen readers lose it), and the copy fades out where it was and is removed. A dialog exits in 180 ms (scale .98), a
 * phone sheet slides down in 210 ms, a popup fades in 140 ms, a tooltip only fades, in 110 ms; under reduced motion everything only fades,
 * in 100 ms.
 */
export function leaveGhost(node: HTMLElement, parent: Node, next: Node | null, kind: ExitKind): void {
  const ghost = node.cloneNode(true);
  if (!(ghost instanceof HTMLElement) || !parent.isConnected) {
    return;
  }
  for (const element of [ghost, ...ghost.querySelectorAll('[id]')]) {
    element.removeAttribute('id');
  }
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.dataset.leaving = 'true';
  parent.insertBefore(ghost, next !== null && next.parentNode === parent ? next : null);
  const reduced = motionReduced();
  const animations: Animation[] = [];
  if (kind === 'tooltip') {
    animations.push(ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration: DURATION.fast, easing: 'linear', fill: 'forwards' }));
  } else if (kind === 'popup') {
    const end = reduced ? { opacity: 0 } : { opacity: 0, transform: 'scale(0.98)' };
    animations.push(
      ghost.animate([{ opacity: 1, transform: 'none' }, end], {
        duration: reduced ? REDUCED_FADE_MS : exitDuration(DURATION.base),
        easing: EASING.exit,
        fill: 'forwards'
      })
    );
  } else {
    // The scrim (the root's ::before) fades on its own layer. The panel: a phone sheet slides down opaque, a dialog scales to 98% and
    // fades; under reduced motion both only fade.
    const panel = ghost.querySelector<HTMLElement>('.ui-dialog');
    const sheet = window.matchMedia('(max-width: 640px)').matches;
    const duration = reduced ? REDUCED_FADE_MS : sheet ? exitDuration(DURATION.slow) : exitDuration(DURATION.gentle);
    animations.push(
      ghost.animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'linear', fill: 'forwards', pseudoElement: '::before' })
    );
    if (panel !== null) {
      const frames: Keyframe[] = reduced
        ? [{ opacity: 1 }, { opacity: 0 }]
        : sheet
          ? [{ transform: 'none' }, { transform: 'translateY(100%)' }]
          : [
              { opacity: 1, transform: 'none' },
              { opacity: 0, transform: 'scale(0.98)' }
            ];
      animations.push(panel.animate(frames, { duration, easing: reduced ? 'linear' : EASING.exit, fill: 'forwards' }));
    }
  }
  void Promise.all(animations.map(settled)).then(() => {
    ghost.remove();
  });
}

/**
 * Plays the leave of a bar that gives its place back (the selection bar, when the list head returns): the reverse of its enter (index.css
 * `nm-slide-down`, 200 ms ease-enter), on an inert copy laid over the place it had, out of the flow, so what comes back is not pushed:
 * it fades while it moves 8px up in 0.7 of the enter (140 ms, ease-exit); under reduced motion it only fades (100 ms). Call it while the
 * bar is still in the page (a layout effect's cleanup); the copy is made once React has really removed it (not StrictMode's rehearsal).
 */
export function leaveInPlace(node: HTMLElement): void {
  const parent = node.parentNode;
  const next = node.nextSibling;
  const host = node.offsetParent;
  if (parent === null || !(host instanceof HTMLElement)) {
    return;
  }
  const rect = node.getBoundingClientRect();
  const box = host.getBoundingClientRect();
  const place = {
    position: 'absolute',
    left: `${rect.left - box.left - host.clientLeft + host.scrollLeft}px`,
    top: `${rect.top - box.top - host.clientTop + host.scrollTop}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    margin: '0',
    zIndex: 'var(--z-raise)',
    animation: 'none',
    pointerEvents: 'none'
  };
  queueMicrotask(() => {
    if (node.isConnected || !parent.isConnected) {
      return;
    }
    const ghost = node.cloneNode(true);
    if (!(ghost instanceof HTMLElement)) {
      return;
    }
    for (const element of [ghost, ...ghost.querySelectorAll('[id]')]) {
      element.removeAttribute('id');
    }
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    ghost.dataset.leaving = 'true';
    Object.assign(ghost.style, place);
    parent.insertBefore(ghost, next !== null && next.parentNode === parent ? next : null);
    const reduced = motionReduced();
    const frames: Keyframe[] = reduced
      ? [{ opacity: 1 }, { opacity: 0 }]
      : [
          { opacity: 1, transform: 'none' },
          { opacity: 0, transform: 'translateY(-8px)' }
        ];
    const animation = ghost.animate(frames, {
      duration: reduced ? REDUCED_FADE_MS : exitDuration(DURATION.base),
      easing: reduced ? 'linear' : EASING.exit,
      fill: 'forwards'
    });
    void settled(animation).then(() => {
      ghost.remove();
    });
  });
}

/** What came in with a swap and fades in: an element at least this tall (a list, a form), not an icon that changed. */
const SWAP_MIN_PX = 40;

/**
 * J2-21, a sheet whose content is swapped (the row menu's Snooze, Add label and Move to folder lists, the sub-lists of the selection's More
 * sheet) changes its height instead of jumping: its top edge travels from the old height to the new one in 200 ms (standard; a taller
 * sheet slides up from its old top, transform only; a shorter one closes its height), and what came in fades in over 150 ms. Under reduced
 * motion the height is instant and only the fade plays. `content` is watched for elements added or removed; a change that keeps the height
 * (a tick on a label) does nothing. `enabled` is read at each change (a bottom sheet moves; a centred dialog does not).
 */
export function useSheetResize(
  panelRef: React.RefObject<HTMLElement | null>,
  contentRef: React.RefObject<HTMLElement | null>,
  enabled: () => boolean
): void {
  React.useEffect(() => {
    const panel = panelRef.current;
    const content = contentRef.current;
    if (panel === null || content === null) {
      return;
    }
    // The height the sheet was drawn with last (layout, also each frame of a height that is closing); kept by the observer, because when a
    // swap is seen the old content is already gone.
    let height = panel.offsetHeight;
    let moving: Animation | null = null;
    const sizes = new ResizeObserver(() => {
      height = panel.offsetHeight;
    });
    sizes.observe(panel);
    const swaps = new MutationObserver((records) => {
      // A slide that still runs draws the top edge lower than its layout: start from where it is seen.
      const lowered = moving === null ? 0 : new DOMMatrixReadOnly(getComputedStyle(panel).transform).m42;
      moving?.cancel();
      moving = null;
      const drawn = height - lowered;
      const after = panel.offsetHeight;
      height = after;
      const delta = after - drawn;
      if (Math.abs(delta) < 1 || !enabled()) {
        return;
      }
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node instanceof HTMLElement && node.isConnected && node.offsetHeight >= SWAP_MIN_PX) {
            node.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION.quick, easing: 'linear' });
          }
        }
      }
      if (motionReduced()) {
        return;
      }
      const timing = { duration: DURATION.base, easing: EASING.standard };
      const animation =
        delta > 0
          ? panel.animate([{ transform: `translateY(${delta}px)` }, { transform: 'none' }], timing)
          : panel.animate([{ height: `${drawn}px` }, { height: `${after}px` }], timing);
      moving = animation;
      void settled(animation).then(() => {
        if (moving === animation) {
          moving = null;
        }
      });
    });
    swaps.observe(content, { childList: true, subtree: true });
    return () => {
      sizes.disconnect();
      swaps.disconnect();
      moving?.cancel();
    };
  }, [panelRef, contentRef, enabled]);
}

/**
 * Gives the layer whose element is in `ref` an exit motion (`leaveGhost`) when it unmounts. A real unmount only: the copy is made when the
 * element has really left the page (React's StrictMode runs effects twice without removing anything). `skipRef` true at that moment: it
 * goes at once (a tooltip that another one replaced).
 */
export function useExitMotion(ref: React.RefObject<HTMLElement | null>, kind: ExitKind, skipRef?: React.RefObject<boolean>): void {
  // Read when the layer has gone, not when the effect ran: the tooltip that replaces this one sets it in the same commit.
  const skipped = React.useCallback(() => skipRef?.current === true, [skipRef]);
  React.useLayoutEffect(() => {
    const node = ref.current;
    return () => {
      if (node === null) {
        return;
      }
      const parent = node.parentNode;
      const next = node.nextSibling;
      if (parent === null) {
        return;
      }
      queueMicrotask(() => {
        if (!node.isConnected && !skipped()) {
          leaveGhost(node, parent, next, kind);
        }
      });
    };
  }, [ref, kind, skipped]);
}
