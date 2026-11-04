import React from 'react';

export interface BackLayer {
  open: boolean;
  close: () => void;
}

/**
 * Makes the system Back button (Android back, iOS edge swipe, browser Back) close the topmost open
 * layer (reader, drawer, modal) instead of leaving the app.
 *
 * Every open layer owns one history entry (same URL, state `{ edgingDepth }`):
 * - opening a layer pushes an entry;
 * - closing a layer from the UI (X, Esc, scrim, in-app Back) pops its entry with `history.go`;
 * - a `popstate` closes the topmost open layers until their count matches the entry's depth.
 *
 * `layers` is ordered bottom to top; with `enabled` false no layer is tracked.
 */
export function useBackStack(layers: BackLayer[], enabled: boolean): void {
  const openCount = enabled ? layers.filter((l) => l.open).length : 0;
  // Latest render's values for the popstate listener, which is registered only once.
  const latest = React.useRef({ layers, openCount, depth: 0 });
  React.useLayoutEffect(() => {
    latest.current.layers = layers;
    latest.current.openCount = openCount;
  });

  React.useEffect(() => {
    // A reload keeps the old entries; start from a clean depth so they are inert.
    history.replaceState({ ...history.state, edgingDepth: 0 }, '');

    const onPopState = (event: PopStateEvent) => {
      const s = latest.current;
      const state = event.state as { edgingDepth?: unknown } | null;
      const depth = typeof state?.edgingDepth === 'number' ? state.edgingDepth : 0;
      if (depth > s.openCount) {
        // Browser Forward onto an entry whose layer is gone: step back to where the UI is.
        s.depth = s.openCount;
        history.go(s.openCount - depth);
        return;
      }
      s.depth = depth;
      let extra = s.openCount - depth;
      for (let i = s.layers.length - 1; i >= 0 && extra > 0; i--) {
        if (s.layers[i].open) {
          s.layers[i].close();
          extra--;
        }
      }
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  React.useEffect(() => {
    const s = latest.current;
    if (openCount > s.depth) {
      for (let depth = s.depth + 1; depth <= openCount; depth++) {
        history.pushState({ edgingDepth: depth }, '');
      }
      s.depth = openCount;
    } else if (openCount < s.depth) {
      const steps = s.depth - openCount;
      s.depth = openCount;
      history.go(-steps);
    }
  }, [openCount]);
}
