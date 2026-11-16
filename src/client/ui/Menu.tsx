import React from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cx } from './cx';
import { firstEnabled, lastEnabled, moveIndex, typeAheadIndex } from './listNav';
import { Popover } from './Popover';
import type { Align } from './position';
import { useTypeAhead } from './useTypeAhead';

export interface MenuItem {
  id: string;
  label: string;
  icon?: React.ReactNode;
  /** Runs the item (the menu closes first). An item that opens `items` needs none. */
  onSelect?: () => void;
  /** A destructive item: shown in the danger colour (its text still says what it does). */
  danger?: boolean;
  disabled?: boolean;
  /** Draws a hairline above this item, to group the items. */
  separatorBefore?: boolean;
  /** A short note at the end of the item, in the secondary colour (a snooze time's day and hour). */
  hint?: string;
  /**
   * A list of its own (Snooze: the times; Move to folder: the folders). Choosing the item shows this list in the same menu, in its place
   * (a chevron says so); Left, or the Back item when the menu has a `backLabel`, goes back to the first list.
   */
  items?: readonly MenuItem[];
}

/**
 * What the trigger needs from the menu: spread it on the button that opens it (Button, IconButton or a plain button). No `aria-controls`:
 * it is optional in the menu button pattern, and with `aria-haspopup` axe cannot tell whether the id it names exists (a "needs review" on
 * every open menu); the menu is the next thing focus reaches.
 */
export interface MenuTriggerProps {
  ref: React.RefObject<HTMLButtonElement | null>;
  id: string;
  'aria-haspopup': 'menu';
  'aria-expanded': boolean;
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
  /**
   * The name of Back in a list opened from an item (`items`): the list then has a header row, Back and the item's name over the list (J3-37,
   * as the Snooze popup names its times); without it, only Left goes back.
   */
  backLabel?: string;
}

/**
 * A menu of actions that opens from a button (the "more" button of a toolbar, the actions of a row). It follows the ARIA menu button
 * pattern: Enter, Space or Down open it on the first item, Up on the last; Up and Down move (and wrap), Home and End jump, letters find
 * an item, Enter or Space run it, Escape closes it and puts focus back on the button, Tab closes it and moves on. The menu is drawn over
 * everything and flips upward near the bottom. An item with `items` opens its own list in the same menu (Right, Enter or a click; Left or
 * Back returns): the selection bar's More holds Snooze's times and the folders that way. Not for choosing a value (use Select) and not for
 * moving between pages.
 */
export function Menu({ items: top, trigger, label, align = 'start', className, backLabel }: MenuProps): React.ReactElement {
  const id = React.useId();
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);
  const itemRefs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const typeAhead = useTypeAhead();
  const [open, setOpen] = React.useState(false);
  /** The item that gets focus when the menu opens: the first, or the last when it was opened with Up. */
  const [focusAt, setFocusAt] = React.useState(-1);
  /** The item whose own list is shown in place of the first one (null: the first list). */
  const [inside, setInside] = React.useState<string | null>(null);
  const parent = inside === null ? undefined : top.find((item) => item.id === inside && item.items !== undefined);
  const back = () => {
    setFocusAt(
      Math.max(
        0,
        top.findIndex((item) => item.id === inside)
      )
    );
    setInside(null);
  };
  const backId = `${parent?.id ?? ''}:back`;
  const items: readonly MenuItem[] =
    parent?.items === undefined
      ? top
      : backLabel === undefined
        ? parent.items
        : [
            {
              id: backId,
              label: backLabel,
              icon: <ChevronLeft size={16} strokeWidth={1.75} aria-hidden="true" />,
              onSelect: back
            },
            ...parent.items
          ];

  React.useEffect(() => {
    if (open) {
      itemRefs.current[focusAt]?.focus({ preventScroll: true });
    }
  }, [open, focusAt, inside]);

  const openAt = (index: number) => {
    setFocusAt(index);
    setInside(null);
    setOpen(true);
  };

  const close = (returnFocus: boolean) => {
    setOpen(false);
    setInside(null);
    if (returnFocus) {
      triggerRef.current?.focus({ preventScroll: true });
    }
  };

  const focusItem = (index: number) => {
    itemRefs.current[index]?.focus({ preventScroll: true });
  };

  const run = (item: MenuItem) => {
    if (item.items !== undefined) {
      // Its own list, in place of this one, on its first item (after the header's Back).
      setInside(item.id);
      setFocusAt(firstEnabled(item.items) + (backLabel === undefined ? 0 : 1));
      return;
    }
    if (parent !== undefined && item.id === backId) {
      back();
      return;
    }
    // Focus goes back to the button first, so a dialog that the item opens takes the button as its opener.
    close(true);
    item.onSelect?.();
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
      case 'ArrowRight': {
        const item = current === -1 ? undefined : items[current];
        if (item?.items !== undefined && item.disabled !== true) {
          event.preventDefault();
          run(item);
        }
        break;
      }
      case 'ArrowLeft': {
        if (parent !== undefined) {
          event.preventDefault();
          back();
        }
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
        aria-label={parent?.label ?? label}
        aria-labelledby={label === undefined && parent === undefined ? `${id}-trigger` : undefined}
        className={cx('ui-menu', className)}
        onKeyDown={onMenuKeyDown}
      >
        {items.map((item, index) => {
          const setRef = (element: HTMLButtonElement | null) => {
            itemRefs.current[index] = element;
          };
          const focusOnHover = (event: React.MouseEvent<HTMLButtonElement>) => {
            if (document.activeElement !== event.currentTarget) {
              event.currentTarget.focus({ preventScroll: true });
            }
          };
          if (parent !== undefined && item.id === backId) {
            // The header of a list opened from an item: Back (a chevron, named Back), then the item's name, which already names the menu.
            return (
              <div key={`${inside ?? ''}/${item.id}`} role="none" className="ui-menu-head">
                <button
                  ref={setRef}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  aria-label={item.label}
                  className="ui-menu-item ui-menu-back"
                  onMouseMove={focusOnHover}
                  onClick={() => run(item)}
                >
                  {item.icon}
                </button>
                <span aria-hidden="true" className="ui-menu-title">
                  {parent.label}
                </span>
              </div>
            );
          }
          return (
            <React.Fragment key={`${inside ?? ''}/${item.id}`}>
              {item.separatorBefore === true ? <div role="separator" className="ui-menu-sep" /> : null}
              <button
                ref={setRef}
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="ui-menu-item"
                data-danger={item.danger === true ? 'true' : undefined}
                disabled={item.disabled}
                onMouseMove={focusOnHover}
                onClick={() => run(item)}
              >
                {item.icon}
                <span className="ui-menu-label">{item.label}</span>
                {item.hint === undefined ? null : <span className="ui-menu-hint">{item.hint}</span>}
                {item.items === undefined ? null : (
                  <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" className="ui-menu-chevron" />
                )}
              </button>
            </React.Fragment>
          );
        })}
      </Popover>
    </>
  );
}
