import { describe, expect, it } from 'vitest';
import { BAR_BUTTON_WIDTH, barDensity, replyDensity } from '../../src/client/components/reader/barDensity';

// How the desktop reader toolbar fits its pane. The buttons have a fixed width (32 px with a mouse, 40 px on a touch screen wider than a phone), and the
// pane's width decides the side padding and whether the counter ("1 of 7") has room. The numbers are the arithmetic in reader/barDensity.ts.

const FINE = BAR_BUTTON_WIDTH.fine * 8;
const COARSE = BAR_BUTTON_WIDTH.coarse * 8;

describe('barDensity with a mouse', () => {
  it('is full when the pane is not measured yet, so the bar never shows a frame in the wrong density', () => {
    expect(barDensity(null, false)).toBe('full');
    expect(barDensity(null, true)).toBe('full');
  });

  it('is full from 401 px, snug from 345 px, and tight under that', () => {
    expect(barDensity(401, false)).toBe('full');
    expect(barDensity(400, false)).toBe('snug');
    expect(barDensity(345, false)).toBe('snug');
    expect(barDensity(344, false)).toBe('tight');
  });

  it('keeps the counter on the narrowest desktop window (901 px wide: a reader pane of about 359 px)', () => {
    expect(barDensity(359, false)).toBe('snug');
    expect(barDensity(340, false)).toBe('tight');
  });

  it('never needs more than the pane has: the buttons and the divider fit in every density', () => {
    for (let width = FINE + 9; width <= 1200; width += 1) {
      const density = barDensity(width, false);
      const needed = { full: 57 + FINE, snug: 17 + FINE, tight: 9 + FINE }[density];
      expect(needed, `${width} px`).toBeLessThanOrEqual(width);
    }
  });
});

describe('barDensity on a touch screen', () => {
  it('is full from 465 px, snug from 409 px, and tight under that (the buttons are 40 px wide)', () => {
    expect(barDensity(465, true)).toBe('full');
    expect(barDensity(464, true)).toBe('snug');
    expect(barDensity(409, true)).toBe('snug');
    expect(barDensity(408, true)).toBe('tight');
  });

  it('never needs more than the pane has', () => {
    for (let width = COARSE + 9; width <= 1200; width += 1) {
      const density = barDensity(width, true);
      const needed = { full: 57 + COARSE, snug: 17 + COARSE, tight: 9 + COARSE }[density];
      expect(needed, `${width} px`).toBeLessThanOrEqual(width);
    }
  });

  it('gives a landscape tablet (1024 px wide: a reader pane of about 428 px) the counter', () => {
    expect(barDensity(428, true)).toBe('snug');
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
