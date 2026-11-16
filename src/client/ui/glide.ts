import React from 'react';
import { DURATION, EASING } from '../../shared/design/tokens';
import { motionReduced } from './motion';

// v3 signature H3 (DESIGN-v3 section 3): the selection capsule glides from one row, folder or tab to the next. One absolutely positioned
// element (the caller renders it, `aria-hidden`, class `.ui-glide` plus its own fill and radius) sits under the element that matches
// `selector` inside the container. When the match changes it glides there in --dur-glide with --ease-standard (a FLIP on `transform` only:
// equal heights move without any scaling, so a radius stays crisp; a taller target scales in during the glide and is exact at the end).
// The first placement, a resize and reduced motion place it at once. It follows ResizeObserver reports of the container and the target,
// and DOM changes inside the container (a row added above). Put it INSIDE the scrolling content (it then scrolls with the rows, nothing
// is measured on scroll); give the container `.ui-glide-host` (position: relative + isolation) so the capsule paints under the rows.

export interface GlideOptions {
  /** Re-place when this changes (the selected id); the hook also follows resizes and DOM changes in the container. */
  key?: unknown;
  /** Off: the capsule is hidden (e.g. nothing selected). */
  enabled?: boolean;
}

interface Place {
  x: number;
  y: number;
  width: number;
  height: number;
}

const near = (a: Place, b: Place): boolean =>
  Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.width - b.width) < 0.5 && Math.abs(a.height - b.height) < 0.5;

const transformOf = (place: Place): string => `translate(${place.x.toFixed(2)}px, ${place.y.toFixed(2)}px)`;

/** Where `target` is inside the capsule's positioning box, in that box's scrolled content coordinates. */
function placeOf(target: Element, host: Element): Place {
  const box = host.getBoundingClientRect();
  const rect = target.getBoundingClientRect();
  return {
    x: rect.left - box.left - host.clientLeft + host.scrollLeft,
    y: rect.top - box.top - host.clientTop + host.scrollTop,
    width: rect.width,
    height: rect.height
  };
}

/** What the capsule shows right now (also in the middle of a glide): its translate and its size times its scale. */
function drawnPlace(capsule: HTMLElement, size: Place): Place {
  const matrix = new DOMMatrixReadOnly(getComputedStyle(capsule).transform);
  return { x: matrix.e, y: matrix.f, width: size.width * matrix.a, height: size.height * matrix.d };
}

/**
 * Places one capsule element (the returned ref, rendered by the caller inside `containerRef`, `aria-hidden`) under the element that
 * matches `selector` inside the container, and glides it there when the match changes. First placement and reduced motion: no move.
 */
export function useGlide(
  containerRef: React.RefObject<HTMLElement | null>,
  selector: string,
  options: GlideOptions = {}
): React.RefObject<HTMLDivElement | null> {
  const capsule = React.useRef<HTMLDivElement | null>(null);
  const { key, enabled = true } = options;
  // What the capsule was last placed under, and where (null: hidden).
  const last = React.useRef<{ target: Element; place: Place } | null>(null);
  const glide = React.useRef<Animation | null>(null);

  const place = React.useCallback(() => {
    const box = capsule.current;
    const container = containerRef.current;
    if (box === null || container === null) {
      return;
    }
    const target = enabled ? container.querySelector(selector) : null;
    if (target === null || target.getClientRects().length === 0) {
      box.hidden = true;
      last.current = null;
      glide.current?.cancel();
      glide.current = null;
      return;
    }
    box.hidden = false;
    const host = box.offsetParent ?? container;
    const next = placeOf(target, host);
    const before = last.current;
    if (before !== null && before.target === target && near(before.place, next)) {
      return;
    }
    const running = glide.current !== null && glide.current.playState === 'running' ? glide.current : null;
    // A glide that runs is re-aimed from where it is drawn now; a new target glides from the old one; the rest is placed at once.
    const from = running === null ? (before?.target === target ? null : (before?.place ?? null)) : drawnPlace(box, before?.place ?? next);
    const remaining =
      running === null ? DURATION.glide : Math.max(80, DURATION.glide - Number(running.currentTime ?? 0) / (running.playbackRate || 1));
    running?.cancel();
    glide.current = null;
    last.current = { target, place: next };
    box.style.width = `${next.width}px`;
    box.style.height = `${next.height}px`;
    box.style.transform = transformOf(next);
    if (from === null || motionReduced() || near(from, next)) {
      return;
    }
    const sx = next.width > 0 ? from.width / next.width : 1;
    const sy = next.height > 0 ? from.height / next.height : 1;
    const scale = Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01 ? '' : ` scale(${sx.toFixed(4)}, ${sy.toFixed(4)})`;
    glide.current = box.animate([{ transform: `${transformOf(from)}${scale}` }, { transform: transformOf(next) }], {
      duration: remaining,
      easing: running === null ? EASING.standard : EASING.enter
    });
  }, [containerRef, selector, enabled]);

  // Every commit that changes the key (the selection) or the rules places it before the paint.
  React.useLayoutEffect(() => {
    place();
  }, [place, key]);

  // Resizes of the container and of the target, and DOM changes inside the container, re-place it (once per frame at most).
  React.useEffect(() => {
    const container = containerRef.current;
    if (container === null || typeof ResizeObserver === 'undefined') {
      return;
    }
    let frame = 0;
    let watched: Element | null = null;
    const sizes = new ResizeObserver(() => {
      schedule();
    });
    function schedule(): void {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        place();
        const target = last.current?.target ?? null;
        if (target !== watched) {
          if (watched !== null) {
            sizes.unobserve(watched);
          }
          if (target !== null) {
            sizes.observe(target);
          }
          watched = target;
        }
      });
    }
    sizes.observe(container);
    const changes = new MutationObserver((records) => {
      // The capsule's own style changes are not a reason to move it.
      if (records.some((record) => record.target !== capsule.current)) {
        schedule();
      }
    });
    changes.observe(container, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-selected', 'aria-current', 'data-active', 'data-selected', 'class', 'hidden']
    });
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      sizes.disconnect();
      changes.disconnect();
    };
  }, [containerRef, place]);

  return capsule;
}
