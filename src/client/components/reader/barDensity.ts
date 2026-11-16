import React from 'react';

/**
 * How the reader toolbar fits its pane: `phone` is the phone's bottom action bar (index.css `.nm-bar`), the rest are the desktop one.
 * `labelled`: EVERY action shows its words beside its icon (v3 lead review R1: never a mix of labelled and bare actions); `full`, `snug`
 * and `tight` are icons with tooltips, tighter and tighter. Newer and Older are always icons.
 */
export type BarDensity = 'phone' | 'labelled' | 'full' | 'snug' | 'tight';

/** The desktop bar for one pane: its density, and how many actions show their words (in the order of `wordWidths`: the most used first). */
export interface BarLayout {
  density: Exclude<BarDensity, 'phone'>;
  words: number;
}

/**
 * The width of a toolbar button in px, for each kind of pointer. reader.css sets the same numbers (`--rd-btn` on `.rd-bar`): a dense
 * 32 px button for a mouse, 40 px (44 high) on a touch screen wider than a phone, such as a landscape tablet.
 */
export const BAR_BUTTON_WIDTH = { fine: 32, coarse: 40 } as const;

/** The most buttons the desktop bar holds: Archive, 2 moves, Mark as unread, Snooze, Label (Trash and Spam: 3 moves, no Snooze), Newer, Older. */
const BUTTONS = 8;

/**
 * J5-10: on a touch screen the two bins of the move group (Move to Trash and Move to Spam; in Trash and Spam: Archive and the other bin) keep
 * this gap between them (reader.css `.rd-move + .rd-move`), so two 40 px targets that go to different places never touch. One gap per bar.
 */
export const MOVE_GAP_COARSE = 6;
const moveGaps = (coarse: boolean): number => (coarse ? MOVE_GAP_COARSE : 0);

/** What a labelled button (reader.css `.rd-lbl`: 10 px padding, a 16 px icon and a 6 px gap, 1 px borders) adds to the width of its words. */
export const LABELLED_CHROME = 10 + 16 + 6 + 10 + 2;

// How the desktop toolbar fits its pane, from the pane's inner width. The buttons have a fixed width; the counter ("100 of 100") takes what
// is left and gives way (it is cut with an ellipsis, it never wraps the row). The row is: Archive | the moves | Mark as unread, Snooze, Label
// (Trash and Spam: Move to Inbox, Archive, the other move | Mark as unread, Label | Delete forever), the counter, Newer, Older: 8 buttons,
// 2 or 3 group breaks and the counter. A group break is a 1 px separator drawn in no colour (v3 R1: groups are told apart by space, never by
// a line), so in the roomy densities two groups stand 2 + 7 + 1 + 8 + 2 = 20 px apart and the buttons of a group 2 px (W5 lead review 8).
// All in px, for w = BAR_BUTTON_WIDTH and d breaks:
//   labelled: as full, the counter at 72, EVERY action its words + LABELLED_CHROME (measured), Newer and Older w each
//   full:  side padding 12, gaps 2, break margins 7 + 8  -> 24 + 2 (8 + d) + 16d, + 8w, and 88 for the counter
//   snug:  side padding 8, no gaps, break margins 2  -> 16 + 5d, + 8w, and 72 for the counter
//   tight: side padding 4, no gaps, break margins 2  -> 8 + 5d, + 8w, no counter
// The breaks keep a margin in every density, so the groups never touch (Archive is never flush with Move to Trash on a tablet).
// With a mouse (w = 32) the narrowest desktop window (901 px wide, a reader pane of about 359) is `snug` and shows the counter; a landscape
// tablet (w = 40, a pane of about 440) is `snug` too.
// Words, measured in Geist 500 13 px (+ LABELLED_CHROME), Inbox in en: Archive 90, Move to Trash 130, Snooze 90, Mark unread 119, Labels 88,
// Move to Spam 132 (649): the bar has words from a pane of 76 + 72 + 2 x 32 + 649 = 861 px (a wide window); below that it is icons.
const LABELLED_COUNTER = 72;
const FULL_COUNTER = 88;
const SNUG_COUNTER = 72;
const fullFixed = (dividers: number) => 24 + 2 * (8 + dividers) + 16 * dividers;
const snugFixed = (dividers: number) => 16 + 5 * dividers;
const tightFixed = (dividers: number) => 8 + 5 * dividers;

