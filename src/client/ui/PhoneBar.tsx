import React from 'react';
import { cx } from './cx';

export interface PhoneBarProps {
  /** The title of the view: one line, cut with an ellipsis when it is too long. */
  title: React.ReactNode;
  /** Before the title: the way back or out (an IconButton: Back, Close). */
  start?: React.ReactNode;
  /** After the title: at most two actions (IconButtons, or one icon + label Button for an action that opens a flow: Add person). */
  end?: React.ReactNode;
  /** The element the title is: `h1` (default) for a page, `h2`/`h3` under another heading, `div` when the page has its own heading. */
  as?: 'h1' | 'h2' | 'h3' | 'div';
  titleId?: string;
  /** What scrolls under the bar (its hairline shows once that has moved off the top): a scroller's ref; default the window. */
  scroller?: React.RefObject<HTMLElement | null>;
  className?: string;
}

/**
 * The fixed top bar of a phone view (DESIGN-v4m R3): back/close, the title, at most two actions. 56 px high plus the safe area on top,
 * on the surface; it sticks to the top of what scrolls (`position: sticky`, so put it first in the page or in the scroller) and draws a
 * hairline under itself only once the content has scrolled under it (`data-scrolled`, from a passive scroll listener). Nothing renders
 * differently on the server. Show it where the layout is a phone's: the area decides (a media query or its phone flag).
 */
export function PhoneBar({ title, start, end, as: Title = 'h1', titleId, scroller, className }: PhoneBarProps): React.ReactElement {
  const barRef = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    const bar = barRef.current;
    if (bar === null) {
      return;
    }
    const box = scroller?.current ?? null;
    const target: HTMLElement | Window = box ?? window;
    const update = () => {
      const moved = box === null ? window.scrollY > 0 : box.scrollTop > 0;
      if (moved) {
        bar.dataset.scrolled = 'true';
      } else {
        delete bar.dataset.scrolled;
      }
    };
    update();
    target.addEventListener('scroll', update, { passive: true });
    return () => target.removeEventListener('scroll', update);
  }, [scroller]);
  return (
    <header ref={barRef} className={cx('ui-phonebar', className)}>
      {start === undefined ? null : <div className="ui-phonebar-start">{start}</div>}
      <Title id={titleId} className="ui-phonebar-title">
        {title}
      </Title>
      {end === undefined ? null : <div className="ui-phonebar-end">{end}</div>}
    </header>
  );
}
