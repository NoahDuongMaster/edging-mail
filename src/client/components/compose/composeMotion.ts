import React from 'react';
import { DURATION, EASING } from '../../../shared/design/tokens';
import { foldAndFly } from '../../ui/homing';
import { exitDuration, motionReduced } from '../../ui/motion';

// The motion of the compose window (DESIGN.md section 3: M10 open/close; DESIGN-v3 H4: send = fold and fly). Data and focus never wait for
// it: the window opens and takes focus at once, and it is gone from the page (focus back on its opener) the moment it closes; the closing
// motion plays on an inert copy. Under reduced motion only fades are left (150 ms), and no flight (Sent only catches it: a short highlight).

/** How the window left: closed (Escape, X, discard: it goes back toward its opener) or sent (it folds into a letter that flies to Sent). */
export type ComposeExit = 'close' | 'sent';

const PHONE = '(max-width: 900px)';

/** Where the compose came from: the rect of its opener and the look to start in (its fill and corner radius). */
interface Origin {
  rect: DOMRect;
  /** The opener's background (a primary button: the accent gradient over the accent), to start the window in it. */
  background: { image: string; color: string };
  /** The opener's corner radius in px. */
  radius: number;
}

/** The control that opened the compose: the focused element, else the Compose button (the `c` key starts from the page). */
function opener(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body && active.isConnected
    ? active
    : document.querySelector<HTMLElement>('button[data-compose-button]');
}

/** The rect of the control that opened the compose (null when it has none, as a hidden one). */
export function openerRect(): DOMRect | null {
  const rect = opener()?.getBoundingClientRect();
  return rect === undefined || rect.width === 0 ? null : rect;
}

function openerOrigin(): Origin | null {
  const element = opener();
  const rect = element?.getBoundingClientRect();
  if (element === null || rect === undefined || rect.width === 0) {
    return null;
  }
  const style = getComputedStyle(element);
  return {
    rect,
    background: { image: style.backgroundImage, color: style.backgroundColor },
    radius: Number.parseFloat(style.borderTopLeftRadius) || 0
  };
}

/**
 * M10 open, desktop (J2-07): the window grows out of its opener (300 ms, emphasized enter) and starts in the opener's look: a layer in the
 * button's own fill covers the window and fades into its surface over the first third, while the corners go from the button's radius to
 * the window's (counter-scaled, so they are seen at their real size while the window is scaled). The content fades in from 60 ms.
 */