/**
 * The layout of the desktop toolbar for a pane `paneWidth` px wide (null: not measured yet), for a mouse or a touch screen. `widths` are the
 * widths of the labelled actions (their words + LABELLED_CHROME, `wordWidths`), one per action of the bar; null when they are not known (the
 * server, a first render): then the bar has no words. `dividers`: 2, or 3 in Trash and Spam (Delete forever stands apart). Every action shows
 * its words when all of them fit, else none does (R1: one rule for the whole bar, never a mix); icons carry their names in tooltips.
 */
export function barLayout(paneWidth: number | null, coarse: boolean, widths: readonly number[] | null = null, dividers = 2): BarLayout {
  if (paneWidth === null) {
    return { density: 'full', words: 0 };
  }
  const width = coarse ? BAR_BUTTON_WIDTH.coarse : BAR_BUTTON_WIDTH.fine;
  const gaps = moveGaps(coarse);
  if (widths !== null && widths.length > 0) {
    const sum = widths.reduce((total, each) => total + each, 0);
    if (paneWidth >= fullFixed(dividers) + gaps + LABELLED_COUNTER + (BUTTONS - widths.length) * width + sum) {
      return { density: 'labelled', words: widths.length };
    }
  }
  const buttons = BUTTONS * width + gaps;
  if (paneWidth >= fullFixed(dividers) + buttons + FULL_COUNTER) {
    return { density: 'full', words: 0 };
  }
  return { density: paneWidth >= snugFixed(dividers) + buttons + SNUG_COUNTER ? 'snug' : 'tight', words: 0 };
}

/** The width in px each layout needs (for tests and for the reader's own checks): what `barLayout` counts with. */
export function barNeeds(layout: BarLayout, coarse: boolean, widths: readonly number[] = [], dividers = 2): number {
  const width = coarse ? BAR_BUTTON_WIDTH.coarse : BAR_BUTTON_WIDTH.fine;
  const gaps = moveGaps(coarse);
  switch (layout.density) {
    case 'labelled': {
      const words = widths.slice(0, layout.words).reduce((total, each) => total + each, 0);
      return fullFixed(dividers) + gaps + LABELLED_COUNTER + (BUTTONS - layout.words) * width + words;
    }
    case 'full': {
      return fullFixed(dividers) + gaps + BUTTONS * width + FULL_COUNTER;
    }
    case 'snug': {
      return snugFixed(dividers) + gaps + BUTTONS * width + SNUG_COUNTER;
    }
    case 'tight': {
      return tightFixed(dividers) + gaps + BUTTONS * width;
    }
  }
}

let context: CanvasRenderingContext2D | null | undefined;

/**
 * The reading column under the toolbar (reader.css `.rd-page`, v3 "the letter"): in a pane wider than `wide` px a column `max` px wide (720
 * px of content and `side` px of margin each side) centred in the pane; in a narrower one it starts on the left with `midSide` px margins (24
 * px in a pane of `narrow` px or less). The toolbar's first and last glyphs stand on that content edge when the bar has the room (J3-36).
 */
export const READING_COLUMN = { max: 800, side: 40, wide: 880, midSide: 32, narrow: 480, narrowSide: 24 } as const;

/** How far in from the pane's edge the reading column's content starts (reader.css `.rd-page` and its container queries). */
function columnInset(paneWidth: number): number {
  if (paneWidth > READING_COLUMN.wide) {
    return (paneWidth - READING_COLUMN.max) / 2 + READING_COLUMN.side;
  }
  return paneWidth <= READING_COLUMN.narrow ? READING_COLUMN.narrowSide : READING_COLUMN.midSide;
}

/** The side padding of the desktop bar in each density (reader.css), what `barLayout` counts with. */
const BAR_SIDE: Record<BarLayout['density'], number> = { labelled: 12, full: 12, snug: 8, tight: 4 };

