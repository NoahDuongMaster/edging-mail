import React from 'react';
import { cx } from './cx';
import { useInBrowser, useSlidingIndicator, type IndicatorBox } from './indicator';
import { useMediaMatch, useOverflows, useScrollEdges } from './media';

export interface Tab {
  /** Identifies the tab; the panel that belongs to it is `<TabPanel tabsId=... value=...>`. */
  value: string;
  label: string;
  disabled?: boolean;
  /** A count or a small badge after the label. */
  trailing?: React.ReactNode;
  /** A small icon before the label (a vertical nav of sections); decorative, so mark it aria-hidden. */
  leading?: React.ReactNode;
  /**
   * In a `vertical` list: the label of a group that starts at this tab ('Technical'), drawn above it. It is a visual heading only
   * (aria-hidden, a tab list holds nothing but tabs), so every tab's own name must make sense without it.
   */
  group?: string;
}

export interface TabsProps {
  /** A stable id shared with the panels (`TabPanel`), which link to the tabs through it. */
  id: string;
  /** The accessible name of the tab list ("Settings sections"). */
  label: string;
  tabs: readonly Tab[];
  value: string;
  onChange: (value: string) => void;
  className?: string;
  /**
   * On a phone (640px and less), a grid of two columns of 44px segments instead of a row that scrolls sideways, so no tab is ever out of
   * sight and a long label wraps (four tabs: 2x2). For a row of up to four tabs whose labels do not fit a phone in every language.
   */
  grid?: boolean;
  /**
   * With `vertical`: on a phone (640px and less) the list is one row of tabs that scrolls sideways instead (Left and Right move there), the
   * side that hides more tabs fading out as the list's filter chips do, and the selected tab is kept in view (the admin console's sections:
   * a 2x2 grid took a quarter of the screen).
   */
  phoneRow?: boolean;
  /**
   * `vertical`: a list of sections down the left side of a panel (the nav of Settings): Up and Down move, the selected row is tinted and
   * has a 3px indicator bar. Default `horizontal`: underlined tabs in a row, Left and Right move.
   */
  orientation?: 'horizontal' | 'vertical';
  /**
   * Called after `onChange` when a tab is clicked, or pressed with Enter or Space, never when the arrows move the selection: a list that
   * opens its section on a phone (list then detail) opens it here, so moving through the list with the arrows does not.
   */
  onActivate?: (value: string) => void;
}

const tabId = (tabsId: string, value: string): string => `${tabsId}-tab-${value}`;
const panelId = (tabsId: string, value: string): string => `${tabsId}-panel-${value}`;

/** The tab a key moves to among the enabled ones (they wrap), or undefined when the key is not one of the tab list's keys. */
export function tabTarget<T>(enabled: readonly T[], index: number, key: string, orientation: 'horizontal' | 'vertical'): T | undefined {
  const next = orientation === 'vertical' ? 'ArrowDown' : 'ArrowRight';
  const previous = orientation === 'vertical' ? 'ArrowUp' : 'ArrowLeft';
  switch (key) {
    case next: {
      return enabled[(index + 1) % enabled.length];
    }
    case previous: {
      return enabled[(index - 1 + enabled.length) % enabled.length];
    }
    case 'Home': {
      return enabled.at(0);
    }
    case 'End': {
      return enabled.at(-1);
    }
    default: {
      return undefined;
    }
  }
}

/** The ink of a row sits under the tab's words (12 px in from each side); the ink of a vertical list covers the whole row. */
function measureTab(tab: HTMLElement, list: HTMLElement): IndicatorBox {
  if (list.getAttribute('aria-orientation') === 'vertical') {
    return { x: 0, y: tab.offsetTop, height: tab.offsetHeight };
  }
  const inset = 12;
  return { x: tab.offsetLeft + inset, y: 0, width: Math.max(0, tab.offsetWidth - inset * 2) };
}

const SELECTED_TAB = '[role="tab"][aria-selected="true"]';

/** The width under which a `phoneRow` list is a row (the phone layouts of ui.css). */
const PHONE = '(max-width: 640px)';

/**
 * Tabs that switch the content under them (the sections of Settings). It follows the ARIA tabs pattern: one tab is in the Tab order, the
 * arrows move between tabs (and wrap): Left and Right in a row, Up and Down in a `vertical` list; Home and End jump to the first and last,
 * and the tab that has focus is shown at once. In a row the selected tab is underlined by an indicator that slides to the next one; on a
 * narrow screen the row scrolls sideways instead of wrapping (or, with `grid`, becomes a 2-column grid on a phone). Vertical, it is a nav
 * list down the left side with the selected row tinted and barred. Use it only when the panels are siblings of one thing; use links for
 * navigation between pages.
 */
