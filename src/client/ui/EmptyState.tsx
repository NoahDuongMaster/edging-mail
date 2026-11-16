import React from 'react';
import { cx } from './cx';
import { has } from './Field';

interface EmptyStateProps {
  title: string;
  description?: string;
  /** At most one button or link: what to do next. */
  action?: React.ReactNode;
  /** Shows a small Edgar (112 px) above the text. For a screen that is empty or has failed as a whole, not for an empty table inside a page. */
  illustration?: boolean;
  /**
   * Edgar gives one small settle (a tilt and a bob) after 600 ms and one more 2.6 s later, then stays still: all of it within 5 s, never
   * under reduced motion, and only the first time this title is shown in the session (M20). For the status screens (empty Inbox, empty
   * reader, offline, Setup not ready); not for a failure (a moving mascot next to an error reads as flippant).
   */
  idle?: boolean;
  /** The level of the title: h2 inside a page (default), h1 when the empty state IS the page (the crash screen). */
  titleAs?: 'h1' | 'h2';
  /**
   * A drawing above the title (a FlightTrail): the v3 empty state's art, decorative (give it aria-hidden). Use `illustration` instead for
   * Edgar on the status screens; with both, Edgar comes first.
   */
  art?: React.ReactNode;
  className?: string;
}

/** The titles whose Edgar has already played his idle beats in this page session: coming back to the same empty screen shows him still. */
const played = new Set<string>();

/**
 * Edgar's idle beats (M20) on an `<img className="ui-empty-art">` of a screen of its own (Setup not ready draws Edgar in its card): the
 * first time the screen named `key` shows in this page session, before it is painted; never again after that.
 */
export function useIdleBeat(ref: React.RefObject<HTMLElement | null>, idle: boolean, key: string): void {
  // The beats are asked for on the element itself (data-idle, ui.css) the first time this screen shows, before it is painted.
  React.useLayoutEffect(() => {
    const node = ref.current;
    if (idle && node !== null && !played.has(key)) {
      played.add(key);
      node.dataset.idle = 'true';
    }
  }, [ref, idle, key]);
}

/**
 * What a place shows when there is nothing in it, or it cannot be shown: one sentence of what is going on, one line of why or what next,
 * at most one action. Centred in the room it has. Edgar is optional and small.
 */
export function EmptyState({
  title,
  description,
  action,
  illustration = false,
  idle = false,
  titleAs: Title = 'h2',
  art,
  className
}: EmptyStateProps): React.ReactElement {
  const artRef = React.useRef<HTMLImageElement | null>(null);
  useIdleBeat(artRef, idle, title);
  return (
    <div className={cx('ui-empty', className)}>
      {illustration ? <img ref={artRef} src="/edgar.svg" alt="" width={112} height={109} className="ui-empty-art" /> : null}
      {art === undefined || art === null ? null : (
        <div className="ui-empty-slot" aria-hidden="true">
          {art}
        </div>
      )}
      <Title className="ui-empty-title">{title}</Title>
      {has(description) ? <p className="ui-empty-description">{description}</p> : null}
      {action === undefined ? null : <div className="ui-empty-action">{action}</div>}
    </div>
  );
}
