import React from 'react';
import { createPortal } from 'react-dom';
import { useExitMotion } from './motion';
import { positionNextTo } from './position';

interface TooltipProps {
  open: boolean;
  text: string;
  /** The control the tooltip names. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** The pointer came onto the bubble (it stays while the pointer is on it: WCAG 1.4.13, hoverable). */
  onPointerEnter?: () => void;
  /** The pointer left the bubble. */
  onPointerLeave?: () => void;
  /** It replaces another tooltip (a warm hand-off along a toolbar): it shows at full opacity at once, no fade. */
  instant?: boolean;
  /** True when it closes because another tooltip replaced it: it goes at once, without the exit fade (no two labels over each other). */
  replacedRef?: React.RefObject<boolean>;
}

/**
 * A small label under (or, with no room, over) a control. It repeats the control's accessible name for people who see, so it is hidden
 * from screen readers. It fades in (no move), fades out in 110 ms on an inert copy (motion.ts), the pointer can go onto it without losing
 * it, and Escape hides it from anywhere (1.4.13). In a warm hand-off (the pointer or the focus moves on to a neighbour while one shows)
 * the new one is there at once and the old one goes without its fade, so two labels never overlap (J2-17). IconButton shows it after a short rest of the mouse and at once on keyboard focus
 * (`useTooltip`); use it directly only for a control that is not an IconButton.
 */
export function Tooltip({ open, ...rest }: TooltipProps): React.ReactElement | null {
  return open ? <TooltipBubble {...rest} /> : null;
}

function TooltipBubble({ text, anchorRef, onPointerEnter, onPointerLeave, instant = false, replacedRef }: Omit<TooltipProps, 'open'>) {
  const bubbleRef = React.useRef<HTMLDivElement | null>(null);
  useExitMotion(bubbleRef, 'tooltip', replacedRef);
  // A hand-off: a label that is still fading out (the last one closed a moment ago) goes now, so the two never overlap.
  React.useLayoutEffect(() => {
    if (instant) {
      for (const ghost of document.querySelectorAll('.ui-tooltip[data-leaving="true"]')) {
        ghost.remove();
      }
    }
  }, [instant]);
  React.useLayoutEffect(() => {
    if (bubbleRef.current !== null && anchorRef.current !== null) {
      positionNextTo(bubbleRef.current, anchorRef.current, 'center', false);
    }
  }, [anchorRef, text]);
  return createPortal(
    <div
      ref={bubbleRef}
      className="ui-tooltip"
      data-instant={instant ? 'true' : undefined}
      aria-hidden="true"
      onPointerEnter={onPointerEnter === undefined ? undefined : () => onPointerEnter()}
      onPointerLeave={onPointerLeave === undefined ? undefined : () => onPointerLeave()}
    >
      {text}
    </div>,
    document.body
  );
}

/** How long the mouse rests on a control before its tooltip opens (hover intent: sweeping across a toolbar opens none). */
export const TOOLTIP_OPEN_DELAY_MS = 500;
/** After a tooltip closed, the next one opens at once for this long (moving along a toolbar once one label is up). */
const WARM_MS = 300;
/** How long a tooltip waits after the pointer left its control before it goes: time to move the pointer onto the bubble. */
const LEAVE_GRACE_MS = 150;

/**
 * One tooltip at a time, shared by every control of the page: `hide` closes the one that shows (a neighbour's label replaces it at once),
 * and the next one skips the delay while one shows or until `until` (set when the last one closed).
 */
const warm: { hide: (() => void) | null; until: number } = { hide: null, until: 0 };

/**
 * The tooltip state of a control. A mouse that RESTS on it for 500 ms opens it (one that only passes over opens nothing), at once when
 * another tooltip closed less than 300 ms ago; a control that moved under a still pointer (the next row after an archive) opens nothing
 * until the pointer moves. Keyboard focus opens it at once (`show`). It stays while the pointer moves onto the bubble, and goes on a
 * press, on blur, after the pointer has left both, and on Escape pressed anywhere while it shows (WCAG 1.4.13). Spread `anchor` on the
 * control and `bubble` on the Tooltip.
 */
export function useTooltip(): {
  open: boolean;
  show: (on: boolean) => void;
  anchor: {
    onPointerEnter: (event: React.PointerEvent) => void;
    onPointerMove: (event: React.PointerEvent) => void;
    onPointerLeave: () => void;
  };
  bubble: { onPointerEnter: () => void; onPointerLeave: () => void; instant: boolean; replacedRef: React.RefObject<boolean> };
} {
  const [open, setOpen] = React.useState(false);
  // Opened while another one showed or had just closed: no fade in. Set true by the next tooltip that takes over: no fade out.
  const [instant, setInstant] = React.useState(false);
  const replacedRef = React.useRef(false);
  const openNow = React.useCallback((fromWarm: boolean) => {
    replacedRef.current = false;
    setInstant(fromWarm);
    setOpen(true);
  }, []);
  const openTimer = React.useRef<number | undefined>(undefined);
  const closeTimer = React.useRef<number | undefined>(undefined);
  const cancelOpen = React.useCallback(() => {
    window.clearTimeout(openTimer.current);
    openTimer.current = undefined;
  }, []);
  const cancelClose = React.useCallback(() => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = undefined;
  }, []);
  const show = React.useCallback(
    (on: boolean) => {
      cancelOpen();
      cancelClose();
      if (on) {
        openNow(warm.hide !== null || performance.now() < warm.until);
      } else {
        setOpen(false);
      }
    },
    [cancelOpen, cancelClose, openNow]
  );
  const leaveSoon = React.useCallback(() => {
    cancelOpen();
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), LEAVE_GRACE_MS);
  }, [cancelOpen, cancelClose]);

  React.useEffect(() => {
    if (!open) {
      return;
    }
    // Escape hides it wherever focus is (the pointer may rest on a control that does not have focus). The key goes on to whoever wants it.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    // Called by the next tooltip that opens: this one goes without its exit fade.
    const hide = () => {
      replacedRef.current = true;
      setOpen(false);
    };
    warm.hide?.();
    warm.hide = hide;
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      if (warm.hide === hide) {
        warm.hide = null;
      }
      // This one closes (or its control goes away): a neighbour reached within the warm window opens at once.
      warm.until = performance.now() + WARM_MS;
    };
  }, [open]);
  React.useEffect(
    () => () => {
      cancelOpen();
      cancelClose();
    },
    [cancelOpen, cancelClose]
  );

  return {
    open,
    show,
    anchor: {
      onPointerEnter: (event) => {
        // Back from the bubble onto the control: it stays. Otherwise nothing yet: the pointer has to move on the control first.
        if (event.pointerType === 'mouse' && open) {
          cancelClose();
        }
      },
      onPointerMove: (event) => {
        if (event.pointerType !== 'mouse' || open || openTimer.current !== undefined) {
          return;
        }
        // No movement: the control arrived under a pointer that rests (a layout change, a scroll), which is no wish to see its name.
        if (event.movementX === 0 && event.movementY === 0) {
          return;
        }
        cancelClose();
        if (warm.hide !== null || performance.now() < warm.until) {
          openNow(true);
          return;
        }
        openTimer.current = window.setTimeout(() => {
          openTimer.current = undefined;
          openNow(false);
        }, TOOLTIP_OPEN_DELAY_MS);
      },
      onPointerLeave: leaveSoon
    },
    bubble: { onPointerEnter: cancelClose, onPointerLeave: leaveSoon, instant, replacedRef }
  };
}
