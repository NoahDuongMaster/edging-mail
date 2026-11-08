import React from 'react';
import { cx } from './cx';

export interface Tab {
  /** Identifies the tab; the panel that belongs to it is `<TabPanel tabsId=... value=...>`. */
  value: string;
  label: string;
  disabled?: boolean;
  /** A count or a small badge after the label. */
  trailing?: React.ReactNode;
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
}

const tabId = (tabsId: string, value: string): string => `${tabsId}-tab-${value}`;
const panelId = (tabsId: string, value: string): string => `${tabsId}-panel-${value}`;

/**
 * Underlined tabs that switch the content under them (the sections of Settings). It follows the ARIA tabs pattern: one tab is in the Tab
 * order, Left and Right move between tabs (and wrap), Home and End jump to the first and last, and the tab that has focus is shown
 * at once. On a narrow screen the row scrolls sideways instead of wrapping (or, with `grid`, becomes a 2-column grid on a phone). Use it
 * only when the panels are siblings of one thing; use links for navigation between pages.
 */
export function Tabs({ id, label, tabs, value, onChange, className, grid = false }: TabsProps): React.ReactElement {
  const refs = React.useRef<Record<string, HTMLButtonElement | null>>({});
  const enabled = tabs.filter((tab) => tab.disabled !== true);

  const go = (tab: Tab | undefined) => {
    if (tab !== undefined) {
      onChange(tab.value);
      refs.current[tab.value]?.focus();
    }
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const index = enabled.findIndex((tab) => tab.value === value);
    switch (event.key) {
      case 'ArrowRight': {
        event.preventDefault();
        go(enabled[(index + 1) % enabled.length]);
        break;
      }
      case 'ArrowLeft': {
        event.preventDefault();
        go(enabled[(index - 1 + enabled.length) % enabled.length]);
        break;
      }
      case 'Home': {
        event.preventDefault();
        go(enabled.at(0));
        break;
      }
      case 'End': {
        event.preventDefault();
        go(enabled.at(-1));
        break;
      }
      default: {
        break;
      }
    }
  };

  return (
    // The arrow keys are handled here, on the list, for the tab that has focus: the tabs themselves are the controls.
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- the tabs inside are the focusable parts (roving tabindex)
    <div role="tablist" aria-label={label} className={cx('ui-tabs', className)} data-grid={grid ? 'true' : undefined} onKeyDown={onKeyDown}>
      {tabs.map((tab) => (
        <button
          key={tab.value}
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
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
          {tab.trailing}
        </button>
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
    <div
      role="tabpanel"
      id={panelId(tabsId, value)}
      aria-labelledby={tabId(tabsId, value)}
      // The panel is the next Tab stop after the tabs, so a panel with nothing focusable in it can still be scrolled by keyboard.
      // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- ARIA tabs pattern
      tabIndex={0}
      className="ui-tabpanel"
    >
      {children}
    </div>
  ) : null;
}
