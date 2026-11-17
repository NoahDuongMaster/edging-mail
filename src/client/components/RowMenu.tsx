import React from 'react';
import {
  Archive,
  Ban,
  Check,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Clock,
  FolderInput,
  Forward,
  Inbox,
  Mail,
  MailOpen,
  MailX,
  Reply,
  ReplyAll,
  Square,
  Star,
  Tag,
  Trash2,
  type LucideProps
} from 'lucide-react';
import type { Message } from '../types';
import { useT } from '../lib/i18n';
import { folderName, labelsOf } from '../lib/mail';
import { usePrefs } from '../lib/prefs';
import { shortcutHint, shortcutOf, type MailShortcut } from '../lib/shortcuts';
import { snoozePresets } from '../lib/snooze';
import { Dialog, Popover } from '../ui';
import type { RowActions } from './MessageList';
import './rowmenu.css';

/** Which list of the menu shows: the actions, or the times of Snooze, the labels, the folders of Move to folder. */
export type RowMenuView = 'actions' | 'snooze' | 'label' | 'move';

/** The glyph of each folder a message can be moved to: the sidebar's (J3-37); a folder of its own takes the generic "move" glyph. */
const FOLDER_GLYPHS: Partial<Record<string, React.ComponentType<LucideProps>>> = {
  inbox: Inbox,
  archive: Archive,
  spam: Ban,
  trash: Trash2
};

/** The icon of a folder in a list of places to move to (the row menu, the selection bar): the one the sidebar draws for it. */
export function FolderIcon({ folder, ...props }: LucideProps & { folder: string }): React.ReactElement {
  const Glyph = FOLDER_GLYPHS[folder] ?? FolderInput;
  return <Glyph {...props} />;
}

/**
 * Where a desktop menu hangs, in viewport px: at the pointer of a right click (`start`: the menu's left edge there), or under the row's
 * actions for Shift+F10 (`end`: the menu's right edge there). It flips above when there is no room below.
 */
export interface RowMenuAnchor {
  x: number;
  y: number;
  align: 'start' | 'end';
}

interface RowMenuProps {
  /** The row the menu is about; null: closed. */
  message: Message | null;
  /** The folder the row is in (its own folder in an All mail search). */
  folder: string;
  /** The row's name in the list (the sender, or a draft's recipients) and its subject: the heading of the menu. */
  sender: string;
  subject: string;
  /** The row's actions; `replyAll` adds Reply all (A) after Reply (J6-40), when the list passes it. */
  actions: RowActions & { replyAll?: (message: Message) => void };
  onToggleStar: (message: Message) => void;
  onClose: () => void;
  /**
   * Called before an action that takes the row out of the list (Archive, Move to Trash, Move to Inbox, a snooze time, Unsnooze): the list
   * points `returnFocusRef` at the next row then, so focus never falls to the page when the menu closes.
   */
  onLeave: () => void;
  /** Where focus goes when the menu closes and the row it came from is gone (archived from the menu): the next row, else the list. */
  returnFocusRef: React.RefObject<HTMLElement | null>;
  /**
   * Opened by a long press: the sheet itself takes focus, not its first action (a script focus with no pointer focus before it would draw
   * the keyboard ring on Archive under the finger). Tab and the arrow keys still reach every action.
   */
  focusSheet?: boolean;
  /**
   * A mouse and a keyboard (desktop, J3-23): the menu is a popup anchored here (no scrim, no dialog), the way the Snooze and Label menus
   * are. Undefined: the bottom sheet of a phone.
   */
  anchor?: RowMenuAnchor;
  /** Every label the person has (Add label). */
  labels?: readonly string[];
  /** The row is ticked: the menu offers Deselect instead of Select. */
  checked?: boolean;
  /** The list to open on (b opens it on the snooze times, l on the labels, v on the folders); 'actions' is the first list. */
  initialView?: RowMenuView;
}

