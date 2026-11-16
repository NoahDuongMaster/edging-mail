import React from 'react';

// The sliding indicator of Tabs and SegmentedControl (M16): an element inside the list that is placed on the chosen item after the first
// paint and then slides to the next chosen one. The server renders without it (the chosen item draws its own look), so markup rendered on
// the server does not change; the browser adds it on its first render.

/** Nothing to clean up: the answer of useInBrowser never changes. */
function unsubscribe(): void {
  // nothing was subscribed
}
const noSubscription = (): (() => void) => unsubscribe;

/** False on the server, true in the browser from the first render (no effect, no second render). */
export function useInBrowser(): boolean {
  return React.useSyncExternalStore(
    noSubscription,
    () => true,
    () => false
  );
}

/** Where the indicator goes for `target`, in px from the container's padding box. Missing sizes are left to the stylesheet. */
export interface IndicatorBox {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

const boxKey = (box: IndicatorBox): string => `${box.x} ${box.y} ${box.width ?? ''} ${box.height ?? ''}`;

/**
 * Keeps `indicatorRef` on the element of `containerRef` that matches `selector`, every time `key` changes (the chosen value) and when the
 * container changes size. The first placement does not slide; later ones do (`data-moving`, ui.css), and only while motion is allowed.
 */
export function useSlidingIndicator(
  containerRef: React.RefObject<HTMLElement | null>,
  indicatorRef: React.RefObject<HTMLElement | null>,
  selector: string,
  measure: (target: HTMLElement, container: HTMLElement) => IndicatorBox,
  key: string
): void {
  const placed = React.useRef(false);
  const measureRef = React.useRef(measure);
  React.useLayoutEffect(() => {
    measureRef.current = measure;
  }, [measure]);
  React.useLayoutEffect(() => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    if (container === null || indicator === null) {
      return;
    }
    // Where the indicator was put last (boxKey), to tell a report that moves the chosen item from one that does not.
    let placedAt = '';
    const place = () => {
      const target = container.querySelector<HTMLElement>(selector);
      if (target === null) {
        indicator.style.opacity = '0';
        return;
      }
      const box = measureRef.current(target, container);
      placedAt = boxKey(box);
      indicator.style.opacity = '';
      indicator.style.scale = '';
      indicator.style.translate = `${box.x}px ${box.y}px`;
      indicator.style.width = box.width === undefined ? '' : `${box.width}px`;
      indicator.style.height = box.height === undefined ? '' : `${box.height}px`;
    };
    const slideLater = () => {
      requestAnimationFrame(() => {
        indicator.dataset.moving = 'true';
      });
    };
    // A slide animates the transform only (J2-11): the new size is set at once, and the indicator starts where it stood, scaled back to
    // its old size (FLIP), then glides to its place at scale 1. ui.css sets transform-origin 0 0 and transitions translate and scale.
    const slide = () => {
      const before = indicator.getBoundingClientRect();
      const from = getComputedStyle(indicator).translate;
      delete indicator.dataset.moving;
      place();
      const after = indicator.getBoundingClientRect();
      const to = indicator.style.translate;
      const scaleX = after.width > 0 ? before.width / after.width : 1;
      const scaleY = after.height > 0 ? before.height / after.height : 1;
      indicator.style.translate = from === 'none' || from === '' ? '0px 0px' : from;
      indicator.style.scale = `${scaleX} ${scaleY}`;
      // The start is committed before the transition is turned on (reading a box forces the layout).
      indicator.getBoundingClientRect();
      indicator.dataset.moving = 'true';
      indicator.style.translate = to;
      indicator.style.scale = '';
    };
    if (placed.current) {
      if (indicator.dataset.moving === 'true') {
        slide();
      } else {
        place();
      }
    } else {
      placed.current = true;
      delete indicator.dataset.moving;
      place();
      slideLater();
    }
    // A new size or place of the chosen item moves the indicator without a slide: the list resized (a window resize, a language with longer
    // labels), an item resized without the list (the web font arrived after the first placement, a count in a label changed), or the layout
    // changed right after mount (a parent that measures and switches columns in the same commit). Each report is compared with where the
    // indicator stands, so the observer's first report, and any report that changes nothing, does nothing.
    const replace = () => {
      const target = container.querySelector<HTMLElement>(selector);
      if (target === null || boxKey(measureRef.current(target, container)) === placedAt) {
        return;
      }
      delete indicator.dataset.moving;
      place();
      slideLater();
    };
    const observer = new ResizeObserver(replace);
    observer.observe(container);
    for (const item of container.querySelectorAll<HTMLElement>(':scope > *, :scope > * > *')) {
      if (item !== indicator) {
        observer.observe(item);
      }
    }
    const fonts = 'fonts' in document ? document.fonts : null;
    let alive = true;
    void fonts?.ready.then(() => {
      if (alive) {
        replace();
      }
    });
    fonts?.addEventListener('loadingdone', replace);
    return () => {
      alive = false;
      observer.disconnect();
      fonts?.removeEventListener('loadingdone', replace);
    };
  }, [containerRef, indicatorRef, selector, key]);
}
