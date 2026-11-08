import React from 'react';

/** How the reader toolbar fits its pane: `phone` is the compact toolbar (index.css `.nm-bar`), the rest are the desktop one. */
export type BarDensity = 'phone' | 'full' | 'snug' | 'tight';

/**
 * The width of a toolbar button in px, for each kind of pointer. reader.css sets the same numbers (`--rd-btn` on `.rd-bar`): a dense
 * 32 px button for a mouse, 40 px (44 high) on a touch screen wider than a phone, such as a landscape tablet.
 */
export const BAR_BUTTON_WIDTH = { fine: 32, coarse: 40 } as const;

/** The most buttons the desktop bar holds: 3 + 3 for the message (Trash and Spam: 4 + 2) and Newer / Older. */
const BUTTONS = 8;

// How the desktop toolbar fits its pane, from the pane's inner width. The buttons have a fixed width; the counter ("100 of 100") takes what
// is left and gives way (it is cut with an ellipsis, it never wraps the row). All in px, for w = BAR_BUTTON_WIDTH:
//   full:  side padding 12, gaps 2, divider margin 6  -> 24 + 18 + 13 = 55 (57 with room to spare) + 8w, and 88 for the counter
//   snug:  side padding 8, no gaps or margins         -> 16 + 1 = 17 + 8w, and 72 for the counter
//   tight: side padding 4, no counter                 -> 8 + 1 = 9 + 8w
// With a mouse (w = 32) the narrowest desktop window (901 px wide, a reader pane of about 359) is `snug` and shows the counter; with a touch
// screen (w = 40) a pane under 409 px drops the counter and stays one row.
const FULL_FIXED = 57;
const FULL_COUNTER = 88;
const SNUG_FIXED = 17;
const SNUG_COUNTER = 72;

/** The density of the desktop toolbar for a pane `paneWidth` px wide (null: not measured yet), for a mouse or a touch screen. */
export function barDensity(paneWidth: number | null, coarse: boolean): Exclude<BarDensity, 'phone'> {
  if (paneWidth === null) {
    return 'full';
  }
  const buttons = BUTTONS * (coarse ? BAR_BUTTON_WIDTH.coarse : BAR_BUTTON_WIDTH.fine);
  if (paneWidth >= FULL_FIXED + buttons + FULL_COUNTER) {
    return 'full';
  }
  return paneWidth >= SNUG_FIXED + buttons + SNUG_COUNTER ? 'snug' : 'tight';
}

/** How Reply, Reply all and Forward fit a desktop column: `full` md buttons with icons, `snug` sm with icons, `tight` sm text only. */
export type ReplyDensity = 'full' | 'snug' | 'tight';

// The width the row of three needs in px, in the longest language (vi: "Trả lời", "Trả lời tất cả", "Chuyển tiếp"; en and zh need less),
// measured with Geist 500 (ui.css: md = 14px text and 14px padding, sm = 13px and 10px, a 16px icon and an 8px gap inside, 1px borders) with
// the 8px gaps of the row:
//   full:  381 (en 328)    snug: 342 (en 294)    tight: 270 (en 222)
// The narrowest desktop window (901 px) has a column of about 295 px (281 with a scrollbar), a 1024 px window about 363: so the row is one line
// on every desktop width, in every language.
const REPLY_FULL = 384;
const REPLY_SNUG = 346;

/** The density of the reply row for a column `rowWidth` px wide (null: not measured yet). */
export function replyDensity(rowWidth: number | null): ReplyDensity {
  if (rowWidth === null || rowWidth >= REPLY_FULL) {
    return 'full';
  }
  return rowWidth >= REPLY_SNUG ? 'snug' : 'tight';
}

const COARSE_POINTER = '(pointer: coarse)';

interface PaneMeasure {
  /** The inner width of the pane in px, or null until it has one. */
  width: number | null;
  /** The main pointer is a finger (a touch screen), so the toolbar buttons are wider. */
  coarse: boolean;
}

/** Ref for the element to measure: its inner width in px (null until it has one), kept current while it resizes. */
export function usePaneMeasure(): [(element: HTMLElement | null) => (() => void) | undefined, PaneMeasure] {
  const [width, setWidth] = React.useState<number | null>(null);
  const [coarse, setCoarse] = React.useState(false);
  const ref = React.useCallback((element: HTMLElement | null) => {
    if (element === null) {
      return;
    }
    const measure = () => {
      setWidth(element.clientWidth > 0 ? element.clientWidth : null);
      setCoarse(window.matchMedia(COARSE_POINTER).matches);
    };
    // Measured as soon as it is attached, before the first paint: the bar never shows a frame in the wrong density.
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, { width, coarse }];
}
