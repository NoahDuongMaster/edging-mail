import React from 'react';
import {
  Archive,
  CalendarClock,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock,
  FolderInput,
  Inbox,
  Mail,
  MailOpen,
  MailX,
  MoreHorizontal,
  Star,
  Tag,
  Trash2,
  X
} from 'lucide-react';
import { useT } from '../lib/i18n';
import { folderName } from '../lib/mail';
import type { PageState } from '../lib/selection';
import { fadeOutInPlace } from '../lib/shellMotion';
import type { SelectionMenuView } from '../lib/shortcuts';
import {
  MAX_SNOOZE_MS,
  MIN_SNOOZE_MS,
  parseLocalInput,
  snoozePresets,
  snoozeProblem,
  toLocalInputValue,
  tomorrowMorning
} from '../lib/snooze';
import type { ThemeTokens } from '../theme';
import {
  Button,
  Checkbox,
  DateTimePicker,
  Dialog,
  IconButton,
  Menu,
  Toolbar,
  VisuallyHidden,
  type MenuItem,
  type MenuTriggerProps
} from '../ui';
import { useFontsLoaded } from './reader/barDensity';
import { RollingText } from './MessageList';
import { FolderIcon } from './RowMenu';
import { SnoozeMenu } from './SnoozeMenu';

/** What the selection bar does to the selected messages (App runs each one on all of them, in chunks of 100 ids). */
export interface SelectionActions {
  archive: () => void;
  trash: () => void;
  /** Trash and Spam: back to the Inbox. */
  restore: () => void;
  /** Trash and Spam: asks first (the caller's ConfirmDialog names the count; no Undo). */
  deleteForever: () => void;
  read: () => void;
  unread: () => void;
  star: () => void;
  unstar: () => void;
  move: (folder: string) => void;
  /** Snoozes them all until then (not in Trash, Spam, Sent or Snoozed). */
  snooze: (until: Date) => void;
  label: (label: string) => void;
}

/** b, l or v pressed while messages are ticked (J6-38): open that list of the bar. `at` tells two presses apart. */
export interface SelectionMenuRequest {
  view: SelectionMenuView;
  at: number;
}

/** The look the snooze button takes from the bar (the bar's stylesheet sizes it). */
const NO_STYLE: React.CSSProperties = {};

/** The bar's snooze button never unsnoozes (it is not offered in Snoozed). */
function keepSnoozed(): void {
  // nothing to bring back
}

/** The button a menu of the bar opens from: an icon button named for what the menu does (`id`: the key b, l or v finds it by). */
function iconTrigger(label: string, icon: React.ReactNode, id: string): (props: MenuTriggerProps) => React.ReactElement {
  return function MenuTrigger(props) {
    return (
      <IconButton label={label} size="sm" data-bar-action={id} {...props}>
        {icon}
      </IconButton>
    );
  };
}

export interface SelectionBarProps {
  t: ThemeTokens;
  /** How many messages are ticked (at least one: the bar is shown only then). */
  count: number;
  /** How much of the page is ticked: the box of the bar is ticked, a dash, or clear. */
  state: PageState;
  onToggleAll: () => void;
  onClear: () => void;
  /** The folder of the list ('trash' and 'spam' offer Move to Inbox and Delete forever instead of Archive and Move to Trash). */
  folder: string;
  /** Something ticked is unread / not starred: Mark as read and Star are offered (else Mark as unread and Unstar). */
  anyUnread: boolean;
  anyUnstarred: boolean;
  /** Every label the person has (Add label). */
  labels: readonly string[];
  actions: SelectionActions;
  /** The phone's top bar: Close, the count, Archive, Move to Trash and a More sheet with the rest. */
  phone?: boolean;
  /** b, l, v (J6-38): open the bar's Snooze, Add label or Move to folder list; `onMenuRequestDone` is called once it is open. */
  menuRequest?: SelectionMenuRequest | null;
  onMenuRequestDone?: () => void;
}

/** The folders the selection can be moved to (not the one it is in). */
const MOVE_TARGETS = ['inbox', 'archive', 'spam', 'trash'] as const;

const ICON = { size: 16, strokeWidth: 1.75, 'aria-hidden': true } as const;
const SHEET_ICON = { size: 20, strokeWidth: 1.75, 'aria-hidden': true } as const;

