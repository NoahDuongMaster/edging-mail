import React from 'react';
import { createPortal } from 'react-dom';
import { cx } from './cx';
import { useLayer } from './layers';
import { positionNextTo, type Align } from './position';

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
  className,
  children,
  ...div
}: Omit<PopoverProps, 'open'>) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  useLayer(true, () => onClose('escape'));

  // Before the first paint, and again when the window changes size or the page scrolls (a scroll inside the popup itself is not one).
  React.useLayoutEffect(() => {
    const place = () => {
      if (panelRef.current !== null && anchorRef.current !== null) {
        positionNextTo(panelRef.current, anchorRef.current, align, matchWidth);
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
  }, [anchorRef, align, matchWidth]);

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
