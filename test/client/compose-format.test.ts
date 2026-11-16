import { describe, expect, it } from 'vitest';
import { fittingTools } from '../../src/client/components/compose/FormatToolbar';

// The formatting row of compose never scrolls sideways (J1-12, J5-06): FormatToolbar measures it and keeps as many tools as fit after the
// text style, the rest go into a More formatting menu at its end. The tools: Bold, Italic, Underline | Bulleted list, Numbered list, Quote |
// Insert link, Insert image (a hairline before each group), with 2 px gaps.

/** What `shown` tools take, and the More button when some are left out. */
function needed(shown: number, style: number, button: number, divider: number): number {
  const groups = [0, 3, 6].filter((start) => start < shown).length;
  const more = shown < 8 ? 2 + button : 0;
  return style + shown * (2 + button) + groups * (divider + 2) + more;
}

describe('fittingTools', () => {
  it('keeps every tool in a desktop window, and no More button', () => {
    // 760 px window, 24 px paddings: about 729 px for the row.
    expect(fittingTools(729, 104, 32, 9)).toBe(8);
  });

  it('keeps the first tools and leaves room for More on a phone (44 px buttons)', () => {
    const shown = fittingTools(305, 100, 44, 9);
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(8);
    expect(needed(shown, 100, 44, 9)).toBeLessThanOrEqual(305);
    // One more tool would not fit beside the More button.
    expect(needed(shown + 1, 100, 44, 9)).toBeGreaterThan(305);
  });

  it('never needs more than the row has, at any width', () => {
    for (let width = 150; width <= 900; width += 1) {
      for (const button of [32, 44]) {
        const shown = fittingTools(width, 100, button, 9);
        if (shown > 0) {
          expect(needed(shown, 100, button, 9), `${width} px`).toBeLessThanOrEqual(width);
        }
      }
    }
  });
});