/**
 * The hairline of the desktop bar after its first two actions, in px with its margins (messagelist.css `.ml-selbar-sep`: 1px and 4px on
 * each side).
 */
export const SELBAR_SEP = 9;

/**
 * How many of `total` actions show as buttons in a row `room` px wide, in their order; the others go into More, which takes one button's
 * room itself. Buttons are `button` px with `gap` between them; a `sep` px hairline (and its gap) follows the first two when anything comes
 * after them in the row.
 */
export function fittingActions(room: number, total: number, button: number, gap: number, sep: number): number {
  for (let shown = total; shown > 0; shown -= 1) {
    const buttons = shown + (shown < total ? 1 : 0);
    const hairline = sep > 0 && shown >= 2 && buttons > 2 ? sep + gap : 0;
    if (buttons * button + (buttons - 1) * gap + hairline <= room) {
      return shown;
    }
  }
  return 0;
}

const px = (value: string): number => Number.parseFloat(value) || 0;

/** The width of an element with its side margins, in px. */
function outerWidth(element: Element | null): number {
  if (!(element instanceof HTMLElement)) {
    return 0;
  }
  const style = getComputedStyle(element);
  return element.offsetWidth + px(style.marginLeft) + px(style.marginRight);
}

/** The width the count needs: its words (not its box, which grows into the free room), its padding and its margins. */
function countWidth(count: HTMLElement): number {
  const range = document.createRange();
  range.selectNodeContents(count);
  const style = getComputedStyle(count);
  return (
    Math.ceil(range.getBoundingClientRect().width) +
    px(style.paddingLeft) +
    px(style.paddingRight) +
    px(style.marginLeft) +
    px(style.marginRight)
  );
}

/**
 * Measures the bar the count sits in, as laid out and again whenever it or the count changes: the room for the actions is the row's inner
 * width less the count (never cut: "100 selected" in every language) and the parts that always show. `fit` turns that room into how many
 * actions show; until it is measured (the server, a first render) every action shows. The parts are measured as they are drawn, so a text
 * spacing override (WCAG 1.4.12: wider letters and words) moves more actions into More instead of pushing Clear out of the row (J1-25).
 */