interface Item {
  id: string;
  label: string;
  /** A snooze time's wake time, or the key of the action (right-aligned). */
  hint?: string;
  /** The single key that runs this item while the popup is open (its `hint`): the row's own action, never the open message's. */
  shortcut?: MailShortcut;
  icon: React.ReactNode;
  run: () => void;
  danger?: boolean;
  /** Keeps the menu open (Snooze, Add label and Move to folder open their lists in the same menu). */
  stay?: boolean;
  /** Takes the row out of the list. */
  leaves?: boolean;
  /** Draws a hairline above the item. */
  separated?: boolean;
  /** A label the message has (a tick before it). */
  checked?: boolean;
}

const ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true } as const;
/** No labels (yet). */
const NO_LABELS: readonly string[] = [];
/** The actions that open a list of their own in the same menu (a chevron at their end). */
const OPENS_LIST = new Set(['snooze', 'label', 'move']);
const POP_ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const;

/** The folders a message can be moved to from a row (Drafts, Sent and Snoozed are not destinations). */
const MOVE_TARGETS = ['inbox', 'archive', 'spam', 'trash'] as const;

/** The arrow keys, Home and End move between the actions as in a context menu (Shift+F10); Tab does too in the sheet. */
function moveFocus(event: React.KeyboardEvent<HTMLButtonElement>): void {
  const buttons = [...(event.currentTarget.closest('[data-row-menu]')?.querySelectorAll<HTMLButtonElement>('.ml-menu-item') ?? [])];
  const at = buttons.indexOf(event.currentTarget);
  const keys: Partial<Record<string, number>> = {
    ArrowDown: (at + 1) % buttons.length,
    ArrowUp: (at <= 0 ? buttons.length : at) - 1,
    Home: 0,
    End: buttons.length - 1
  };
  const to = keys[event.key];
  if (to !== undefined) {
    event.preventDefault();
    buttons.at(to)?.focus();
  }
}

/**
 * The actions of one row, for the hands that have no hover: a long press on a phone row (a bottom sheet), Shift+F10 / the context-menu key
 * on a focused row, or a right click (a desktop popup anchored at the pointer or under the row's actions, no scrim, J3-23). The same actions
 * as the row's quick actions and the reader's toolbar: Archive, Move to Trash (Move to Inbox and Delete forever in Trash and Spam), Mark as
 * read or unread, Star, Snooze with its quick times, Add label, Move to folder, Reply, Forward and Select (J6-34), each with its key on the
 * right while single-key shortcuts are on (J6-31). Escape closes it and focus goes back to the row.
 */
