import React from 'react';
import { cx } from './cx';
import { firstEnabled, lastEnabled, moveIndex, typeAheadIndex } from './listNav';
import { Popover } from './Popover';
import type { Align } from './position';
import { useTypeAhead } from './useTypeAhead';

export interface MenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  onSelect: () => void;
  /** A destructive item: shown in the danger colour (its text still says what it does). */
  danger?: boolean;
  disabled?: boolean;
  /** Draws a hairline above this item, to group the items. */
  separatorBefore?: boolean;
}

/** What the trigger needs from the menu: spread it on the button that opens it (Button, IconButton or a plain button). */
export interface MenuTriggerProps {
  ref: React.RefObject<HTMLButtonElement | null>;
  id: string;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
  'aria-controls': string | undefined;
  onClick: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => void;
}

export interface MenuProps {
  items: readonly MenuItem[];
  /** Draws the button that opens the menu: `trigger={(props) => <IconButton label={tr('...')} {...props}><Icon /></IconButton>}`. */
  trigger: (props: MenuTriggerProps) => React.ReactElement;
  /** The accessible name of the menu itself; the trigger's name is used when it is left out. */
  label?: string;
  align?: Align;
  className?: string;
}

/**
 * A menu of actions that opens from a button (the "more" button of a toolbar, the actions of a row). It follows the ARIA menu button
 * pattern: Enter, Space or Down open it on the first item, Up on the last; Up and Down move (and wrap), Home and End jump, letters find
 * an item, Enter or Space run it, Escape closes it and puts focus back on the button, Tab closes it and moves on. The menu is drawn over
 * everything and flips upward near the bottom. Not for choosing a value (use Select) and not for moving between pages.
 */
export function Menu({ items, trigger, label, align = 'start', className }: MenuProps): React.ReactElement {
  const id = React.useId();
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const typeAhead = useTypeAhead();
  const [open, setOpen] = React.useState(false);
  /** The item that gets focus when the menu opens: the first, or the last when it was opened with Up. */
  const [focusAt, setFocusAt] = React.useState(-1);

  React.useEffect(() => {
    if (open) {
      itemRefs.current[focusAt]?.focus({ preventScroll: true });
    }
  }, [open, focusAt]);

  const openAt = (index: number) => {
    setFocusAt(index);
    setOpen(true);
  };

  const close = (returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) {
      triggerRef.current?.focus({ preventScroll: true });
    }
  };

  const focusItem = (index: number) => {
    itemRefs.current[index]?.focus({ preventScroll: true });
  };

  const run = (item: MenuItem) => {
    // Focus goes back to the button first, so a dialog that the item opens takes the button as its opener.
    close(true);
    item.onSelect();
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      openAt(event.key === 'ArrowDown' ? firstEnabled(items) : lastEnabled(items));
    }
  };

  const onMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const current = items.findIndex((_item, index) => itemRefs.current[index] === document.activeElement);
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        focusItem(moveIndex(items, current, 1, true));
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        focusItem(moveIndex(items, current, -1, true));
        break;
      }
      case 'Home': {
        event.preventDefault();
        focusItem(firstEnabled(items));
        break;
      }
      case 'End': {
        event.preventDefault();
        focusItem(lastEnabled(items));
        break;
      }
      case 'Tab': {
        // Close, put focus on the button, and let the browser move on from there.
        close(true);
        break;
      }
      default: {
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== ' ') {
          event.preventDefault();
          focusItem(typeAheadIndex(items, current, typeAhead.add(event.key)));
        }
      }
    }
  };

  return (
    <>
      {trigger({
        ref: triggerRef,
        id: `${id}-trigger`,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': open ? `${id}-menu` : undefined,
        onClick: () => {
          if (open) {
            close(false);
          } else {
            openAt(firstEnabled(items));
          }
        },
        onKeyDown: onTriggerKeyDown
      })}
      <Popover
        open={open}
        anchorRef={triggerRef}
        align={align}
        onClose={(reason) => close(reason === 'escape')}
        id={`${id}-menu`}
        role="menu"
        aria-label={label}
        aria-labelledby={label === undefined ? `${id}-trigger` : undefined}
        className={cx('ui-menu', className)}
        onKeyDown={onMenuKeyDown}
      >
        {items.map((item, index) => (
          <React.Fragment key={item.id}>
            {item.separatorBefore === true ? <div role="separator" className="ui-menu-sep" /> : null}
            <button
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              role="menuitem"
              tabIndex={-1}
              className="ui-menu-item"
              data-danger={item.danger === true ? 'true' : undefined}
              disabled={item.disabled}
              onMouseMove={(event) => {
                if (document.activeElement !== event.currentTarget) {
                  event.currentTarget.focus({ preventScroll: true });
                }
              }}
              onClick={() => run(item)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          </React.Fragment>
        ))}
      </Popover>
    </>
  );
}
