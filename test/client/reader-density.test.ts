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
// pane's width decides whether every action shows its words (`labelled`) or none does (v3 lead review R1: never a mix), the side padding, and
// whether the counter ("1 of 7") has room. The numbers are the arithmetic in reader/barDensity.ts (8 buttons, 2 group breaks drawn as space
// that keep a margin in every density).

const FINE = BAR_BUTTON_WIDTH.fine * 8;
const COARSE = BAR_BUTTON_WIDTH.coarse * 8;

describe('barLayout with a mouse', () => {
  it('is full when the pane is not measured yet, so the bar never shows a frame in the wrong density', () => {
    expect(barLayout(null, false)).toEqual({ density: 'full', words: 0 });
    expect(barLayout(null, true)).toEqual({ density: 'full', words: 0 });
  });

  it('is full from 420 px, snug from 354 px, and tight under that (W5: the groups 20 px apart in the roomy densities)', () => {
    expect(barLayout(420, false).density).toBe('full');
    expect(barLayout(419, false).density).toBe('snug');
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
  it('is full from 490 px, snug from 424 px, and tight under that (the buttons are 40 px wide; the two moves keep a 6 px gap, J5-10)', () => {
    expect(MOVE_GAP_COARSE).toBe(6);
    expect(barLayout(490, true).density).toBe('full');
    expect(barLayout(489, true).density).toBe('snug');
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

describe('barLayout with words beside the icons: every action or none (J4-18, J6-09, v3 R1)', () => {
  // The words are measured in the browser (wordWidths: their words in Geist 500 13 px + LABELLED_CHROME each), one per action. Inbox in en:
  // Archive 90, Move to Trash 130, Snooze 90, Add label 102, Mark as unread 139, Move to Spam 132.
  const EN_INBOX = [90, 130, 90, 102, 139, 132];
  // Trash in vi: Chuyển về Hộp thư đến 193, Xóa vĩnh viễn 125, Lưu trữ 88, Gắn nhãn 102, Đánh dấu chưa đọc 161, Chuyển vào Thư rác 163.
  const VI_TRASH = [193, 125, 88, 102, 161, 163];

  it('labels every action once all the words fit, and none below that (never a mix of labelled and bare actions)', () => {
    // 76 + 72 + 2 x 32 + 683 = 895 (the padding and the group breaks: 24 + 2 x 10 + 2 x 16; W5: groups 20 px apart).
    expect(barLayout(895, false, EN_INBOX)).toEqual({ density: 'labelled', words: 6 });
    expect(barLayout(894, false, EN_INBOX)).toEqual({ density: 'full', words: 0 });
    // A 1440 px window (a reader sheet of about 704 px) is icons with tooltips.
    expect(barLayout(704, false, EN_INBOX)).toEqual({ density: 'full', words: 0 });
    // Trash and Spam: three group breaks (Delete forever stands apart): 94 + 72 + 2 x 32 + 832 = 1062.
    expect(barLayout(1062, false, VI_TRASH, 3)).toEqual({ density: 'labelled', words: 6 });
    expect(barLayout(1061, false, VI_TRASH, 3).words).toBe(0);
    for (let width = 300; width <= 1600; width += 1) {
      expect([0, EN_INBOX.length], `${width} px`).toContain(barLayout(width, false, EN_INBOX).words);
    }
    // Not measured (the server, the first render): icons, never words that might not fit.
    expect(barLayout(1200, false, null)).toEqual({ density: 'full', words: 0 });
    expect(barLayout(1200, false)).toEqual({ density: 'full', words: 0 });
  });

  it('counts the wider icon buttons of a touch screen, and the gap between its two bins (J5-10)', () => {
    // 76 + 6 + 72 + 2 x 40 + 683 = 917.
    expect(barLayout(917, true, EN_INBOX).words).toBe(6);
    expect(barLayout(916, true, EN_INBOX).words).toBe(0);
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
  // en Inbox, one word per action: Archive, Move to Trash, Snooze, Mark unread, Labels, Move to Spam (649 + 212 = 861 px to label them all).
  const WORDS = [90, 130, 90, 119, 88, 132];

  it('puts the first glyph and the last (Older) on the content edges of the column when the bar has the room', () => {
    // A sheet of 876 px (880 or less: the letter starts on the left, its content 32 px in). Icons: the glyphs reach the column.
    const icons = barLayout(876, false, null);
    expect(icons).toEqual({ density: 'full', words: 0 });
    expect(barAlignment(876, false, icons)).toEqual({ start: 32 - 8, end: 32 - 8 });
    // All six words (861 px) leave 15 px of the 21 the glyphs want: they move in that far, in proportion (a labelled Archive draws its
    // icon 11 px in).
    const layout = barLayout(876, false, WORDS);
    expect(layout).toEqual({ density: 'labelled', words: 6 });
    expect(barAlignment(876, false, layout, WORDS)).toEqual({ start: 12 + 6, end: 12 + 8 });
    // A sheet wider than 880 px centres the letter (800 px: 720 of content and 40 each side): the glyphs follow it.
    const wide = barLayout(1200, false, null);
    const column = (1200 - READING_COLUMN.max) / 2 + READING_COLUMN.side;
    expect(READING_COLUMN).toMatchObject({ max: 800, side: 40, wide: 880, midSide: 32 });
    expect(barAlignment(1200, false, wide)).toEqual({ start: column - 8, end: column - 8 });
  });

  it('keeps every word when the room is too small for the glyphs to reach the column (alignedLayout: never a word given back, R1)', () => {
    // 870 px: the six words fit (861) with 9 px to spare; the glyphs move in as far as those 9 px allow.
    const layout = alignedLayout(870, false, WORDS);
    expect(layout).toEqual({ density: 'labelled', words: 6 });
    expect(barAlignment(870, false, layout, WORDS)).toEqual({ start: 12 + 3, end: 12 + 5 });
    for (let width = 300; width <= 1600; width += 1) {
      expect([0, WORDS.length], `${width} px`).toContain(alignedLayout(width, false, WORDS).words);
    }
    // The other densities are barLayout's.
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
