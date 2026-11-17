import React from 'react';
import { cx } from './cx';
import { useMediaMatch } from './media';
import { assignRef } from './refs';

/** Where the bars are phone chrome (DESIGN-v4m R3): a narrow window or a touch screen. */
export const PHONE_QUERY = '(max-width: 640px), (pointer: coarse)';

let insetUsers = 0;
let stopInset: (() => void) | null = null;

/**
 * Keeps `--ui-vv-bottom` on <html> up to date while at least one docked bar is on screen: the height the on-screen keyboard covers at the
 * bottom of the layout viewport (visualViewport), 0 when there is none or while the page is pinch-zoomed. A bar that sticks to the bottom
 * of a page uses it as its `bottom`, so it rides above the keyboard on iOS (whose layout viewport never shrinks) and on Android Chrome
 * (`resizes-visual`, the default). A ui Dialog writes its own value on its root for its sheet; a bar inside a dialog does not add it.
 */
function useKeyboardInset(active: boolean): void {
  React.useEffect(() => {
    const viewport = window.visualViewport;
    if (!active || viewport === null) {
      return;
    }
    insetUsers += 1;
    if (insetUsers === 1) {
      const root = document.documentElement;
      const fit = () => {
        const zoomed = Math.abs(viewport.scale - 1) > 0.01;
        const covered = zoomed ? 0 : window.innerHeight - viewport.offsetTop - viewport.height;
        root.style.setProperty('--ui-vv-bottom', `${Math.max(0, Math.round(covered))}px`);
      };
      fit();
      viewport.addEventListener('resize', fit);
      viewport.addEventListener('scroll', fit);
      stopInset = () => {
        viewport.removeEventListener('resize', fit);
        viewport.removeEventListener('scroll', fit);
        root.style.removeProperty('--ui-vv-bottom');
      };
    }
    return () => {
      insetUsers -= 1;
      if (insetUsers === 0) {
        stopInset?.();
        stopInset = null;
      }
    };
  }, [active]);
}

/** The nearest ancestor that scrolls up and down (a dialog body, a pane), or null when the page itself scrolls. */
function scrollerOf(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node !== null && node !== document.body; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') {
      return node;
    }
  }
  return null;
}

const AUTO = ['--ui-actionbar-auto-bleed', '--ui-actionbar-auto-bleed-end', '--ui-actionbar-auto-bottom', '--ui-actionbar-auto-end'];

/** True when something a person sees comes after `node` among its siblings (live regions, portals and empty boxes do not count). */
function followed(node: Element): boolean {
  for (let next = node.nextElementSibling; next !== null; next = next.nextElementSibling) {
    const style = getComputedStyle(next);
    const inFlow = style.display !== 'none' && style.position !== 'absolute' && style.position !== 'fixed';
    if (inFlow && next.getBoundingClientRect().height > 0) {
      return true;
    }
  }
  return false;
}

/**
 * The room between the end of the bar's parent and the end of what scrolls (the paddings of the boxes it is the last part of), or 0 when
 * any content follows the bar on the way there: the bar's bottom margin takes it back, so at the end of the scroll it meets the bottom edge.
 */
function trailingRoom(bar: HTMLElement, parent: HTMLElement, scroller: HTMLElement | null): number {
  for (let node: Element | null = bar; node !== null && node !== scroller && node !== document.body; node = node.parentElement) {
    if (followed(node)) {
      return 0;
    }
  }
  const box = getComputedStyle(parent);
  if (parent === scroller) {
    return Number.parseFloat(box.paddingBottom) || 0;
  }
  const contentEnd =
    parent.getBoundingClientRect().bottom - Number.parseFloat(box.paddingBottom) - Number.parseFloat(box.borderBottomWidth);
  const scrollEnd =
    scroller === null
      ? document.documentElement.scrollHeight - window.scrollY
      : scroller.getBoundingClientRect().top + scroller.clientTop + scroller.scrollHeight - scroller.scrollTop;
  return Math.max(0, Math.round(scrollEnd - contentEnd));
}

/**
 * Measures where a docked bar stands and writes its defaults (ui.css reads them after the area's own knobs): it covers its parent's side
 * padding (so it reaches the edges of the box it is in, never past them); in a scroller with bottom padding P it sticks at -P (Blink
 * measures a sticky `bottom` from the padding edge); and when it is the last thing of the page or of the scroller, its bottom margin takes
 * back the paddings under it, so it also meets the bottom edge at the end of the scroll. Outside a dialog the keyboard inset is added;
 * inside one the sheet already stands on the keyboard.
 */
function useDockedPlace(ref: React.RefObject<HTMLDivElement | null>, docked: boolean): void {
  React.useLayoutEffect(() => {
    const bar = ref.current;
    const parent = bar?.parentElement ?? null;
    if (!docked || bar === null || parent === null) {
      return;
    }
    const scroller = scrollerOf(bar);
    const inDialog = bar.closest('.ui-dialog') !== null;
    const measure = () => {
      const box = getComputedStyle(parent);
      bar.style.setProperty(AUTO[0], box.paddingLeft);
      bar.style.setProperty(AUTO[1], box.paddingRight);
      bar.style.setProperty(AUTO[3], `${trailingRoom(bar, parent, scroller)}px`);
      if (scroller !== null) {
        const pad = Number.parseFloat(getComputedStyle(scroller).paddingBottom) || 0;
        bar.style.setProperty(AUTO[2], inDialog ? `${-pad}px` : `calc(var(--ui-vv-bottom, 0px) - ${pad}px)`);
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(parent);
    return () => {
      observer.disconnect();
      for (const name of AUTO) {
        bar.style.removeProperty(name);
      }
    };
  }, [ref, docked]);
}

export interface ActionBarProps extends React.ComponentProps<'div'> {
  /** `phone` (default): docked at the bottom on a phone or a touch screen, a plain row of buttons elsewhere; `always`: docked everywhere. */
  dock?: 'phone' | 'always';
}

/**
 * The bottom action bar of a view (DESIGN-v4m R3): the primary action full width, or one secondary and the primary side by side (put
 * them in that order). Docked, it sticks to the bottom of what scrolls (`position: sticky`: the window for a page, the body of a ui
 * Dialog), on the surface (a dialog's fill in a dialog) with a hairline and a 16 px fade above it, 16 px of room plus the bottom safe
 * area, and above the on-screen keyboard (`--ui-vv-bottom`). It measures its place (useDockedPlace): it covers its parent's side
 * padding, so make it the last child of the box whose padding is the page's or the sheet's side room (a dialog body, a page column), and
 * as the last thing of the page or the scroller it takes back the paddings under it, so it meets the bottom edge at the end of the
 * scroll too. `--ui-actionbar-bleed`, `-bleed-end`, `-bottom` and `-bg` on a wrapper override what it measures. Undocked it is a row of
 * buttons at the end. Nothing differs on the server.
 */
export function ActionBar({ dock = 'phone', className, children, ref, ...div }: ActionBarProps): React.ReactElement {
  const phone = useMediaMatch(PHONE_QUERY);
  const docked = dock === 'always' || phone;
  const barRef = React.useRef<HTMLDivElement | null>(null);
  const setRefs = React.useCallback(
    (node: HTMLDivElement | null) => {
      barRef.current = node;
      assignRef(ref, node);
    },
    [ref]
  );
  useKeyboardInset(docked);
  useDockedPlace(barRef, docked);
  return (
    <div ref={setRefs} className={cx('ui-actionbar', className)} data-docked={docked ? 'true' : undefined} {...div}>
      {children}
    </div>
  );
}