function growFrom(origin: Origin, panel: HTMLElement): void {
  const to = panel.getBoundingClientRect();
  if (to.width === 0 || to.height === 0) {
    return;
  }
  const { rect } = origin;
  const dx = rect.left - to.left;
  const dy = rect.top - to.top;
  const sx = Math.max(0.05, rect.width / to.width);
  const sy = Math.max(0.05, rect.height / to.height);
  const radius = Number.parseFloat(getComputedStyle(panel).borderTopLeftRadius) || 12;
  const start = Math.min(origin.radius, rect.height / 2);
  panel.animate(
    [
      {
        transformOrigin: 'top left',
        transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`,
        borderRadius: `${start / sx}px / ${start / sy}px`
      },
      { transformOrigin: 'top left', transform: 'none', borderRadius: `${radius}px` }
    ],
    { duration: DURATION.slow, easing: EASING.emphEnter }
  );
  // The content comes in once the window has room for it (never squashed text).
  for (const child of panel.children) {
    child.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION.quick, delay: 60, easing: 'linear', fill: 'backwards' });
  }
  // The button's look, on top, fading into the window's surface.
  const morph = document.createElement('div');
  morph.className = 'cp-morph';
  morph.setAttribute('aria-hidden', 'true');
  morph.style.backgroundColor = origin.background.color;
  morph.style.backgroundImage = origin.background.image;
  // Not .append(): @cloudflare/workers-types overrides Element.append with the HTMLRewriter signature.
  // eslint-disable-next-line unicorn/prefer-dom-node-append -- see above
  panel.appendChild(morph);
  const fade = morph.animate([{ opacity: 1 }, { opacity: 1, offset: 0.15 }, { opacity: 0 }], {
    duration: DURATION.base / 2 + 10,
    easing: 'linear',
    fill: 'forwards'
  });
  void fade.finished.then(
    () => morph.remove(),
    () => morph.remove()
  );
}

/** M10 open: on a desktop the window grows out of its opener (container transform, 300 ms); on a phone it slides up, 400 ms. The veil fades in. */
function playOpen(root: HTMLElement, panel: HTMLElement, from: Origin | null): void {
  const veil = getComputedStyle(root).backgroundColor;
  // J2-10: the veil's fade stays within the 150 ms that reduced motion allows.
  const reduced = motionReduced();
  root.animate([{ backgroundColor: 'transparent' }, { backgroundColor: veil }], {
    duration: reduced ? DURATION.quick : DURATION.base,
    easing: 'linear'
  });
  if (reduced) {
    panel.animate([{ opacity: 0 }, { opacity: 1 }], { duration: DURATION.quick, easing: 'linear' });
    return;
  }
  if (window.matchMedia(PHONE).matches) {
    panel.animate([{ transform: 'translateY(100%)' }, { transform: 'none' }], { duration: DURATION.slower, easing: EASING.emphEnter });
    return;
  }
  if (from === null) {
    panel.animate(
      [
        { opacity: 0, transform: 'scale(0.96)' },
        { opacity: 1, transform: 'none' }
      ],
      { duration: DURATION.gentle, easing: EASING.emphEnter }
    );
    return;
  }
  growFrom(from, panel);
}

/**
 * v3 X1: the postmark lands on the envelope's stamp of the window that leaves (it fades in from 0.96 to its size in 200 ms on the settle
 * curve, from the circle's centre), the first motion of a send. Without one (a window with no stamp), a step of no length: the fold
 * starts at once. Only called when motion is allowed (playExit).
 */
function stampPostmark(panel: HTMLElement): Animation {
  const mark = panel.querySelector<SVGElement>('.cp-postmark');
  if (mark === null) {
    return panel.animate([], { duration: 0 });
  }
  mark.style.transformOrigin = '30% 50%';
  return mark.animate(
    [
      { opacity: 0, transform: 'scale(0.96)' },
      { opacity: 1, transform: 'none' }
    ],
    { duration: DURATION.base, easing: EASING.settle, fill: 'backwards' }
  );
}

/** M10 close / H4 send, played on an inert copy of the window that is put where the window was and removed when it is done. */
function playExit(root: HTMLElement, kind: ComposeExit, to: DOMRect | null): void {
  const ghost = root.cloneNode(true);
  if (!(ghost instanceof HTMLElement)) {
    return;
  }
  for (const element of [ghost, ...ghost.querySelectorAll('[id]')]) {
    element.removeAttribute('id');
  }
  ghost.setAttribute('aria-hidden', 'true');
  ghost.inert = true;
  ghost.dataset.leaving = 'true';
  if (kind === 'sent') {
    // Under the homing overlay (--z-float), where the folded letter flies: the veil that fades never covers it.
    ghost.style.zIndex = 'var(--z-raise)';
  }
  // Not .append(): @cloudflare/workers-types overrides Element.append with the HTMLRewriter signature.
  // eslint-disable-next-line unicorn/prefer-dom-node-append -- see above
  document.body.appendChild(ghost);
  const panel = ghost.querySelector<HTMLElement>('.cp-panel');
  const reduced = motionReduced();
  const phone = window.matchMedia(PHONE).matches;
  // Sent: the veil fades quickly (the fold and the flight are the motion). Closed: back toward the opener, or down on a phone, at 0.7 of
  // the open.
  let duration: number = DURATION.quick;
  if (!reduced && kind === 'close') {
    duration = phone ? exitDuration(DURATION.slower) : exitDuration(DURATION.slow);
  }
  const veil = getComputedStyle(ghost).backgroundColor;
  const animations: Animation[] = [
    ghost.animate([{ backgroundColor: veil }, { backgroundColor: 'transparent' }], { duration, easing: 'linear', fill: 'forwards' })
  ];
  if (panel === null || reduced) {
    animations.push((panel ?? ghost).animate([{ opacity: 1 }, { opacity: 0 }], { duration, easing: 'linear', fill: 'forwards' }));
    if (kind === 'sent') {
      // Reduced motion: no fold and no flight; Sent catches the message with its short highlight only.
      void foldAndFly(panel ?? ghost, 'sent');
    }
  } else if (kind === 'sent') {
    // H4 (J2-02: no hold, it goes from the first frame): ui/homing foldAndFly copies the window into the homing overlay at its place, folds
    // the copy into a 120 x 80 letter whose flap closes, and flies it along the arc to the Sent folder (the 'menu' home on a phone, where
    // the drawer is closed), which catches it. The copy it takes is made at once, so the window here only hides. v3 X1: first the postmark
    // lands on the envelope's stamp (fade, 0.96 -> 1, 200 ms, the settle curve: the motion of the first frame), then the window folds.
    const stamped = stampPostmark(panel);
    animations.push(stamped);
    // A stamp cut short (the copy removed early) still lets the letter go: the message is sent either way.
    const fly = (): void => {
      void foldAndFly(panel, 'sent');
      panel.style.visibility = 'hidden';
    };
    void stamped.finished.then(fly, fly);
  } else {
    // The window's card stays solid while it travels and fades over the last part of the way (a fade of the whole layer from the start
    // reads as a dissolve in place, the page showing through the card's words).
    let end = 'scale(0.94)';
    if (phone) {
      end = 'translateY(100%)';
    } else if (to !== null) {
      const box = panel.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) {
        const sx = Math.max(0.05, to.width / box.width);
        const sy = Math.max(0.05, to.height / box.height);
        end = `translate(${to.left - box.left}px, ${to.top - box.top}px) scale(${sx}, ${sy})`;
      }
    }
    animations.push(
      panel.animate(
        [
          { transformOrigin: 'top left', transform: 'none', opacity: 1 },
          { opacity: 1, offset: 0.45 },
          { transformOrigin: 'top left', transform: end, opacity: 0 }
        ],
        { duration, easing: EASING.emphExit, fill: 'forwards' }
      )
    );
  }
  void Promise.allSettled(animations.map((animation) => animation.finished)).then(() => ghost.remove());
}

/**
 * Plays the compose window's open and close. `exitRef` says how the window is leaving (set it before closing); the close goes back toward
 * the control that opened it.
 */
export function useComposeMotion(
  isOpen: boolean,
  rootRef: React.RefObject<HTMLElement | null>,
  panelRef: React.RefObject<HTMLElement | null>,
  exitRef: React.RefObject<ComposeExit>
): void {
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    const panel = panelRef.current;
    if (!isOpen || root === null || panel === null) {
      return;
    }
    // Read before anything moves focus into the form (that happens in an effect after this one).
    const from = openerOrigin();
    playOpen(root, panel, from);
    // How it leaves is set by the compose right before it closes: read at the close, not now.
    const exit = exitRef;
    return () => {
      // React has already taken the window out of the page when this runs on a close (the cleanup of a changed effect comes after the
      // DOM removals of that commit), so the window is checked a moment later: gone is a real close; still there is StrictMode running
      // the effect twice, or a re-render that left it open.
      queueMicrotask(() => {
        if (!root.isConnected) {
          playExit(root, exit.current, from?.rect ?? null);
        }
      });
    };
  }, [isOpen, rootRef, panelRef, exitRef]);
}
