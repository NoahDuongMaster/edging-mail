import { describe, expect, it } from 'vitest';
import {
  BAR_BUTTON_WIDTH,
  LABELLED_CHROME,
  MOVE_GAP_COARSE,
  READING_COLUMN,
  alignedLayout,
  barAlignment,
  barLayout,
  barNeeds,
  replyDensity
} from '../../src/client/components/reader/barDensity';

// How the desktop reader toolbar fits its pane. The buttons have a fixed width (32 px with a mouse, 40 px on a touch screen wider than a phone), and the
// pane's width decides which actions show their words (`labelled`: the most used first), the side padding, and whether the counter ("1 of 7") has
// room. The numbers are the arithmetic in reader/barDensity.ts (8 buttons, 2 dividers that keep a margin in every density).

const FINE = BAR_BUTTON_WIDTH.fine * 8;
const COARSE = BAR_BUTTON_WIDTH.coarse * 8;

describe('barLayout with a mouse', () => {
  it('is full when the pane is not measured yet, so the bar never shows a frame in the wrong density', () => {
    expect(barLayout(null, false)).toEqual({ density: 'full', words: 0 });
    expect(barLayout(null, true)).toEqual({ density: 'full', words: 0 });
  });

  it('is full from 414 px, snug from 354 px, and tight under that', () => {
    expect(barLayout(414, false).density).toBe('full');
    expect(barLayout(413, false).density).toBe('snug');
    expect(barLayout(354, false).density).toBe('snug');
    expect(barLayout(353, false).density).toBe('tight');
  });

  it('keeps the counter on the narrowest desktop window (901 px wide: a reader pane of about 359 px)', () => {
    expect(barLayout(359, false).density).toBe('snug');
    expect(barLayout(340, false).density).toBe('tight');
  });

  it('never needs more than the pane has: the buttons and the dividers (with their margins) fit in every density', () => {
    for (let width = FINE + 20; width <= 1200; width += 1) {
      expect(barNeeds(barLayout(width, false), false), `${width} px`).toBeLessThanOrEqual(width);
    }
  });
});

describe('barLayout on a touch screen', () => {
  it('is full from 484 px, snug from 424 px, and tight under that (the buttons are 40 px wide; the two moves keep a 6 px gap, J5-10)', () => {
    expect(MOVE_GAP_COARSE).toBe(6);
    expect(barLayout(484, true).density).toBe('full');
    expect(barLayout(483, true).density).toBe('snug');
    expect(barLayout(424, true).density).toBe('snug');
    expect(barLayout(423, true).density).toBe('tight');
  });

  it('never needs more than the pane has', () => {
    // The narrowest bar: the buttons, the tight padding and dividers (18 px) and the bins' gap.
    for (let width = COARSE + 18 + MOVE_GAP_COARSE; width <= 1200; width += 1) {
      expect(barNeeds(barLayout(width, true), true), `${width} px`).toBeLessThanOrEqual(width);
    }
  });

  it('gives a landscape tablet (1024 px wide: a reader pane of about 428 px) the counter, and the groups their gaps', () => {
    expect(barLayout(428, true).density).toBe('snug');
  });
});

describe('barLayout with words beside the icons, the most used actions first (J4-18, J6-09)', () => {
  // The words are measured in the browser (wordWidths: their words in Geist 500 13 px + LABELLED_CHROME each), in the order they get them. Inbox
  // in en: Archive 90, Move to Trash 130, Snooze 90, Add label 102, Mark as unread 139, Move to Spam 132 (the rare one last).
  const EN_INBOX = [90, 130, 90, 102, 139, 132];
  // Trash in vi: Chuyển về Hộp thư đến 193, Xóa vĩnh viễn 125, Lưu trữ 88, Gắn nhãn 102, Đánh dấu chưa đọc 161, Chuyển vào Thư rác 163.
  const VI_TRASH = [193, 125, 88, 102, 161, 163];

  it('labels Archive, Move to Trash, Snooze, Label and Mark as unread before Move to Spam on a 1440 px window (a pane of about 790 px)', () => {
    // 70 + 72 + 3 x 32 + (90 + 130 + 90 + 102 + 139) = 789.
    expect(barLayout(790, false, EN_INBOX)).toEqual({ density: 'labelled', words: 5 });
    expect(barLayout(789, false, EN_INBOX)).toEqual({ density: 'labelled', words: 5 });
    expect(barLayout(788, false, EN_INBOX)).toEqual({ density: 'labelled', words: 4 });
    // Every word: 70 + 72 + 2 x 32 + 683 = 889.
    expect(barLayout(889, false, EN_INBOX)).toEqual({ density: 'labelled', words: 6 });
    expect(barLayout(888, false, EN_INBOX)).toEqual({ density: 'labelled', words: 5 });
  });

  it('gives words one action at a time, from the most used, and none where not even Archive fits', () => {
    // Archive and Move to Trash: 70 + 72 + 6 x 32 + 220 = 554; Archive alone: 70 + 72 + 7 x 32 + 90 = 456.
    expect(barLayout(554, false, EN_INBOX).words).toBe(2);
    expect(barLayout(553, false, EN_INBOX).words).toBe(1);
    expect(barLayout(456, false, EN_INBOX).words).toBe(1);
    expect(barLayout(455, false, EN_INBOX)).toEqual({ density: 'full', words: 0 });
    // Trash and Spam: Move to Inbox, then Delete forever (named as soon as there is room).
    expect(barLayout(70 + 72 + 6 * 32 + 193 + 125, false, VI_TRASH).words).toBe(2);
    // Not measured (the server, the first render): icons, never words that might not fit.
    expect(barLayout(1200, false, null)).toEqual({ density: 'full', words: 0 });
    expect(barLayout(1200, false)).toEqual({ density: 'full', words: 0 });
  });

  it('counts the wider icon buttons of a touch screen, and the gap between its two bins (J5-10)', () => {
    // 70 + 6 + 72 + 6 x 40 + 220 = 608.
    expect(barLayout(608, true, EN_INBOX).words).toBe(2);
    expect(barLayout(607, true, EN_INBOX).words).toBe(1);
  });

  it('never needs more than the pane has: a labelled bar fits whenever it is chosen', () => {
    for (const words of [EN_INBOX, VI_TRASH]) {
      for (let width = 300; width <= 1400; width += 1) {
        for (const coarse of [false, true]) {
          const layout = barLayout(width, coarse, words);
          if (layout.density === 'labelled') {
            expect(barNeeds(layout, coarse, words), `${width} px`).toBeLessThanOrEqual(width);
          }
        }
      }
    }
    expect(LABELLED_CHROME).toBe(44);
  });
});

