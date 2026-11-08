/** A rectangle in viewport pixels (what `getBoundingClientRect` gives). */
export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Which edge of the anchor a popup lines up with, or its middle. */
export type Align = 'start' | 'center' | 'end';

export interface Placement {
  top: number;
  left: number;
  /** The height the popup may use: what is left of the viewport on its side. */
  maxHeight: number;
  side: 'below' | 'above';
}

/**
 * Where a popup of size `popup` goes next to `anchor` inside `viewport`. Below the anchor by default; above when it does not fit
 * below and there is more room above. Its left edge lines up with the anchor's (`align`: right edge or middle), and it is pushed
 * back inside the viewport, `margin` px from the edge. `maxHeight` is the room on the chosen side: a long list scrolls inside it.
 */
export function placePopup(
  anchor: Box,
  popup: { width: number; height: number },
  viewport: { width: number; height: number },
  align: Align = 'start',
  gap = 4,
  margin = 8
): Placement {
  const roomBelow = viewport.height - (anchor.top + anchor.height) - gap - margin;
  const roomAbove = anchor.top - gap - margin;
  const side = popup.height <= roomBelow || roomBelow >= roomAbove ? 'below' : 'above';
  const maxHeight = Math.max(0, side === 'below' ? roomBelow : roomAbove);
  const height = Math.min(popup.height, maxHeight);
  const top = side === 'below' ? anchor.top + anchor.height + gap : anchor.top - gap - height;
  const wanted = {
    start: anchor.left,
    center: anchor.left + (anchor.width - popup.width) / 2,
    end: anchor.left + anchor.width - popup.width
  }[align];
  const left = Math.max(margin, Math.min(wanted, viewport.width - popup.width - margin));
  return { top, left, maxHeight, side };
}

/** The tallest a popup gets, in px, before its content scrolls. */
const POPUP_MAX_HEIGHT = 320;

/**
 * Measures `panel` (a `position: fixed` element) and puts it next to `anchor`: sets `top`, `left` and `max-height`, and `data-side`
 * ("below" or "above", for the CSS). `matchWidth` makes it at least as wide as the anchor. Call it again after a resize or a scroll.
 */
export function positionNextTo(panel: HTMLElement, anchor: HTMLElement, align: Align, matchWidth: boolean): void {
  const { style, dataset } = panel;
  const anchorBox = anchor.getBoundingClientRect();
  style.maxHeight = `${POPUP_MAX_HEIGHT}px`;
  style.minWidth = matchWidth ? `${anchorBox.width}px` : '';
  const placement = placePopup(
    anchorBox,
    { width: panel.offsetWidth, height: panel.offsetHeight },
    { width: window.innerWidth, height: window.innerHeight },
    align
  );
  style.top = `${placement.top}px`;
  style.left = `${placement.left}px`;
  style.maxHeight = `${Math.min(placement.maxHeight, POPUP_MAX_HEIGHT)}px`;
  dataset.side = placement.side;
}