export function Tabs({
  id,
  label,
  tabs,
  value,
  onChange,
  className,
  grid = false,
  phoneRow = false,
  orientation = 'horizontal',
  onActivate
}: TabsProps): React.ReactElement {
  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const listRef = React.useRef<HTMLDivElement | null>(null);
  const inkRef = React.useRef<HTMLSpanElement | null>(null);
  // A vertical list with `phoneRow` is a row on a phone: its keys, its aria-orientation and its ink are a row's there.
  const row = useMediaMatch(PHONE) && phoneRow;
  const shape = row ? 'horizontal' : orientation;
  // The sliding indicator is drawn in the browser only (the server renders each tab's own underline).
  const ink = useInBrowser();
  useSlidingIndicator(listRef, inkRef, SELECTED_TAB, measureTab, `${value} ${shape}`);
  useScrollEdges(listRef, row);
  React.useEffect(() => {
    if (row) {
      refs.current[value]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [row, value]);
  const enabled = tabs.filter((tab) => tab.disabled !== true);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = enabled.findIndex((tab) => tab.value === value);
    const tab = tabTarget(enabled, index, event.key, shape);
    if (tab !== undefined) {
      event.preventDefault();
      onChange(tab.value);
      refs.current[tab.value]?.focus();
    }
  };

  return (
    // The arrow keys are handled here, on the list, for the tab that has focus: the tabs themselves are the controls.
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- the tabs inside are the focusable parts (roving tabindex)
    <div
      ref={listRef}
      role="tablist"
      aria-label={label}
      aria-orientation={shape === 'vertical' ? 'vertical' : undefined}
      className={cx('ui-tabs', className)}
      data-grid={grid ? 'true' : undefined}
      data-row={row ? 'true' : undefined}
      data-ink={ink ? 'true' : undefined}
      onKeyDown={onKeyDown}
    >
      {ink ? <span ref={inkRef} className="ui-ink" aria-hidden="true" /> : null}
      {tabs.map((tab) => (
        <React.Fragment key={tab.value}>
          {tab.group === undefined ? null : (
            <span className="ui-tab-group" aria-hidden="true">
              {tab.group}
            </span>
          )}
          <button
            ref={(element) => {
              refs.current[tab.value] = element;
            }}
            type="button"
            role="tab"
            id={tabId(id, tab.value)}
            aria-selected={tab.value === value}
            aria-controls={panelId(id, tab.value)}
            tabIndex={tab.value === value ? 0 : -1}
            disabled={tab.disabled}
            className="ui-tab"
            onClick={() => {
              onChange(tab.value);
              onActivate?.(tab.value);
            }}
          >
            {tab.leading}
            {tab.label}
            {tab.trailing}
          </button>
        </React.Fragment>
      ))}
    </div>
  );
}

interface TabPanelProps {
  /** The `id` of the Tabs this panel belongs to. */
  tabsId: string;
  /** The `value` of its tab. */
  value: string;
  /** The `value` of the tab that is selected: the panel renders only when it is its own. */
  selected: string;
  children: React.ReactNode;
}

/** The content of one tab. Only the selected one is rendered; it can be reached with Tab from the tab list. */
export function TabPanel({ tabsId, value, selected, children }: TabPanelProps): React.ReactElement | null {
  return value === selected ? (
    <ShownPanel tabsId={tabsId} value={value}>
      {children}
    </ShownPanel>
  ) : null;
}

function ShownPanel({ tabsId, value, children }: Omit<TabPanelProps, 'selected'>): React.ReactElement {
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const scrolls = useOverflows(panelRef);
  return (
    <div
      ref={panelRef}
      role="tabpanel"
      id={panelId(tabsId, value)}
      aria-labelledby={tabId(tabsId, value)}
      // The panel is the next Tab stop after the tabs while it scrolls, so a panel with little focusable in it can still be scrolled by
      // keyboard; a panel that fits is no empty stop (J1-18).
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- ARIA tabs pattern
      tabIndex={scrolls ? 0 : undefined}
      className="ui-tabpanel"
    >
      {children}
    </div>
  );
}
