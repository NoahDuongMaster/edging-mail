import React from 'react';
import { announcement, subscribeAnnouncements, type Announcement } from '../lib/announce';

const NOTHING: Announcement = Object.freeze({ text: '', id: 0 });
const nothing = (): Announcement => NOTHING;
const polite = (): Announcement => announcement('polite');
const assertive = (): Announcement => announcement('assertive');

/**
 * The app's two live regions, mounted once with the first render (main.tsx) and never unmounted, so a screen reader is already
 * listening when a text arrives (WCAG 4.1.3, ARIA22): a polite `role="status"` for what happened ("Archived", "3 results") and a
 * `role="alert"` for what went wrong. Nothing is seen; `announce()` from `lib/announce` fills them.
 */
export function LiveRegion(): React.ReactElement {
  const status = React.useSyncExternalStore(subscribeAnnouncements, polite, nothing);
  const urgent = React.useSyncExternalStore(subscribeAnnouncements, assertive, nothing);
  return (
    <>
      <div role="status" aria-live="polite" aria-atomic="true" className="ui-visually-hidden" data-live-region="polite">
        {status.text}
      </div>
      <div role="alert" aria-live="assertive" aria-atomic="true" className="ui-visually-hidden" data-live-region="assertive">
        {urgent.text}
      </div>
    </>
  );
}