function useFit(total: number, fixed: string, fit: (room: number, button: number, gap: number) => number, text: string) {
  const countRef = React.useRef<HTMLElement | null>(null);
  const [shown, setShown] = React.useState(total);
  const fonts = useFontsLoaded();
  React.useLayoutEffect(() => {
    const count = countRef.current;
    const row = count?.parentElement;
    if (count === null || row === null || row === undefined) {
      return;
    }
    const measure = () => {
      const style = getComputedStyle(row);
      const inner = row.clientWidth - px(style.paddingLeft) - px(style.paddingRight);
      if (inner <= 0) {
        return;
      }
      const parts = [...row.querySelectorAll<HTMLElement>(fixed)].filter((part) => part.parentElement === row);
      const gap = px(style.columnGap);
      // The count, the parts that always show, the actions after them: one gap between each two; 1px kept spare for sub-pixel widths.
      const room = inner - countWidth(count) - parts.reduce((sum, part) => sum + outerWidth(part) + gap, 0) - gap - 1;
      const button = parts.at(-1)?.offsetWidth ?? 32;
      setShown(fit(room, button, gap));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    // The words can change width without the row changing size (a text spacing override, a font that loads late): watch the count too.
    observer.observe(count);
    return () => observer.disconnect();
  }, [fixed, fit, text, fonts, total]);
  return { countRef, shown: Math.min(shown, total) };
}

/**
 * The bar takes the list head's place by a fade-through (J2-23): the head's copy fades out in 90 ms while the bar comes in after 60 ms with
 * the standard enter (messagelist.css: a fade and 8px down, 200 ms ease-enter); it gives the place back the same way: an inert copy over its
 * place fades and lifts 8px in 90 ms (lib/shellMotion `fadeOutInPlace`) while the head fades in after 60 ms. Under reduced motion both only
 * fade. `inner` is an element of the bar's own row (its count); `replacedBy` is what takes the place back (the head, the app bar).
 */
function useLeaveInPlace(inner: React.RefObject<HTMLElement | null>, replacedBy: string): void {
  React.useLayoutEffect(() => {
    const bar = inner.current?.parentElement ?? null;
    return () => {
      if (bar !== null) {
        fadeOutInPlace(bar, { lift: true, replacedBy });
      }
    };
  }, [inner, replacedBy]);
}

/**
 * Runs a request of b, l or v once (StrictMode runs an effect twice on mount; App keeps the request until it is told it is done).
 */
function useMenuRequest(
  request: SelectionMenuRequest | null | undefined,
  open: (view: SelectionMenuView) => void,
  done: (() => void) | undefined
): void {
  const handled = React.useRef(0);
  const openRef = React.useRef(open);
  const doneRef = React.useRef(done);
  React.useLayoutEffect(() => {
    openRef.current = open;
    doneRef.current = done;
  });
  React.useEffect(() => {
    if (request === null || request === undefined || handled.current === request.at) {
      return;
    }
    handled.current = request.at;
    openRef.current(request.view);
    doneRef.current?.();
  }, [request]);
}

/** An action that is one button (or one item of More, or one row of the phone's sheet). */
interface SimpleAction {
  id: string;
  label: string;
  icon: React.ReactNode;
  run: () => void;
  danger?: boolean;
}

/** One action of the desktop bar: its own button while there is room, else an item of More (in the same order). */
interface BarAction {
  id: string;
  button: React.ReactNode;
  item: MenuItem;
}

/**
 * The head of the list while messages are ticked (J6-26): the box that ticks every row of the page (a dash when only some are), "N selected",
 * the actions for all of them and Clear. On a desktop it is a toolbar in place of the list's head (one Tab stop, the arrows move); on a
 * phone it takes the place of the app bar: Close, the count, Archive and Move to Trash, and More (a sheet with the rest). In Trash and Spam
 * the two first actions are Move to Inbox and Delete forever (asked first, no Undo). The count is never cut: when the row is too narrow
 * for every action, the last ones go into a More menu (desktop) or the More sheet (phone), measured as the row is laid out.
 */
export function SelectionBar({
  t,
  count,
  state,
  onToggleAll,
  onClear,
  folder,
  anyUnread,
  anyUnstarred,
  labels,
  actions,
  phone = false,
  menuRequest,
  onMenuRequestDone
}: SelectionBarProps): React.ReactElement {
  const tr = useT();
  const bin = folder === 'trash' || folder === 'spam';
  // Snooze is not offered in Trash, Spam, Sent, Snoozed or an All mail search (as the reader and the row menu).
  const snoozable = !(bin || folder === 'sent' || folder === 'snoozed' || folder === 'all');
  const counted = tr('list.selected_count', { count });
  const targets = MOVE_TARGETS.filter((target) => target !== folder);
  const icon = phone ? SHEET_ICON : ICON;
  const firstAction: SimpleAction = bin
    ? { id: 'restore', label: tr('action.move_to_inbox'), icon: <Inbox {...icon} />, run: actions.restore }
    : { id: 'archive', label: tr('action.archive'), icon: <Archive {...icon} />, run: actions.archive };
  const secondAction: SimpleAction = bin
    ? { id: 'delete', label: tr('action.delete_forever'), icon: <MailX {...icon} />, run: actions.deleteForever, danger: true }
    : { id: 'trash', label: tr('action.move_to_trash'), icon: <Trash2 {...icon} />, run: actions.trash };
  const asButton = (action: SimpleAction) => (
    <IconButton key={action.id} label={action.label} size={phone ? 'md' : 'sm'} onClick={action.run}>
      {action.icon}
    </IconButton>
  );
  const request = { menuRequest, onMenuRequestDone };

  if (phone) {
    return (
      <PhoneBar
        {...{ counted, count, onClear, onToggleAll, state, snoozable, anyUnread, anyUnstarred, labels, targets, actions, ...request }}
        firsts={[firstAction, secondAction]}
        asButton={asButton}
      />
    );
  }
  return (
    <DesktopBar
      counted={counted}
      count={count}
      state={state}
      onToggleAll={onToggleAll}
      onClear={onClear}
      {...request}
      actions={desktopActions({
        t,
        tr,
        bin,
        snoozable,
        anyUnread,
        anyUnstarred,
        labels,
        targets,
        actions,
        firstAction,
        secondAction,
        asButton
      })}
    />
  );
}

interface ActionsInput {
  t: ThemeTokens;
  tr: ReturnType<typeof useT>;
  bin: boolean;
  snoozable: boolean;
  anyUnread: boolean;
  anyUnstarred: boolean;
  labels: readonly string[];
  targets: readonly string[];
  actions: SelectionActions;
  firstAction: SimpleAction;
  secondAction: SimpleAction;
  asButton: (action: SimpleAction) => React.ReactNode;
}

/** The actions of the desktop bar in their order, each as its button and as an item of More. */
function desktopActions({
  t,
  tr,
  bin,
  snoozable,
  anyUnread,
  anyUnstarred,
  labels,
  targets,
  actions,
  firstAction,
  secondAction,
  asButton
}: ActionsInput): BarAction[] {
  const simple = (action: SimpleAction): BarAction => ({
    id: action.id,
    button: asButton(action),
    item: { id: action.id, label: action.label, icon: action.icon, onSelect: action.run, danger: action.danger }
  });
  const moveItems: MenuItem[] = targets.map((target) => ({
    id: target,
    label: folderName(target),
    // The sidebar's icon of each folder, as in the row menu's Move to folder (J3-37).
    icon: <FolderIcon folder={target} {...ICON} />,
    onSelect: () => actions.move(target)
  }));
  const labelItems: MenuItem[] = labels.map((label) => ({
    id: label,
    label,
    icon: <Tag {...ICON} />,
    onSelect: () => actions.label(label)
  }));
  const list: BarAction[] = [simple(firstAction), simple(secondAction)];
  if (snoozable) {
    list.push({
      id: 'snooze',
      button: (
        <SnoozeMenu
          key="snooze"
          t={t}
          buttonStyle={NO_STYLE}
          iconSize={16}
          snoozed={false}
          onSnooze={actions.snooze}
          onUnsnooze={keepSnoozed}
        />
      ),
      item: {
        id: 'snooze',
        label: tr('action.snooze'),
        icon: <Clock {...ICON} />,
        items: snoozePresets(new Date()).map((preset) => ({
          id: preset.id,
          label: preset.label,
          hint: preset.hint,
          icon: <Clock {...ICON} />,
          onSelect: () => actions.snooze(preset.at)
        }))
      }
    });
  }
  list.push(
    anyUnread
      ? simple({ id: 'read', label: tr('action.mark_read'), icon: <MailOpen {...ICON} />, run: actions.read })
      : simple({ id: 'unread', label: tr('action.mark_unread'), icon: <Mail {...ICON} />, run: actions.unread }),
    anyUnstarred
      ? simple({ id: 'star', label: tr('action.star'), icon: <Star {...ICON} />, run: actions.star })
      : simple({ id: 'unstar', label: tr('action.unstar'), icon: <Star {...ICON} fill="currentColor" />, run: actions.unstar }),
    {
      id: 'move',
      button: (
        <Menu
          key="move"
          align="end"
          label={tr('action.move_to_folder')}
          items={moveItems}
          trigger={iconTrigger(tr('action.move_to_folder'), <FolderInput {...ICON} />, 'move')}
        />
      ),
      item: { id: 'move', label: tr('action.move_to_folder'), icon: <FolderInput {...ICON} />, items: moveItems }
    }
  );
  if (labels.length > 0 && !bin) {
    list.push({
      id: 'label',
      button: (
        <Menu
          key="label"
          align="end"
          label={tr('reader.add_label')}
          items={labelItems}
          trigger={iconTrigger(tr('reader.add_label'), <Tag {...ICON} />, 'label')}
        />
      ),
      item: { id: 'label', label: tr('reader.add_label'), icon: <Tag {...ICON} />, items: labelItems }
    });
  }
  return list;
}

/** The parts of the desktop bar that always show (the box, Clear; Clear is last: its width is a button's). */
const DESKTOP_FIXED = '.ml-selbar-all, .ml-selbar-clear';
const desktopFit = (room: number, button: number, gap: number, total: number): number =>
  fittingActions(room, total, button, gap, SELBAR_SEP);

interface DesktopBarProps {
  counted: string;
  /** The number in `counted`: it rolls when it changes (DESIGN-v3 H2). */
  count: number;
  state: PageState;
  onToggleAll: () => void;
  onClear: () => void;
  actions: readonly BarAction[];
  menuRequest?: SelectionMenuRequest | null;
  onMenuRequestDone?: () => void;
}

function DesktopBar({ counted, count, state, onToggleAll, onClear, actions, menuRequest, onMenuRequestDone }: DesktopBarProps) {
  const tr = useT();
  const total = actions.length;
  const fit = React.useCallback((room: number, button: number, gap: number) => desktopFit(room, button, gap, total), [total]);
  const { countRef, shown } = useFit(total, DESKTOP_FIXED, fit, counted);
  // The bar floats in the list sheet's dock (MessageList): its copy fades out where it was when the selection ends.
  useLeaveInPlace(countRef, '.ml-dock-anchor');
  const visible = actions.slice(0, shown);
  const more = actions.slice(shown);
  // b, l, v (J6-38): the list's own button when it shows (focus on it, then open it as the keyboard would), else More opened on its item.
  useMenuRequest(
    menuRequest,
    (view) => {
      const bar = countRef.current?.parentElement;
      if (bar === null || bar === undefined) {
        return;
      }
      const own =
        view === 'snooze'
          ? bar.querySelector<HTMLElement>('.ml-snooze button')
          : bar.querySelector<HTMLElement>(`[data-bar-action="${CSS.escape(view)}"]`);
      if (own !== null) {
        own.focus();
        own.click();
        return;
      }
      const at = more.findIndex((action) => action.id === view);
      const trigger = bar.querySelector<HTMLElement>('[data-bar-action="more"]');
      if (at === -1 || trigger === null) {
        return;
      }
      trigger.focus();
      trigger.click();
      // The menu is drawn by the click's render: its item opens the list in place (focus on the list's first item).
      window.requestAnimationFrame(() => {
        const menu = document.querySelector<HTMLElement>(`#${CSS.escape(trigger.id.replace(/-trigger$/, '-menu'))}`);
        menu?.querySelectorAll<HTMLElement>('[role="menuitem"]')[at]?.click();
      });
    },
    onMenuRequestDone
  );
  return (
    <Toolbar
      aria-label={tr('list.selection_actions')}
      className="ml-selbar"
      onKeyDown={(event) => {
        // Escape clears the selection, unless it closes a menu of the bar (that menu takes it first).
        if (event.key === 'Escape' && !(event.target instanceof Element && event.target.closest('[role="menu"]') !== null)) {
          event.preventDefault();
          onClear();
        }
      }}
    >
      <Checkbox
        className="ml-selbar-all"
        label={<VisuallyHidden>{tr('list.select_all')}</VisuallyHidden>}
        checked={state === 'all'}
        indeterminate={state === 'some'}
        onChange={onToggleAll}
      />
      <span
        ref={(node) => {
          countRef.current = node;
        }}
        className="ml-selbar-count"
      >
        <RollingText text={counted} count={count} />
      </span>
      <div className="ml-selbar-actions">
        {visible.slice(0, 2).map((action) => action.button)}
        {shown >= 2 && (shown > 2 || more.length > 0) ? <span aria-hidden="true" className="ml-selbar-sep" /> : null}
        {visible.slice(2).map((action) => action.button)}
        {more.length === 0 ? null : (
          <Menu
            align="end"
            label={tr('list.more_actions')}
            backLabel={tr('common.back')}
            items={more.map((action) => action.item)}
            trigger={iconTrigger(tr('list.more_actions'), <MoreHorizontal {...ICON} />, 'more')}
          />
        )}
      </div>
      <IconButton label={tr('list.clear_selection')} size="sm" className="ml-selbar-clear" onClick={onClear}>
        <X {...ICON} />
      </IconButton>
    </Toolbar>
  );
}

/** One row of the phone's More sheet. */
interface SheetRow {
  id: string;
  label: string;
  icon: React.ReactNode;
  run: () => void;
  /** A note at the row's end in the secondary colour (a snooze time's day and hour). */
  hint?: string;
}

/** The lists of the phone's More sheet: its actions, and the lists an action opens in the same sheet. */
type SheetView = 'closed' | 'actions' | SelectionMenuView;

interface PhoneBarProps {
  counted: string;
  count: number;
  /** Archive and Move to Trash (Move to Inbox and Delete forever in Trash and Spam): buttons while there is room, else rows of the sheet. */
  firsts: readonly SimpleAction[];
  asButton: (action: SimpleAction) => React.ReactNode;
  onClear: () => void;
  onToggleAll: () => void;
  state: PageState;
  /** Snooze is offered (its row shows the desktop's choices in the same sheet). */
  snoozable: boolean;
  anyUnread: boolean;
  anyUnstarred: boolean;
  labels: readonly string[];
  targets: readonly string[];
  actions: SelectionActions;
  menuRequest?: SelectionMenuRequest | null;
  onMenuRequestDone?: () => void;
}

/** The parts of the phone's bar that always show (Close, More; More is last: its width is a button's). */
const PHONE_FIXED = '.ml-selbar-close, .ml-selbar-more';
/** The rows of the More sheet that open another list in its place (a chevron at their end). */
const OPENS_LIST = new Set(['snooze', 'move', 'label']);
/** Archive and Move to Trash between the count and More: each takes a button and a gap (`room` already counts one gap too many). */
const phoneFit = (room: number, button: number, gap: number): number => Math.max(0, Math.min(2, Math.floor((room + gap) / (button + gap))));

/**
 * The phone's selection bar (in place of the app bar) and its More sheet: every action of the desktop bar, within thumb reach. Snooze, Move
 * to folder and Add label open their list IN the same sheet (J2-22: one surface, never a second sheet sliding through the first), with Back
 * at the top; Snooze's list is the desktop's: the quick times with their day and hour, then a picked date and time with Snooze in the
 * footer. Focus goes to the first row of a list that opens (J1-23).
 */
function PhoneBar({
  counted,
  count,
  firsts,
  asButton,
  onClear,
  onToggleAll,
  state,
  snoozable,
  anyUnread,
  anyUnstarred,
  labels,
  targets,
  actions,
  menuRequest,
  onMenuRequestDone
}: PhoneBarProps) {
  const tr = useT();
  const [sheet, setSheet] = React.useState<SheetView>('closed');
  /** When the Snooze list was opened: its quick times and the limits of a picked time are measured from then. */
  const [snoozeFrom, setSnoozeFrom] = React.useState<Date>(() => new Date());
  const [picking, setPicking] = React.useState(false);
  const [pick, setPick] = React.useState('');
  const [problem, setProblem] = React.useState<string | null>(null);
  const pickId = React.useId();
  const formId = `${pickId}-form`;
  const moreRef = React.useRef<HTMLButtonElement | null>(null);
  const listRef = React.useRef<HTMLUListElement | null>(null);
  const { countRef, shown } = useFit(firsts.length, PHONE_FIXED, phoneFit, counted);
  // The bar floats at the bottom of the phone's list (App's dock), above the safe area; its copy fades out there when the selection ends.
  useLeaveInPlace(countRef, '.ml-dock-anchor');
  const close = () => setSheet('closed');
  const open = (view: SheetView) => {
    if (view === 'snooze') {
      const now = new Date();
      setSnoozeFrom(now);
      setPick(toLocalInputValue(tomorrowMorning(now)));
      setPicking(false);
      setProblem(null);
    }
    setSheet(view);
  };
  const run = (action: () => void) => () => {
    close();
    action();
  };
  // b, l, v on a phone with a keyboard: the sheet opens on that list (when the folder has it).
  useMenuRequest(
    menuRequest,
    (view) => {
      if ((view === 'snooze' && !snoozable) || (view === 'label' && labels.length === 0)) {
        return;
      }
      open(view);
    },
    onMenuRequestDone
  );
  // A list that opens in the sheet (or the actions, back from one) puts focus on its first row, or on the row that opened the list left.
  const shownView = React.useRef<SheetView>('closed');
  React.useEffect(() => {
    const before = shownView.current;
    shownView.current = sheet;
    if (sheet === 'closed' || before === 'closed') {
      return;
    }
    const list = listRef.current;
    const back = sheet === 'actions' ? list?.querySelector<HTMLElement>(`[data-opens="${CSS.escape(before)}"]`) : null;
    // In a list, its first choice (not the Back row above it), as the row menu's sheet does (J1-23).
    (back ?? list?.querySelector<HTMLElement>('li:not([data-back]) .ml-menu-item'))?.focus({ preventScroll: true });
  }, [sheet]);
  React.useEffect(() => {
    if (picking) {
      document.querySelector<HTMLElement>(`#${CSS.escape(pickId)}`)?.focus();
    }
  }, [picking, pickId]);
  const submitPick = (event: React.SyntheticEvent) => {
    event.preventDefault();
    const at = parseLocalInput(pick);
    const message = snoozeProblem(at, new Date());
    setProblem(message);
    if (message === null && at !== null) {
      close();
      actions.snooze(at);
    }
  };

  const backRow: SheetRow = { id: 'back', label: tr('common.back'), icon: <ChevronLeft {...SHEET_ICON} />, run: () => open('actions') };
  let rows: SheetRow[];
  let title = counted;
  switch (sheet) {
    case 'move': {
      title = tr('action.move_to_folder');
      rows = targets.map((target) => ({
        id: target,
        label: folderName(target),
        icon: <FolderIcon folder={target} {...SHEET_ICON} />,
        run: run(() => actions.move(target))
      }));
      break;
    }
    case 'label': {
      title = tr('reader.add_label');
      rows = labels.map((label) => ({ id: label, label, icon: <Tag {...SHEET_ICON} />, run: run(() => actions.label(label)) }));
      break;
    }
    case 'snooze': {
      title = tr('snooze.menu_label');
      rows = snoozePresets(snoozeFrom).map((preset) => ({
        id: preset.id,
        label: preset.label,
        hint: preset.hint,
        icon: <Clock {...SHEET_ICON} />,
        run: run(() => actions.snooze(preset.at))
      }));
      break;
    }
    case 'actions':
    case 'closed': {
      rows = [
        // Archive and Move to Trash come here when the count takes their room (320px, Vietnamese).
        ...firsts.slice(shown).map((action) => ({ ...action, run: run(action.run) })),
        // Snooze's choices in this same sheet (the desktop's: the quick times and a picked date and time).
        ...(snoozable ? [{ id: 'snooze', label: tr('action.snooze'), icon: <Clock {...SHEET_ICON} />, run: () => open('snooze') }] : []),
        anyUnread
          ? { id: 'read', label: tr('action.mark_read'), icon: <MailOpen {...SHEET_ICON} />, run: run(actions.read) }
          : { id: 'unread', label: tr('action.mark_unread'), icon: <Mail {...SHEET_ICON} />, run: run(actions.unread) },
        anyUnstarred
          ? { id: 'star', label: tr('action.star'), icon: <Star {...SHEET_ICON} />, run: run(actions.star) }
          : { id: 'unstar', label: tr('action.unstar'), icon: <Star {...SHEET_ICON} fill="currentColor" />, run: run(actions.unstar) },
        { id: 'move', label: tr('action.move_to_folder'), icon: <FolderInput {...SHEET_ICON} />, run: () => open('move') },
        ...(labels.length === 0
          ? []
          : [{ id: 'label', label: tr('reader.add_label'), icon: <Tag {...SHEET_ICON} />, run: () => open('label') }]),
        // What changes the selection itself comes last, apart from what acts on it (as Select in the row menu).
        {
          id: 'all',
          label: state === 'all' ? tr('list.clear_selection') : tr('list.select_all'),
          icon: state === 'all' ? <X {...SHEET_ICON} /> : <CheckSquare {...SHEET_ICON} />,
          run: run(onToggleAll)
        }
      ];
    }
  }
  const inList = sheet !== 'actions' && sheet !== 'closed';
  const row = (item: SheetRow, extra?: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button
      type="button"
      className="ml-menu-item"
      data-opens={sheet === 'actions' && OPENS_LIST.has(item.id) ? item.id : undefined}
      onClick={item.run}
      {...extra}
    >
      {item.icon}
      <span className="ml-menu-label">{item.label}</span>
      {item.hint === undefined ? null : <span className="ml-menu-hint">{item.hint}</span>}
      {sheet === 'actions' && OPENS_LIST.has(item.id) ? <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" /> : null}
    </button>
  );
  return (
    <div className="ml-selbar-phone">
      <IconButton label={tr('list.clear_selection')} className="ml-selbar-close" onClick={onClear}>
        <X {...SHEET_ICON} />
      </IconButton>
      <p
        ref={(node) => {
          countRef.current = node;
        }}
        className="ml-selbar-count"
      >
        <RollingText text={counted} count={count} />
      </p>
      {firsts.slice(0, shown).map((action) => asButton(action))}
      <IconButton
        ref={moreRef}
        label={tr('list.more_actions')}
        className="ml-selbar-more"
        aria-haspopup="dialog"
        onClick={() => open('actions')}
      >
        <MoreHorizontal {...SHEET_ICON} />
      </IconButton>
      {sheet === 'closed' ? null : (
        <Dialog
          open
          onClose={close}
          title={title}
          size="sm"
          className="ml-menu"
          returnFocusRef={moreRef}
          footer={
            sheet === 'snooze' && picking ? (
              <Button type="submit" form={formId} variant="primary" fullWidth>
                {tr('action.snooze')}
              </Button>
            ) : undefined
          }
        >
          <ul ref={listRef} className="ml-menu-list" key={sheet}>
            {/* A list opened from the actions starts with the way back to them (the sheet's title says which list it is). */}
            {inList ? <li data-back="true">{row(backRow)}</li> : null}
            {rows.map((item, index) => (
              <li key={item.id} data-separated={(inList && index === 0) || item.id === 'all' ? 'true' : undefined}>
                {row(item)}
              </li>
            ))}
            {sheet === 'snooze' ? (
              <li data-separated="true">
                {row(
                  { id: 'pick', label: tr('snooze.pick_date_time'), icon: <CalendarClock {...SHEET_ICON} />, run: () => setPicking(true) },
                  { 'aria-expanded': picking }
                )}
              </li>
            ) : null}
          </ul>
          {sheet === 'snooze' && picking ? (
            <form id={formId} noValidate onSubmit={submitPick} className="ml-selbar-pick">
              {/* The app's own date and time picker (DESIGN-v3 H9): the same value string as the browser's field gave. */}
              <DateTimePicker
                id={pickId}
                aria-label={tr('snooze.date_time_label')}
                value={pick}
                min={toLocalInputValue(new Date(snoozeFrom.getTime() + MIN_SNOOZE_MS))}
                max={toLocalInputValue(new Date(snoozeFrom.getTime() + MAX_SNOOZE_MS))}
                aria-invalid={problem !== null}
                aria-describedby={problem === null ? undefined : `${pickId}-problem`}
                onChange={(value) => {
                  setPick(value);
                  setProblem(null);
                }}
              />
              {problem === null ? null : (
                <p id={`${pickId}-problem`} role="alert" className="ml-snooze-problem">
                  <CircleAlert size={14} strokeWidth={1.75} aria-hidden="true" />
                  <span>{problem}</span>
                </p>
              )}
            </form>
          ) : null}
        </Dialog>
      )}
    </div>
  );
}

/** Where "Select all in Inbox" stands (J6-39): offered, loading the other pages, or done (every one, or the most recent up to the cap). */
export type SelectAllPhase = 'offer' | 'loading' | 'all' | 'capped';

interface SelectAllLineProps {
  phase: SelectAllPhase;
  /** Offer and loading: the rows of the page (all ticked); all and capped: how many are ticked. */
  count: number;
  /** The folder's name ("Inbox"), or null in a search ("Select all results"). */
  folder: string | null;
  onSelectAll: () => void;
  /** Done: the way out of the whole selection, in the same line (Gmail's Clear selection). */
  onClear?: () => void;
}

/**
 * The line under the selection bar once every row of the page is ticked and the folder (or the search) has more pages (J6-39, Gmail's
 * pattern): "All 50 on this page are selected." and "Select all in Inbox", which loads the other pages (up to the 500 most recent) and ticks
 * them; then it says what is ticked.
 */
export function SelectAllLine({ phase, count, folder, onSelectAll, onClear }: SelectAllLineProps): React.ReactElement {
  const tr = useT();
  if (phase === 'all' || phase === 'capped') {
    return (
      <p className="ml-selall">
        <span>
          {phase === 'capped'
            ? tr('list.all_selected_capped', { count })
            : folder === null
              ? tr('list.all_results_selected', { count })
              : tr('list.all_in_selected', { count, folder })}
        </span>{' '}
        {onClear === undefined ? null : (
          <Button variant="ghost" size="sm" className="ml-selall-btn" onClick={onClear}>
            {tr('list.clear_selection')}
          </Button>
        )}
      </p>
    );
  }
  return (
    <p className="ml-selall">
      <span>{tr('list.page_all_selected', { count })}</span>{' '}
      <Button
        variant="ghost"
        size="sm"
        className="ml-selall-btn"
        loading={phase === 'loading'}
        onClick={phase === 'loading' ? undefined : onSelectAll}
      >
        {phase === 'loading'
          ? tr('list.selecting_all')
          : folder === null
            ? tr('list.select_all_results')
            : tr('list.select_all_in', { folder })}
      </Button>
    </p>
  );
}
