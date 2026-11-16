import React from 'react';

// Media queries as React state, for the few layouts whose behaviour (not only their look) changes with the width: the keys and the
// orientation of a tab list that is a row on a phone. False on the server.

function subscribe(query: string) {
  return (onChange: () => void): (() => void) => {
    const list = window.matchMedia(query);
    list.addEventListener('change', onChange);
    return () => list.removeEventListener('change', onChange);
  };
}

/** True while `query` matches (`(max-width: 640px)`); the component renders again when that changes. False on the server. */
export function useMediaMatch(query: string): boolean {
  const subscribeTo = React.useMemo(() => subscribe(query), [query]);
  return React.useSyncExternalStore(
    subscribeTo,
    () => window.matchMedia(query).matches,
    () => false
  );
}

/**
 * Whether the element in `ref` scrolls (its content is wider or taller than its box), kept up to date as it, its children or the set of its
 * children change. True until it is measured (and on the server), so a scroll area stays a Tab stop until the browser shows it does not
 * scroll: then it is no empty stop for the keyboard (J1-18, the axe scrollable-region rule's intent). `assume` is the answer until then
 * (false for an area that is rarely long, so the server's markup stays plain: a dialog's body).
 */
export function useOverflows(ref: React.RefObject<HTMLElement | null>, assume = true): boolean {
  const [overflows, setOverflows] = React.useState(assume);
  React.useEffect(() => {
    const element = ref.current;
    if (element === null) {
      return;
    }
    const update = () => {
      setOverflows(element.scrollWidth > element.clientWidth + 1 || element.scrollHeight > element.clientHeight + 1);
    };
    const sizes = new ResizeObserver(update);
    const watch = () => {
      sizes.disconnect();
      sizes.observe(element);
      for (const child of element.children) {
        sizes.observe(child);
      }
      update();
    };
    const children = new MutationObserver(watch);
    children.observe(element, { childList: true });
    watch();
    // A part that arrives with a move (a section that slides in) overflows while it moves, and its end changes no size: measure again
    // when a motion inside ends, or the area stays a Tab stop that scrolls nothing (seen on the phone's Settings).
    element.addEventListener('animationend', update);
    element.addEventListener('transitionend', update);
    return () => {
      sizes.disconnect();
      children.disconnect();
      element.removeEventListener('animationend', update);
      element.removeEventListener('transitionend', update);
    };
  }, [ref]);
  return overflows;
}

/**
 * Marks the side of a sideways scroller that hides more of its content (`data-more` = start, end or both on `ref`, nothing when all of it
 * shows), for a fade on that edge (ui.css). Kept up to date while it scrolls and when it or its content changes size. Off when `enabled`
 * is false.
 */
export function useScrollEdges(ref: React.RefObject<HTMLElement | null>, enabled: boolean): void {
  React.useEffect(() => {
    const element = ref.current;
    if (element === null || !enabled) {
      return;
    }
    const update = () => {
      const start = element.scrollLeft > 1;
      const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      if (start && end) {
        element.dataset.more = 'both';
      } else if (start || end) {
        element.dataset.more = start ? 'start' : 'end';
      } else {
        delete element.dataset.more;
      }
    };
    update();
    element.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(element);
    for (const child of element.children) {
      observer.observe(child);
    }
    return () => {
      element.removeEventListener('scroll', update);
      observer.disconnect();
      delete element.dataset.more;
    };
  }, [ref, enabled]);
}
