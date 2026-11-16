import React from 'react';
import { DURATION, EASING } from '../../shared/design/tokens';
import { motionReduced } from './motion';

/** Which way the gesture throws the element out: a bottom sheet goes `down`, a drawer from the left edge goes `left`. */
export type SwipeDirection = 'down' | 'left';

export interface SwipeToDismissOptions {
  direction: SwipeDirection;
  /** Called once when a drag ends past the threshold (or as a flick). The caller closes the layer (its exit motion plays from there). */
  onDismiss: () => void;
  /**
   * Where a drag may start, inside the element: `(event) => boolean` for the press that starts it. Default: anywhere on the element that
   * is not a control (a button, a link, a field). A sheet passes its top strip (the grab handle and the heading).
   */
  startsDrag?: (event: PointerEvent, element: HTMLElement) => boolean;
  /** False turns the gesture off (a dialog that cannot be closed now, a desktop layout). Read at the start of each press. */
  enabled?: () => boolean;
}

/** A drag that ends past this share of the element's size closes it. */
const DISTANCE_SHARE = 0.3;
/** A flick this fast (px per ms, toward the edge) closes it whatever the distance. */
const FLICK_SPEED = 0.5;
/** Movement under this many px is still a tap (so a tap on the handle does nothing and a click still reaches its control). */
const SLOP = 6;

const CONTROL = 'button, a[href], input, select, textarea, label, [role="tab"], [role="switch"], [contenteditable="true"]';

/** A press on a control is the control's, never the start of a drag. */
export const pressedOnControl = (event: PointerEvent): boolean => event.target instanceof Element && event.target.closest(CONTROL) !== null;

/**
 * Drag-to-dismiss for a sheet or a drawer (research/02 M2/M14; DESIGN.md section 3): the element follows the finger (also under reduced
 * motion, which only makes the settle instant), only toward its edge (the other way it barely moves), and closes when the drag ends past
 * 30% of its size or as a flick faster than 0.5 px/ms; otherwise it settles back in 200 ms. A vertical scroll inside a drawer is left to
 * the browser: the gesture locks to its axis after the first 6 px. The element's `translate` is the only property it writes, and it is
 * cleared when the layer closes or settles, so the layer's own exit motion (motion.ts leaveGhost) plays from where the finger let go.
 *
 * Give the strip where a drag starts `touch-action: none` (a sheet's handle and heading), or `touch-action: pan-y` on a drawer that
 * scrolls vertically: otherwise the browser takes the touch for a scroll and cancels the pointer events. Every way to close stays
 * (the close button, Escape, the scrim): the gesture is a shortcut, never the only route.
 */
export function useSwipeToDismiss(ref: React.RefObject<HTMLElement | null>, options: SwipeToDismissOptions): void {
  const latest = React.useRef(options);
  React.useLayoutEffect(() => {
    latest.current = options;
  });

  React.useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    let drag: {
      id: number;
      x: number;
      y: number;
      size: number;
      moving: boolean;
      samples: { at: number; offset: number }[];
    } | null = null;

    /** How far toward the edge the pointer went (px; negative = the other way). */
    const offsetOf = (event: PointerEvent): number => {
      if (drag === null) {
        return 0;
      }
      return latest.current.direction === 'down' ? event.clientY - drag.y : drag.x - event.clientX;
    };
    const across = (event: PointerEvent): number =>
      drag === null ? 0 : latest.current.direction === 'down' ? Math.abs(event.clientX - drag.x) : Math.abs(event.clientY - drag.y);
    const place = (offset: number) => {
      // The other way it moves a quarter of the finger's way (a rubber band): it is pinned to its edge.
      const shown = offset >= 0 ? offset : offset / 4;
      element.style.translate = latest.current.direction === 'down' ? `0 ${shown}px` : `${-shown}px 0`;
    };
    const settle = () => {
      if (motionReduced()) {
        element.style.translate = '';
        return;
      }
      const from = element.style.translate;
      element.style.translate = '';
      element.animate([{ translate: from }, { translate: '0 0' }], { duration: DURATION.base, easing: EASING.standard });
    };

    const onDown = (event: PointerEvent) => {
      const { enabled, startsDrag } = latest.current;
      if (!event.isPrimary || event.button !== 0 || (enabled !== undefined && !enabled())) {
        return;
      }
      if (startsDrag === undefined ? pressedOnControl(event) : !startsDrag(event, element)) {
        return;
      }
      const rect = element.getBoundingClientRect();
      drag = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        size: latest.current.direction === 'down' ? rect.height : rect.width,
        moving: false,
        samples: [{ at: event.timeStamp, offset: 0 }]
      };
    };
    const onMove = (event: PointerEvent) => {
      if (drag?.id !== event.pointerId) {
        return;
      }
      const offset = offsetOf(event);
      if (!drag.moving) {
        if (Math.abs(offset) < SLOP && across(event) < SLOP) {
          return;
        }
        // The first clear movement decides: along the axis it is ours, across it (a scroll of the drawer's list) it is not.
        if (across(event) > Math.abs(offset)) {
          drag = null;
          return;
        }
        drag.moving = true;
        element.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
      drag.samples.push({ at: event.timeStamp, offset });
      if (drag.samples.length > 5) {
        drag.samples.shift();
      }
      place(offset);
    };
    const onUp = (event: PointerEvent) => {
      if (drag?.id !== event.pointerId) {
        return;
      }
      const ended = drag;
      drag = null;
      if (!ended.moving) {
        return;
      }
      if (element.hasPointerCapture(event.pointerId)) {
        element.releasePointerCapture(event.pointerId);
      }
      const offset = latest.current.direction === 'down' ? event.clientY - ended.y : ended.x - event.clientX;
      const first = ended.samples[0];
      const last = ended.samples.at(-1) ?? first;
      const speed = last.at > first.at ? (last.offset - first.offset) / (last.at - first.at) : 0;
      if (event.type === 'pointerup' && (offset > ended.size * DISTANCE_SHARE || (speed > FLICK_SPEED && offset > SLOP))) {
        latest.current.onDismiss();
        return;
      }
      settle();
    };
    element.addEventListener('pointerdown', onDown);
    element.addEventListener('pointermove', onMove);
    element.addEventListener('pointerup', onUp);
    element.addEventListener('pointercancel', onUp);
    return () => {
      element.removeEventListener('pointerdown', onDown);
      element.removeEventListener('pointermove', onMove);
      element.removeEventListener('pointerup', onUp);
      element.removeEventListener('pointercancel', onUp);
    };
  }, [ref]);
}
