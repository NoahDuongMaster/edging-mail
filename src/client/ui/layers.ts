import React from 'react';

// Dialogs, menus and lists that float over the page are "layers". Escape belongs to the one on top (a menu inside a dialog closes first,
// the dialog on the next Escape), and Tab is trapped by the top dialog only. One listener on the document serves them all; it runs in the
// capture phase, so it also works when focus sits on the page behind or in a popup that is not inside the dialog.
// A layer registered with its element (a dialog) lets the controls inside it answer an Escape pressed among them first: the listener leaves
// that Escape alone, and the dialog's own keydown, which React runs after the controls', closes it unless one of them used the key (a
// confirmation inside the dialog takes itself back). Either way nothing behind the top layer gets the key.

interface Layer {
  escape: () => void;
  /** The element of a dialog: an Escape pressed inside it goes to its content first. Unset for a popup, which takes Escape at once. */
  element: React.RefObject<HTMLElement | null> | undefined;
}

const stack: Layer[] = [];

/**
 * What the document listener does with an Escape: `none` (no layer is open, or the key ends an IME composition), `content` (it was pressed
 * inside the top layer's element: the layer's own keydown decides after the controls inside), or `close` (it closes the top layer now).
 */
export function escapeRoute(
  top: Pick<Layer, 'element'> | undefined,
  target: Node | null,
  composing: boolean
): 'none' | 'content' | 'close' {
  if (top === undefined || composing) {
    return 'none';
  }
  return target !== null && top.element?.current?.contains(target) === true ? 'content' : 'close';
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') {
    return;
  }
  const top = stack.at(-1);
  if (escapeRoute(top, event.target instanceof Node ? event.target : null, event.isComposing) === 'close') {
    event.preventDefault();
    event.stopPropagation();
    top?.escape();
  }
}

/**
 * Registers a layer for as long as `active` is true. `onEscape` is called when Escape is pressed and this layer is on top. With `element`
 * (a dialog), an Escape pressed inside that element is left to the element's own keydown handler, which calls `onEscape` itself.
 * Returns `isTop()`: true while no later layer is open above this one.
 */
export function useLayer(active: boolean, onEscape: () => void, element?: React.RefObject<HTMLElement | null>): () => boolean {
  const escapeRef = React.useRef(onEscape);
  const layerRef = React.useRef<Layer | null>(null);

  React.useLayoutEffect(() => {
    escapeRef.current = onEscape;
  }, [onEscape]);

  React.useEffect(() => {
    if (!active) {
      return;
    }
    const layer: Layer = {
      escape: () => {
        escapeRef.current();
      },
      element
    };
    layerRef.current = layer;
    stack.push(layer);
    if (stack.length === 1) {
      document.addEventListener('keydown', onKeyDown, true);
    }
    return () => {
      stack.splice(stack.indexOf(layer), 1);
      layerRef.current = null;
      if (stack.length === 0) {
        document.removeEventListener('keydown', onKeyDown, true);
      }
    };
  }, [active, element]);

  return React.useCallback(() => layerRef.current !== null && stack.at(-1) === layerRef.current, []);
}

let scrollLocks = 0;

/** Stops the page behind a modal from scrolling while `active`. Counted, so two dialogs open together unlock only when both are closed. */
export function useScrollLock(active: boolean): void {
  React.useEffect(() => {
    if (!active) {
      return;
    }
    const root = document.documentElement;
    scrollLocks += 1;
    if (scrollLocks === 1) {
      // The scrollbar goes away with the scroll: its width is added as padding, so the page does not jump sideways.
      const scrollbar = window.innerWidth - root.clientWidth;
      root.style.paddingRight = scrollbar > 0 ? `${scrollbar}px` : '';
      root.style.overflow = 'hidden';
    }
    return () => {
      scrollLocks -= 1;
      if (scrollLocks === 0) {
        root.style.overflow = '';
        root.style.paddingRight = '';
      }
    };
  }, [active]);
}
