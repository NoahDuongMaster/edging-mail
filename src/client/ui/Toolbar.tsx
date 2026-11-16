import React from 'react';
import { cx } from './cx';

export interface ToolbarProps extends Omit<React.ComponentProps<'div'>, 'role' | 'aria-label' | 'aria-orientation' | 'ref'> {
  /** What the toolbar is for ("Message actions", "Formatting"): its accessible name. Required. */
  'aria-label': string;
  /** `vertical` for a column of tools (Up and Down move); default `horizontal` (Left and Right move). */
  orientation?: 'horizontal' | 'vertical';
}

/** The focusable controls of a toolbar, in order: enabled buttons and the other controls that take focus (a disabled one is skipped). */
const TOOL =
  'button:not(:disabled), [role="button"]:not([aria-disabled="true"]), a[href], input:not(:disabled), [role="checkbox"], [role="radio"], [role="switch"]';

/** The controls of `toolbar` that can take focus and are shown (a hidden one is not a stop; a nested toolbar keeps its own). */
export function toolbarItems(toolbar: HTMLElement): HTMLElement[] {
  return [...toolbar.querySelectorAll<HTMLElement>(TOOL)].filter(
    (element) => element.closest('[role="toolbar"]') === toolbar && element.getClientRects().length > 0
  );
}

/** The input types whose Left and Right do nothing of their own: inside a toolbar the arrows move off them. */
const ARROWLESS_INPUTS = new Set(['checkbox', 'button', 'submit', 'reset', 'image']);

/** A control inside a toolbar that keeps its own Left and Right: a text field (its caret) or a radio (its choice). */
export function keepsArrows(target: EventTarget): boolean {
  return target instanceof HTMLInputElement && !ARROWLESS_INPUTS.has(target.type);
}

/** The index a key moves to among `count` tools from `current` (-1 when the key is not one of the toolbar's keys). Left/Right or Up/Down wrap. */
export function toolbarTarget(count: number, current: number, key: string, orientation: 'horizontal' | 'vertical'): number {
  if (count === 0) {
    return -1;
  }
  const next = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
  const previous = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
  switch (key) {
    case next: {
      return current < 0 ? 0 : (current + 1) % count;
    }
    case previous: {
      return current < 0 ? count - 1 : (current - 1 + count) % count;
    }
    case 'Home': {
      return 0;
    }
    case 'End': {
      return count - 1;
    }
    default: {
      return -1;
    }
  }
}

/**
 * A row of controls that is ONE stop in the Tab order (the ARIA toolbar pattern): Tab enters on the last control used (the first at the
 * start), Left and Right move between the controls (Up and Down for a vertical one) and wrap, Home and End jump to the ends, and Tab leaves.
 * Works with IconButton and Button children (and any other button inside it); disabled and hidden ones are skipped, also when they change
 * later. Use it for the actions of the reader and the formatting tools of compose; not for a single button, and not for a menu (Menu).
 */
export function Toolbar({
  orientation = 'horizontal',
  className,
  onKeyDown,
  onFocus,
  children,
  ...rest
}: ToolbarProps): React.ReactElement {
  const ref = React.useRef<HTMLDivElement | null>(null);
  /** The control that is the Tab stop: the last one used. */
  const stop = React.useRef<HTMLElement | null>(null);

  /** tabindex 0 on the stop (the last one used, or the first control), -1 on every other control. */
  const rove = React.useCallback((to?: HTMLElement) => {
    const toolbar = ref.current;
    if (toolbar === null) {
      return;
    }
    const items = toolbarItems(toolbar);
    const wanted = to ?? stop.current;
    const active = wanted !== null && items.includes(wanted) ? wanted : items.at(0);
    stop.current = active ?? null;
    for (const item of items) {
      item.tabIndex = item === active ? 0 : -1;
    }
  }, []);

  // After every render, and whenever a control inside appears, goes, or is enabled or disabled by its own state.
  React.useLayoutEffect(() => {
    rove();
  });
  React.useEffect(() => {
    const toolbar = ref.current;
    if (toolbar === null) {
      return;
    }
    const observer = new MutationObserver(() => rove());
    observer.observe(toolbar, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['disabled', 'aria-disabled', 'hidden']
    });
    return () => observer.disconnect();
  }, [rove]);

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-orientation={orientation === 'vertical' ? 'vertical' : undefined}
      className={cx('ui-toolbar', className)}
      onFocus={(event) => {
        // A control that gets focus (by a click too) becomes the Tab stop. A popup that a tool opens (a Popover, drawn in the body) is
        // still a React child: its events bubble here too, but its controls are not tools of the row.
        if (event.target instanceof HTMLElement && event.target !== ref.current && ref.current?.contains(event.target) === true) {
          rove(event.target);
        }
        onFocus?.(event);
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        const toolbar = ref.current;
        if (event.defaultPrevented || toolbar === null || event.altKey || event.ctrlKey || event.metaKey) {
          return;
        }
        // The keys of a popup that a tool opened (drawn in the body) belong to that popup.
        if (!(event.target instanceof Node) || !toolbar.contains(event.target)) {
          return;
        }
        // A field inside the toolbar keeps its own Left and Right (a text field moves its caret, a radio its choice); a checkbox has no use
        // for them, so it is a tool like the others (the selection bar's Select all).
        if (keepsArrows(event.target) && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
          return;
        }
        const items = toolbarItems(toolbar);
        const current = event.target instanceof HTMLElement ? items.indexOf(event.target) : -1;
        const target = toolbarTarget(items.length, current, event.key, orientation);
        if (target >= 0) {
          event.preventDefault();
          rove(items[target]);
          items[target].focus();
        }
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