export const RowMenu: React.FC<RowMenuProps> = ({
  message,
  folder,
  sender,
  subject,
  actions,
  onToggleStar,
  onClose,
  onLeave,
  returnFocusRef,
  focusSheet = false,
  anchor,
  labels = NO_LABELS,
  checked = false,
  initialView = 'actions'
}) => {
  const tr = useT();
  const keysOn = usePrefs().shortcuts;
  const sheetRef = React.useRef<HTMLDivElement | null>(null);
  const listRef = React.useRef<HTMLUListElement | null>(null);
  // The popup hangs from a zero-size box at the anchor point (the Popover places itself next to an element), placed by its ref.
  const anchorRef = React.useRef<HTMLElement | null>(null);
  const placeAnchor = React.useCallback(
    (node: HTMLSpanElement | null) => {
      anchorRef.current = node;
      if (node !== null && anchor !== undefined) {
        Object.assign(node.style, { left: `${anchor.x}px`, top: `${anchor.y}px` });
      }
    },
    [anchor]
  );
  const [view, setView] = React.useState<RowMenuView>(initialView);
  /** The list Back (or Left) last left: back on the first list, the item that opened it (Snooze, Add label, Move to folder) takes focus. */
  const [cameFrom, setCameFrom] = React.useState<RowMenuView | null>(null);
  const [shownFor, setShownFor] = React.useState<string | null>(null);
  // A new row starts on the list it was opened on, never on the snooze times of the last one.
  const id = message?.id ?? null;
  if (shownFor !== id) {
    setShownFor(id);
    setView(initialView);
    setCameFrom(null);
  }
  const popup = anchor !== undefined && message !== null;
  // The popup takes focus on its first item when it opens; a list opened from an item (Snooze, Add label, Move to folder) starts on its
  // first choice, in the popup and in the sheet alike (J1-23: the item that was tapped went away with the list it was in). Back on the
  // first list, the item that opened the list it leaves takes it (F4).
  React.useEffect(() => {
    const list = listRef.current;
    const opener =
      view === 'actions' && cameFrom !== null ? list?.querySelector<HTMLElement>(`[data-opens="${CSS.escape(cameFrom)}"]`) : null;
    const first = popup || view !== 'actions' ? list?.querySelector<HTMLElement>('.ml-menu-item') : null;
    (opener ?? first)?.focus({ preventScroll: true });
  }, [popup, view, id, cameFrom]);
  if (message === null) {
    return null;
  }
  const m = message;
  const inTrash = folder === 'trash';
  const inBin = inTrash || folder === 'spam';
  const unread = m.is_read === 0;
  const starred = m.is_starred === 1;
  const own = labelsOf(m);
  const key = (shortcut: MailShortcut): string | undefined => (popup && keysOn ? shortcutHint(shortcut) : undefined);
  /** The key hint of an item and the key itself: pressed in the popup, it runs the item for this row (J6-31). */
  const keyed = (shortcut: MailShortcut): Pick<Item, 'hint' | 'shortcut'> => {
    const hint = key(shortcut);
    return hint === undefined ? {} : { hint, shortcut };
  };
  const icon = popup ? POP_ICON : ICON;

  const closeAll = () => {
    onClose();
    if (popup) {
      returnFocusRef.current?.focus({ preventScroll: true });
    }
  };
  const run = (item: Item) => () => {
    if (item.stay === true) {
      item.run();
      return;
    }
    if (item.leaves === true) {
      onLeave();
    }
    closeAll();
    item.run();
  };
  /** Back to the first list, on the item that opened the one it leaves. */
  const goBack = () => {
    setCameFrom(view);
    setView('actions');
  };

  let items: Item[];
  switch (view) {
    case 'snooze': {
      items = snoozePresets(new Date()).map((preset): Item => ({
        id: preset.id,
        label: preset.label,
        hint: preset.hint,
        icon: <Clock {...icon} />,
        run: () => actions.snooze(m, preset.at),
        leaves: true
      }));
      break;
    }
    case 'label': {
      items = labels.map((label): Item => ({
        id: `label:${label}`,
        label,
        icon: own.includes(label) ? <Check {...icon} /> : <Tag {...icon} />,
        checked: own.includes(label),
        run: () => actions.label?.(m, label)
      }));
      break;
    }
    case 'move': {
      items = MOVE_TARGETS.filter((target) => target !== folder).map((target): Item => ({
        id: `move:${target}`,
        label: folderName(target),
        icon: <FolderIcon folder={target} {...icon} />,
        run: () => actions.move?.(m, target),
        leaves: true
      }));
      break;
    }
    case 'actions': {
      items = [
        inBin
          ? {
              id: 'restore',
              label: folder === 'spam' ? tr('action.not_spam') : tr('action.move_to_inbox'),
              ...keyed('archive'),
              icon: <Inbox {...icon} />,
              run: () => actions.restore(m),
              leaves: true
            }
          : {
              id: 'archive',
              label: tr('action.archive'),
              ...keyed('archive'),
              icon: <Archive {...icon} />,
              run: () => actions.archive(m),
              leaves: true
            },
        ...(inTrash
          ? []
          : [
              {
                id: 'trash',
                label: tr('action.move_to_trash'),
                ...keyed('trash'),
                icon: <Trash2 {...icon} />,
                run: () => actions.trash(m),
                leaves: true
              }
            ]),
        {
          id: 'read',
          label: unread ? tr('action.mark_read') : tr('action.mark_unread'),
          ...(unread ? {} : keyed('unread')),
          icon: unread ? <MailOpen {...icon} /> : <Mail {...icon} />,
          run: () => actions.toggleRead(m)
        },
        {
          id: 'star',
          label: starred ? tr('action.unstar') : tr('action.star'),
          ...keyed('star'),
          icon: <Star {...icon} fill={starred ? 'currentColor' : 'none'} />,
          run: () => onToggleStar(m)
        },
        ...(folder === 'snoozed'
          ? [{ id: 'unsnooze', label: tr('action.unsnooze'), icon: <Clock {...icon} />, run: () => actions.unsnooze(m), leaves: true }]
          : inBin || folder === 'sent'
            ? []
            : [
                {
                  id: 'snooze',
                  label: tr('action.snooze'),
                  ...keyed('snooze'),
                  icon: <Clock {...icon} />,
                  run: () => setView('snooze'),
                  stay: true
                }
              ]),
        ...(actions.label === undefined || labels.length === 0 || inBin
          ? []
          : [
              {
                id: 'label',
                label: tr('reader.add_label'),
                ...keyed('label'),
                icon: <Tag {...icon} />,
                run: () => setView('label'),
                stay: true,
                separated: true
              }
            ]),
        ...(actions.move === undefined
          ? []
          : [
              {
                id: 'move',
                label: tr('action.move_to_folder'),
                icon: <FolderInput {...icon} />,
                run: () => setView('move'),
                stay: true,
                separated: actions.label === undefined || labels.length === 0 || inBin
              }
            ]),
        ...(actions.reply === undefined || inBin
          ? []
          : [
              {
                id: 'reply',
                label: tr('action.reply'),
                ...keyed('reply'),
                icon: <Reply {...icon} />,
                run: () => actions.reply?.(m),
                separated: true
              },
              ...(actions.replyAll === undefined
                ? []
                : [
                    {
                      id: 'replyAll',
                      label: tr('action.reply_all'),
                      ...keyed('replyAll'),
                      icon: <ReplyAll {...icon} />,
                      run: () => actions.replyAll?.(m)
                    }
                  ]),
              {
                id: 'forward',
                label: tr('action.forward'),
                ...keyed('forward'),
                icon: <Forward {...icon} />,
                run: () => actions.forward?.(m)
              }
            ]),
        ...(actions.select === undefined
          ? []
          : [
              {
                id: 'select',
                label: checked ? tr('action.deselect') : tr('action.select'),
                ...keyed('select'),
                icon: checked ? <Square {...icon} /> : <CheckSquare {...icon} />,
                run: () => actions.select?.(m),
                separated: true
              }
            ]),
        ...(inBin
          ? [
              {
                id: 'delete',
                label: tr('action.delete_forever'),
                ...(inTrash ? keyed('trash') : {}),
                icon: <MailX {...icon} />,
                run: () => actions.deleteForever(m),
                danger: true,
                separated: true
              }
            ]
          : [])
      ];
      break;
    }
  }

  /** The name of a list opened from an item: the header over it, beside Back (J3-37, as the Snooze popup of the reader). */
  const title =
    view === 'snooze'
      ? tr('snooze.menu_label')
      : view === 'label'
        ? tr('reader.add_label')
        : view === 'move'
          ? tr('action.move_to_folder')
          : null;

  const list = (
    // The header and the list change together (keyed): a new list is a new element, which the sheet animates its height for (J2-21).
    <div key={view} role={popup ? 'none' : undefined} className="ml-menu-view">
      {title === null ? null : (
        <div role={popup ? 'none' : undefined} className="ml-menu-head">
          <button
            type="button"
            role={popup ? 'menuitem' : undefined}
            tabIndex={popup ? -1 : undefined}
            aria-label={tr('common.back')}
            className="ml-menu-item ml-menu-back"
            onKeyDown={moveFocus}
            onMouseMove={
              popup
                ? (event) => {
                    if (document.activeElement !== event.currentTarget) {
                      event.currentTarget.focus({ preventScroll: true });
                    }
                  }
                : undefined
            }
            onClick={goBack}
          >
            <ChevronLeft {...icon} />
          </button>
          {popup ? (
            // The menu is named by it already (aria-label): read once.
            <span aria-hidden="true" className="ml-menu-title">
              {title}
            </span>
          ) : (
            <h3 className="ml-menu-title">{title}</h3>
          )}
        </div>
      )}
      <ul ref={listRef} role={popup ? 'none' : 'list'} className="ml-menu-list">
        {items.map((item) => (
          <li key={item.id} role={popup ? 'none' : undefined} data-separated={item.separated === true ? 'true' : undefined}>
            <button
              type="button"
              role={popup ? (view === 'label' ? 'menuitemcheckbox' : 'menuitem') : undefined}
              aria-checked={popup && view === 'label' ? item.checked === true : undefined}
              tabIndex={popup ? -1 : undefined}
              className="ml-menu-item"
              data-danger={item.danger === true ? 'true' : undefined}
              data-opens={view === 'actions' && OPENS_LIST.has(item.id) ? item.id : undefined}
              onKeyDown={moveFocus}
              onMouseMove={
                popup
                  ? (event) => {
                      if (document.activeElement !== event.currentTarget) {
                        event.currentTarget.focus({ preventScroll: true });
                      }
                    }
                  : undefined
              }
              onClick={run(item)}
            >
              {item.icon}
              <span className="ml-menu-label">{item.label}</span>
              {view === 'snooze' ? (
                item.hint === undefined ? null : (
                  <span className="ml-menu-hint">{item.hint}</span>
                )
              ) : popup ? (
                // Two fixed columns, so every key lines up: the key, then the chevron of an item that opens a list (else its room).
                <span className="ml-menu-end">
                  {item.hint === undefined ? null : <kbd className="ml-menu-key">{item.hint}</kbd>}
                  <span className="ml-menu-more">
                    {OPENS_LIST.has(item.id) ? <ChevronRight size={14} strokeWidth={1.75} aria-hidden="true" /> : null}
                  </span>
                </span>
              ) : OPENS_LIST.has(item.id) ? (
                <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" className="ml-menu-chevron" />
              ) : null}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  if (popup) {
    return (
      <>
        <span ref={placeAnchor} aria-hidden="true" className="ml-menu-point" />
        <Popover
          open
          anchorRef={anchorRef}
          align={anchor.align}
          onClose={(reason) => {
            onClose();
            if (reason === 'escape') {
              returnFocusRef.current?.focus({ preventScroll: true });
            } else {
              // A press outside: focus goes where it pressed; on something that takes no focus (the page, or the list around the row), back
              // to the row it was opened from.
              window.setTimeout(() => {
                const now = document.activeElement;
                const row = returnFocusRef.current;
                if (now === null || now === document.body || (row !== null && now !== row && now.contains(row))) {
                  row?.focus({ preventScroll: true });
                }
              }, 0);
            }
          }}
          role="menu"
          aria-label={title ?? `${subject}, ${sender}`}
          className="ml-menu-pop"
          data-row-menu=""
          onKeyDown={(event) => {
            const shortcut = keysOn ? shortcutOf(event.nativeEvent, null) : null;
            if (event.key === 'Tab') {
              // A menu is one stop: Tab closes it and focus goes on from the row.
              event.preventDefault();
              closeAll();
            } else if (event.key === 'ArrowLeft' && view !== 'actions') {
              event.preventDefault();
              goBack();
            } else if (shortcut !== null) {
              // The keys beside the items run them for THIS row (b and l open the times and the labels here); the others do nothing while
              // the menu is open. None of them reaches the page's own keys, which act on the open message.
              event.preventDefault();
              event.stopPropagation();
              const item = items.find((each) => each.shortcut === shortcut);
              if (item !== undefined) {
                run(item)();
              }
            }
          }}
        >
          {list}
        </Popover>
      </>
    );
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={subject}
      description={sender}
      size="sm"
      className="ml-menu"
      returnFocusRef={returnFocusRef}
      ref={sheetRef}
      initialFocusRef={focusSheet ? sheetRef : undefined}
    >
      <div data-row-menu="">{list}</div>
    </Dialog>
  );
};
