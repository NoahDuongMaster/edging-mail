import React from 'react';
import { DURATION, EASING } from '../../../shared/design/tokens';
import { exitDuration, motionReduced } from '../../ui/motion';

// The motion of the compose window (DESIGN.md section 3: M10 open/close, M11 send). Data and focus never wait for it: the window opens and
// takes focus at once, and it is gone from the page (focus back on its opener) the moment it closes; the closing motion plays on an inert
// copy. Under reduced motion only fades are left (150 ms), and no flight.

/** How the window left: closed (Escape, X, discard: it goes back toward its opener) or sent (it shrinks away and Send's icon takes off). */
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
 * M11 (J2-02, J2-14): Send's icon takes off at once on a short rising arc to the upper right, with two accent wing strokes trailing it. The
 * path runs DURATION.flight (480 ms) on a plain ease-out, cubic-bezier(0, 0, 0.58, 1): it leaves at once (16 % of the arc in the first
 * 10 % of the time) but keeps its momentum into the fade (79 % travelled when the fade starts at 60 %, still at 0.93x its average speed),
 * so the plane flies off instead of stopping and dissolving in place; the icon fades over the last 40 % in linear time. The wings run
 * DURATION.slow, the second DURATION.micro later. A fixed overlay at --z-float (compose.css `.cp-flight`) that nobody can click or read,
 * removed when it lands. No-op under reduced motion.
 */
function sendFlight(fromEl: HTMLElement): void {
  const rect = fromEl.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    return;
  }
  const token = document.createElement('div');
  token.className = 'cp-flight';
  token.setAttribute('aria-hidden', 'true');
  token.style.left = `${rect.left}px`;
  token.style.top = `${rect.top}px`;
  token.style.width = `${rect.width}px`;
  token.style.height = `${rect.height}px`;
  const icon = fromEl.cloneNode(true);
  if (icon instanceof Element) {
    for (const node of [icon, ...icon.querySelectorAll('[id]')]) {
      node.removeAttribute('id');
    }
  }
  const wings = [0, 1].map(() => {
    const wing = document.createElement('span');
    wing.className = 'cp-flight-wing';
    return wing;
  });
  /* eslint-disable unicorn/prefer-dom-node-append -- @cloudflare/workers-types overrides Element.append with the HTMLRewriter signature */
  for (const wing of wings) {
    token.appendChild(wing);
  }
  token.appendChild(icon);
  document.body.appendChild(token);
  /* eslint-enable unicorn/prefer-dom-node-append */
  const duration = DURATION.flight;
  const path = token.animate(
    [
      { transform: 'translate(0, 0) rotate(-10deg) scale(1)' },
      { transform: 'translate(52px, -34px) rotate(-6deg) scale(0.9)', offset: 0.45 },
      { transform: 'translate(120px, -76px) rotate(0deg) scale(0.7)' }
    ],
    // CSS's own ease-out (0, 0, 0.58, 1): momentum kept into the fade (J2-14).
    { duration, easing: 'ease-out', fill: 'forwards' }
  );
  const fade = token.animate([{ opacity: 1 }, { opacity: 0 }], {
    duration: duration * 0.4,
    delay: duration * 0.6,
    easing: 'linear',
    fill: 'forwards'
  });
  const trails = wings.map((wing, index) =>
    wing.animate(
      [
        { opacity: 0, transform: 'scaleX(0.4)' },
        { opacity: 1, transform: 'scaleX(1)', offset: 0.25 },
        { opacity: 0, transform: 'scaleX(0.3)' }
      ],
      { duration: DURATION.slow, delay: index * DURATION.micro, easing: EASING.standard, fill: 'forwards' }
    )
  );
  void Promise.allSettled([path.finished, fade.finished, ...trails.map((trail) => trail.finished)]).then(() => token.remove());
}

/** M10 close / M11 send, played on an inert copy of the window that is put where the window was and removed when it is done. */
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
    // On the flight's level, under it (it is drawn after): the icon that takes off is seen over the window that goes.
    ghost.style.zIndex = 'var(--z-float)';
  }
  // Not .append(): @cloudflare/workers-types overrides Element.append with the HTMLRewriter signature.
  // eslint-disable-next-line unicorn/prefer-dom-node-append -- see above
  document.body.appendChild(ghost);
  const panel = ghost.querySelector<HTMLElement>('.cp-panel');
  const reduced = motionReduced();
  const phone = window.matchMedia(PHONE).matches;
  // Sent: a quick shrink and fade (the flight is the motion). Closed: back toward the opener, or down on a phone, at 0.7 of the open.
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
  } else if (kind === 'sent') {
    // J2-02: no hold, it goes from the first frame: scale .94 with a linear fade over the 150 ms.
    animations.push(
      panel.animate(
        [
          { transform: 'none', opacity: 1 },
          { transform: 'scale(0.94)', opacity: 0 }
        ],
        { duration, easing: 'linear', fill: 'forwards' }
      )
    );
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
  if (kind === 'sent' && !reduced) {
    // The flight leaves from Send's icon on the copy (the foot's, or the head's when a phone on its side sent with the keyboard up: J5-25, the
    // one that is drawn); it is drawn after the copy, so it is on top of it.
    const icon = [...ghost.querySelectorAll<HTMLElement>('[data-send-icon]')].find((each) => each.getClientRects().length > 0);
    if (icon !== undefined) {
      sendFlight(icon);
    }
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
