import React from 'react';
import { isSecretHeld } from './secretHold';

export interface BackLayer {
  open: boolean;
  close: () => void;
}

/** What a `popstate` to the entry at `depth` asks of the app, with `openCount` layers open. */
export type PopAction =
  /** Nothing to do: the entry matches the open layers. */
  | { kind: 'none'; depth: number }
  /** Close `count` layers; the history is already at `depth`. */
  | { kind: 'close'; count: number; depth: number }
  /** Move `go` entries (forward or back) to where the open layers are, and take `depth` as the depth. */
  | { kind: 'go'; go: number; depth: number };

/**
 * The decision of the `popstate` listener, apart from the browser: Forward onto an entry whose layer is gone steps back; Back closes the topmost
 * layers, except while `held` (a secret that cannot be shown again is on screen: the press is undone by going forward again, so the layer stays
 * and the history entry it owns is still there for when it closes).
 */
export function popAction(depth: number, openCount: number, held: boolean): PopAction {
  if (depth > openCount) {
    return { kind: 'go', go: openCount - depth, depth: openCount };
  }
  const extra = openCount - depth;
  if (extra === 0) {
    return { kind: 'none', depth };
  }
  return held ? { kind: 'go', go: extra, depth: openCount } : { kind: 'close', count: extra, depth };
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
      const action = popAction(depth, s.openCount, isSecretHeld());
      s.depth = action.depth;
      if (action.kind === 'go') {
        history.go(action.go);
        return;
      }
      let extra = action.kind === 'close' ? action.count : 0;
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
