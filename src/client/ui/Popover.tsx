import React from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import { useLayer } from './layers';
import { useExitMotion } from './motion';
import { positionNextTo, type Align, type PreferredSide } from './position';

export interface PopoverProps extends Omit<React.ComponentProps<'div'>, 'ref'> {
  open: boolean;
  /** The element the popup hangs from. A press on it does not count as "outside" (its own click handler decides). */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Called when the popup should close: Escape, or a press outside the popup and its anchor. */
  onClose: (reason: 'escape' | 'outside') => void;
  /** Which edge of the anchor the popup lines up with. */
  align?: Align;
  /** At least as wide as the anchor (the list of a Select). */
  matchWidth?: boolean;
  /** The side it tries first: below (default), above, or `auto` (the side with more room). It still flips when it does not fit. */
  side?: PreferredSide;
  /** Px to move it sideways from its alignment (negative: to the left), before it is kept inside the viewport. */
  alignOffset?: number;
  /** The element it is placed next to when that is not the anchor itself (the glyph inside a larger touch box). Default: the anchor. */
  placeRef?: React.RefObject<HTMLElement | null>;
  /**
   * A popup that holds no control (InfoTip's bubble): it still takes Escape while it is on top, but a dialog under it keeps trapping Tab
   * (layers.ts `passive`).
   */
  passive?: boolean;
}

/**
 * The floating panel under Select, Menu and anything else that opens from a button. It is drawn in `document.body`, so no parent with
 * `overflow` clips it, and it flips above the anchor when there is no room below. It closes on Escape (only when it is the top layer)
 * and on a press outside. It does not move focus: the component that uses it decides where focus goes.
 */
export function Popover({ open, ...rest }: PopoverProps): React.ReactElement | null {
  return open ? <PopoverPanel {...rest} /> : null;
}

/** True when `node` is inside the element of `ref` (false while there is none). */
const contains = (ref: React.RefObject<HTMLElement | null>, node: Node): boolean => ref.current?.contains(node) === true;

function PopoverPanel({
  anchorRef,
  onClose,
  align = 'start',
  matchWidth = false,
  side = 'below',
  alignOffset = 0,
  placeRef,
  passive = false,
  className,
  children,
  ...div
}: Omit<PopoverProps, 'open'>) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  useLayer(true, () => onClose('escape'), undefined, passive);
  // It leaves on an inert copy that fades in 140 ms (motion.ts); the popup itself is gone at once.
  useExitMotion(panelRef, 'popup');

  // Before the first paint, and again when the window changes size or the page scrolls (a scroll inside the popup itself is not one).
  React.useLayoutEffect(() => {
    const place = () => {
      const next = placeRef?.current ?? anchorRef.current;
      if (panelRef.current !== null && next !== null) {
        positionNextTo(panelRef.current, next, align, matchWidth, side, alignOffset);
      }
    };
    const onScroll = (event: Event) => {
      if (!(event.target instanceof Node && contains(panelRef, event.target))) {
        place();
      }
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [anchorRef, placeRef, align, matchWidth, side, alignOffset]);

  React.useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && !contains(panelRef, target) && !contains(anchorRef, target)) {
        onClose('outside');
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [anchorRef, onClose]);

  return createPortal(
    <div ref={panelRef} className={cx('ui-popover', className)} {...div}>
      {children}
    </div>,
    document.body
  );
}
