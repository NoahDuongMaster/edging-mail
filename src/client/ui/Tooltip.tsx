import React from 'react';
import { createPortal } from 'react-dom';
import { positionNextTo } from './position';

interface TooltipProps {
  open: boolean;
  text: string;
  /** The control the tooltip names. */
  anchorRef: React.RefObject<HTMLElement | null>;
}

/**
 * A small label under (or, with no room, over) a control. It repeats the control's accessible name for people who see, so it is hidden
 * from screen readers. IconButton shows it on hover and on keyboard focus; use it directly only for a control that is not an IconButton.
 */
export function Tooltip({ open, ...rest }: TooltipProps): React.ReactElement | null {
  return open ? <TooltipBubble {...rest} /> : null;
}

function TooltipBubble({ text, anchorRef }: Omit<TooltipProps, 'open'>) {
  const bubbleRef = React.useRef<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    if (bubbleRef.current !== null && anchorRef.current !== null) {
      positionNextTo(bubbleRef.current, anchorRef.current, 'center', false);
    }
  }, [anchorRef, text]);
  return createPortal(
    <div ref={bubbleRef} className="ui-tooltip" aria-hidden="true">
      {text}
    </div>,
    document.body
  );
}