describe('replyDensity: Reply, Reply all and Forward on one row of a desktop column', () => {
  // What the row needs in each density in the longest language, vi (reader/barDensity.ts has the measurement; en needs less).
  const NEEDED = { full: 381, snug: 343, tight: 271 } as const;

  it('is full when the row is not measured yet, and from 384 px; snug from 346 px; tight under that', () => {
    expect(replyDensity(null)).toBe('full');
    expect(replyDensity(384)).toBe('full');
    expect(replyDensity(383)).toBe('snug');
    expect(replyDensity(346)).toBe('snug');
    expect(replyDensity(345)).toBe('tight');
  });

  it('keeps the row to one line on the desktop widths that were seen wrapping or crowded (901, 1024, 1440 px windows)', () => {
    // 901 px window: a column of about 295 px (281 with a classic scrollbar); 1024 px: about 363; 1440 px: about 696.
    expect(replyDensity(295)).toBe('tight');
    expect(replyDensity(281)).toBe('tight');
    expect(replyDensity(363)).toBe('snug');
    expect(replyDensity(696)).toBe('full');
  });

  it('never needs more than the column has, from the narrowest desktop column up', () => {
    for (let width: number = NEEDED.tight; width <= 1200; width += 1) {
      expect(NEEDED[replyDensity(width)], `${width} px`).toBeLessThanOrEqual(width);
    }
  });
});

describe('the toolbar glyphs on the reading column (J3-36)', () => {
  // en Inbox, the words in the order they get them: Archive, Move to Trash, Snooze, Mark unread, Labels, Move to Spam.
  const WORDS = [90, 130, 90, 119, 88, 132];

  it('puts the first glyph (a labelled Archive) and the last (Older) on the content edges of the column when the bar has the room', () => {
    // 1440 px window, a pane of 754: four words (699 px), 55 px left over; the column's content starts 32 px in.
    const layout = barLayout(754, false, WORDS);
    expect(layout).toEqual({ density: 'labelled', words: 4 });
    expect(barAlignment(754, false, layout, WORDS)).toEqual({ start: 32 - 11, end: 32 - 8 });
    // A wide pane centres the column: the glyphs follow it.
    const wide = barLayout(1200, false, null);
    const column = (1200 - READING_COLUMN.max) / 2 + READING_COLUMN.side;
    expect(barAlignment(1200, false, wide)).toEqual({ start: column - 8, end: column - 8 });
  });

  it('gives the last word back to its icon rather than leave the glyphs off the column (alignedLayout)', () => {
    // 760 px: five words fit (755) with no room to move the glyphs; aligned, four words and the glyphs on the column.
    expect(barLayout(760, false, WORDS)).toEqual({ density: 'labelled', words: 5 });
    const layout = alignedLayout(760, false, WORDS);
    expect(layout).toEqual({ density: 'labelled', words: 4 });
    expect(barAlignment(760, false, layout, WORDS)).toEqual({ start: 32 - 11, end: 32 - 8 });
    // Never fewer than one word, and the other densities are barLayout's.
    expect(alignedLayout(456, false, WORDS)).toEqual(barLayout(456, false, WORDS));
    expect(alignedLayout(437, true)).toEqual(barLayout(437, true));
  });

  it('moves them only as far as the room left over allows: never a word or the counter less (a tablet pane of 437 px)', () => {
    const layout = barLayout(437, true);
    expect(layout.density).toBe('snug');
    // A pane of 480 px or less has 24 px margins (reader.css): 437 px on a touch screen has the 8 px the glyphs need on each side.
    const { start, end } = barAlignment(437, true, layout);
    expect([start, end]).toEqual([24 - 12, 24 - 12]);
    expect(barNeeds(layout, true) + (start - 8) + (end - 8)).toBeLessThanOrEqual(437);
    for (let width = 340; width <= 1600; width += 7) {
      for (const coarse of [false, true]) {
        const each = barLayout(width, coarse, WORDS);
        const side = barAlignment(width, coarse, each, WORDS);
        const plain = { labelled: 12, full: 12, snug: 8, tight: 4 }[each.density];
        const room = Math.max(0, width - barNeeds(each, coarse, WORDS));
        expect(side.start + side.end - 2 * plain, `${width} px`).toBeLessThanOrEqual(room);
      }
    }
  });
});