/** How far in a labelled button draws its icon: its 1 px border and 10 px padding (reader.css `.rd-lbl`). */
const LABELLED_INSET = 11;

/** The 16 px glyph of an icon button sits in the middle of its `--rd-btn` width. */
const GLYPH = 16;

/**
 * J3-36: the side padding of the desktop bar that puts its first glyph (Archive, or Move to Inbox in Trash and Spam) and its last one (Older)
 * on the content edges of the reading column below, as far as the room the layout leaves allows: the bar never gives up a word or its counter
 * for it (`barLayout` is counted with the plain padding; only what is left over moves the glyphs in, shared in proportion on both sides).
 */
export function barAlignment(
  paneWidth: number,
  coarse: boolean,
  layout: BarLayout,
  widths: readonly number[] = [],
  dividers = 2
): { start: number; end: number } {
  const pad = BAR_SIDE[layout.density];
  const iconInset = ((coarse ? BAR_BUTTON_WIDTH.coarse : BAR_BUTTON_WIDTH.fine) - GLYPH) / 2;
  const column = columnInset(paneWidth);
  const wantStart = Math.max(0, column - (layout.words > 0 ? LABELLED_INSET : iconInset) - pad);
  const wantEnd = Math.max(0, column - iconInset - pad);
  const slack = Math.max(0, paneWidth - barNeeds(layout, coarse, widths, dividers));
  const share = wantStart + wantEnd === 0 ? 0 : Math.min(1, slack / (wantStart + wantEnd));
  return { start: pad + Math.floor(wantStart * share), end: pad + Math.floor(wantEnd * share) };
}

/**
 * The layout of a desktop bar whose words leave room for its glyphs to stand on the reading column (J3-36): `barLayout` counted with the
 * room the alignment wants taken off. A labelled bar keeps its words either way (R1: all or none; never a word given back to make room):
 * when the aligned room is too small it stays labelled and `barAlignment` moves its glyphs only as far as the room left over allows.
 */
export function alignedLayout(paneWidth: number | null, coarse: boolean, widths: readonly number[] | null = null, dividers = 2): BarLayout {
  const layout = barLayout(paneWidth, coarse, widths, dividers);
  if (paneWidth === null || layout.density !== 'labelled') {
    return layout;
  }
  const iconInset = ((coarse ? BAR_BUTTON_WIDTH.coarse : BAR_BUTTON_WIDTH.fine) - GLYPH) / 2;
  const column = columnInset(paneWidth);
  const want = Math.max(0, column - LABELLED_INSET - BAR_SIDE.labelled) + Math.max(0, column - iconInset - BAR_SIDE.labelled);
  const aligned = barLayout(paneWidth - want, coarse, widths, dividers);
  return aligned.density === 'labelled' ? aligned : layout;
}

/**
 * The width in px each of these `labels` takes as a labelled button: its words in the toolbar's face (500 13 px), measured in a canvas, plus
 * LABELLED_CHROME. Null where nothing can measure (the server, no canvas): then the bar stays icons.
 */
export function wordWidths(labels: readonly string[], fontFamily: string): number[] | null {
  if (typeof document === 'undefined') {
    return null;
  }
  if (context === undefined) {
    try {
      context = document.createElement('canvas').getContext('2d');
    } catch {
      context = null;
    }
  }
  if (context === null) {
    return null;
  }
  context.font = `500 13px ${fontFamily}`;
  const measure = context;
  return labels.map((label) => Math.ceil(measure.measureText(label).width) + LABELLED_CHROME);
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

/** A number that goes up once the page's fonts have loaded: measurements made in a fallback face are made again in the real one. */
export function useFontsLoaded(): number {
  const [epoch, setEpoch] = React.useState(0);
  React.useEffect(() => {
    let live = true;
    void document.fonts.ready.then(() => {
      if (live) {
        setEpoch((value) => value + 1);
      }
    });
    return () => {
      live = false;
    };
  }, []);
  return epoch;
}
