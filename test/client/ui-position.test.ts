import { describe, expect, it } from 'vitest';
import { placePopup } from '../../src/client/ui/position';

// Where a popup (the list of a Select, a Menu, a tooltip) goes next to its button. The viewport here is 1000 x 600; the gap is 4 and the margin 8.

const viewport = { width: 1000, height: 600 };
const popup = { width: 200, height: 150 };

describe('placePopup', () => {
  it('goes below the anchor, with its left edge on the anchor', () => {
    const place = placePopup({ top: 100, left: 300, width: 120, height: 36 }, popup, viewport);
    expect(place).toMatchObject({ side: 'below', top: 140, left: 300 });
    expect(place.maxHeight).toBe(600 - 136 - 4 - 8);
  });

  it('flips above when it does not fit below and there is more room above', () => {
    const place = placePopup({ top: 500, left: 300, width: 120, height: 36 }, popup, viewport);
    expect(place.side).toBe('above');
    expect(place.top + popup.height).toBe(500 - 4);
  });

  it('stays below when it does not fit anywhere but below has more room', () => {
    const place = placePopup({ top: 100, left: 300, width: 120, height: 36 }, { width: 200, height: 900 }, viewport);
    expect(place.side).toBe('below');
    expect(place.maxHeight).toBeLessThan(900);
  });

  it('shrinks to the room above when it flips and is taller than that room', () => {
    const place = placePopup({ top: 300, left: 300, width: 120, height: 36 }, { width: 200, height: 500 }, { width: 1000, height: 400 });
    expect(place.side).toBe('above');
    expect(place.maxHeight).toBe(300 - 4 - 8);
    expect(place.top).toBe(300 - 4 - place.maxHeight);
  });

  it('lines up with the right edge of the anchor, or with its middle', () => {
    const anchor = { top: 100, left: 300, width: 120, height: 36 };
    expect(placePopup(anchor, popup, viewport, 'end').left).toBe(300 + 120 - 200);
    expect(placePopup(anchor, popup, viewport, 'center').left).toBe(300 + (120 - 200) / 2);
  });

  it('is pushed back inside the viewport on both sides', () => {
    expect(placePopup({ top: 100, left: 950, width: 40, height: 36 }, popup, viewport).left).toBe(1000 - 200 - 8);
    expect(placePopup({ top: 100, left: 0, width: 40, height: 36 }, popup, viewport, 'center').left).toBe(8);
  });
});
