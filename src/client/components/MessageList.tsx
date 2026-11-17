import React from 'react';
import {
  Archive,
  ArrowUp,
  Check,
  CheckCheck,
  FolderOpen,
  Inbox,
  Mail,
  MailOpen,
  MailX,
  Paperclip,
  RefreshCw,
  Star,
  Trash2
} from 'lucide-react';
import type { Message } from '../types';
import type { ThemeTokens } from '../theme';
import { avatarHue as personHue, getLabelChip } from '../theme';
import {
  GROUP_ORDER,
  displayName,
  folderName,
  formatRowTime,
  groupOf,
  labelsOf,
  nonEmpty,
  searchSnippetOf,
  snippetOf,
  subjectOf
} from '../lib/mail';
import { extendSelection, selectRange, toggleOne } from '../lib/selection';
import { landRow, returnRow } from '../lib/shellMotion';
import { SNOOZE_GROUP_ORDER, snoozeGroupOf } from '../lib/snooze';
import { fmt, useT, type TFunction } from '../lib/i18n';
import {
  Avatar,
  Button,
  Checkbox,
  Chip,
  EmptyState,
  FlightTrail,
  IconButton,
  ListSkeleton,
  Odometer,
  SegmentedControl,
  VisuallyHidden,
  durationFor,
  enterRow,
  leaveRow,
  motionReduced,
  useGlide
} from '../ui';
import { segmentTarget } from '../ui/SegmentedControl';
import { RowMenu, type RowMenuAnchor, type RowMenuView } from './RowMenu';
import { SnoozeChip, SnoozeMenu } from './SnoozeMenu';
import './messagelist.css';

export type MailFilter = 'all' | 'unread' | 'starred' | 'attachments';

/** Where a search looks: the open folder, or all mail (every folder but Spam and Trash; each row says its folder). */
export type SearchScope = 'folder' | 'all';

/** What the quick actions of a desktop row do (they show on hover and keyboard focus, in place of the time), and the row menu of any row. */
export interface RowActions {
  archive: (message: Message) => void;
  trash: (message: Message) => void;
  /** Trash and Spam: back to the Inbox. */
  restore: (message: Message) => void;
  /** Trash and Spam: asks first (the confirmation is the caller's). */
  deleteForever: (message: Message) => void;
  /** Mark as read, or as unread, whichever the row is not. */
  toggleRead: (message: Message) => void;
  snooze: (message: Message, until: Date) => void;
  unsnooze: (message: Message) => void;
  /** The row menu's Move to folder (J6-34). */
  move?: (message: Message, folder: string) => void;
  /** The row menu's Add label: adds the label, or takes it off when the message has it. */
  label?: (message: Message, label: string) => void;
  /** The row menu's Reply and Forward: they open the message and answer it (its text is quoted). */
  reply?: (message: Message) => void;
  /** The row menu's Reply all (J6-40): answers everyone on the message, as the reader's Reply all does. */
  replyAll?: (message: Message) => void;
  forward?: (message: Message) => void;
  /** The row menu's Select / Deselect (a phone's long press is how a selection starts there). */
  select?: (message: Message) => void;
}

/** The row menu that b (Snooze) or l (Add label) asks for: the menu of row `id`, opened on that list. `at` tells two requests apart. */
export interface RowMenuRequest {
  id: string;
  view: RowMenuView;
  at: number;
}

interface MessageListProps {
  t: ThemeTokens;
  messages: Message[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleStar: (message: Message) => void;
  /** Mobile only: when set, rows can be swiped left to archive. */
  onSwipeArchive?: (message: Message) => void;
  /** Mobile only: when set, rows can be swiped right to move them to Trash. */
  onSwipeTrash?: (message: Message) => void;
  /** What a row offers: the quick actions of a desktop row (hover, keyboard focus) and the row menu (long press, Shift+F10). */
  rowActions?: RowActions;
  /** How a row that leaves the list goes: it slides away (archive, trash, snooze ...) or only fades (deleted forever). Default: slide. */
  leaveStyle?: (id: string) => 'slide' | 'fade';
  title: string;
  /** The folder behind `messages` ('inbox', 'spam', 'label:Work' ...): picks the filters, the empty-state hint and the Trash line. */
  folder: string;
  subtitle: string;
  /** The number inside `subtitle` ("3 unread"): it rolls when it changes (DESIGN-v3 H2). */
  subtitleCount?: number;
  filter: MailFilter;
  onFilterChange: (filter: MailFilter) => void;
  onMarkAllRead: () => void;
  /** False when nothing in the view is unread: Mark all as read is not offered then. Default: true. */
  canMarkAllRead?: boolean;
  onRefresh: () => void;
  isLoading: boolean;
  /** Search text behind `messages` (trimmed). A search turns the head into the results head. */
  searchQuery?: string;
  /** A search that found nothing offers to clear it; the results head has the same button. */
  onClearSearch?: () => void;
  /** Where the search looks, and the switch between the open folder and all mail. */
  scope?: SearchScope;
  onScopeChange?: (scope: SearchScope) => void;
  /** The count of a search in words ("4 results in Inbox"): the visible count, the same words the live region says. */
  resultsText?: string;
  /** Trash and Spam: deletes everything in the folder for good (the caller asks first). Offered while the folder has mail. */
  onEmptyFolder?: () => void;
  /** The search field: under the title in the sheet's head on a desktop; on a phone it stays under the app bar while the list scrolls. */
  searchSlot?: React.ReactNode;
  /** A phone: the account notices and the locked-mail banner, the top of the scroller (they scroll away with the filters). */
  notices?: React.ReactNode;
  /** The Drafts folder: rows name the recipients instead of the sender and are dated by their last save. */
  isDrafts?: boolean;
  /** The Snoozed folder: rows are grouped by the day they come back, in the server's soonest-first order. */
  isSnoozed?: boolean;
  compact?: boolean;
  /** Mobile: the owner keeps the scroll offset here so it survives the list unmounting. */
  scrollMemory?: React.RefObject<number>;
  /** Older mail than the loaded rows exists on the server: a "Load more" button ends the list. */
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  /** The load failed: with no rows, the list says so and offers `onRetry`, never the empty-folder copy. */
  loadFailed?: boolean;
  onRetry?: () => void;
  /**
   * The ticked rows (multi-select, J6-26) and how to change them. Without `onSelectionChange` the list has no selection (Drafts). A desktop
   * row shows its box in place of the avatar on hover and focus, and on every row while something is ticked; a phone shows the boxes only
   * while something is ticked, and a tap then ticks instead of opening.
   */
  selection?: ReadonlySet<string>;
  onSelectionChange?: (next: Set<string>) => void;
  /** Desktop: the selection bar, floating at the bottom of the list sheet while something is ticked (DESIGN-v3 4.1). */
  selectionBar?: React.ReactNode;
  /** The line under the selection bar (J6-39: every row of the page is ticked: Select all in the folder), under the head or the phone's tools. */
  selectionNote?: React.ReactNode;
  /** Every label the person has: the row menu's Add label. */
  labels?: readonly string[];
  /** The b and l keys: open this row's menu on the snooze times or the labels. */
  menuRequest?: RowMenuRequest | null;
}

/** No row is ticked. */
const NOTHING: ReadonlySet<string> = new Set();
/** No labels (yet). */
const NO_LABELS: readonly string[] = [];

/**
 * The filters the folder allows, in the same order on a desktop and a phone: All, Unread (not in Sent: nothing there is unread), Starred (not
 * in Starred itself), Attachments. Drafts have none.
 */
function filterOptions(folder: string, tr: TFunction): { value: MailFilter; label: string }[] {
  return [
    { value: 'all' as const, label: tr('list.filter_all') },
    ...(folder === 'sent' ? [] : [{ value: 'unread' as const, label: tr('list.filter_unread') }]),
    ...(folder === 'starred' ? [] : [{ value: 'starred' as const, label: tr('folder.starred') }]),
    { value: 'attachments' as const, label: tr('term.attachments') }
  ];
}

/** The shortest drag (px) that arms a swipe; also the width of the label behind the row. A wide row needs 35% of its width (M2). */
const SWIPE_REVEAL = 96;
/** A flick this fast (px per ms) in the direction of the drag commits it even before the threshold (M2). */
const SWIPE_FLING = 0.6;
/** The shortest settle of a released swipe (ms): a very fast flick still shows the row leaving. */
const SWIPE_SETTLE_MIN = 90;
/** How long a finger rests on a phone row before its menu opens (ms), and how far it may drift meanwhile (px). */
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP = 10;
/** At most this many rows leave or arrive one by one with their own motion; more at once (a bulk change) just change. */
const ROW_MOTION_MAX = 3;

/**
 * A touch long press on a desktop row (a touch tablet: no hover, no swipe, and iPadOS fires no contextmenu): the row's menu opens after the
 * same rest as a phone row's (J5-24), and the click the press ends with does not open the mail. A mouse never starts it. One instance serves
 * the whole list (one finger at a time); the handlers go on each row's cell.
 */
function useRowLongPress(open: (item: HTMLElement) => void) {
  const timer = React.useRef<number | undefined>(undefined);
  const start = React.useRef({ x: 0, y: 0 });
  const fired = React.useRef(false);
  const cancel = () => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  return {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      fired.current = false;
      const item = event.currentTarget.closest('li');
      if (event.pointerType === 'mouse' || item === null) {
        return;
      }
      start.current = { x: event.clientX, y: event.clientY };
      cancel();
      const cell = event.currentTarget;
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        fired.current = true;
        // The finger is still down: the mouse events a browser makes of the lift must not land on the sheet's scrim (as CompactRow).
        const lift = new AbortController();
        cell.addEventListener(
          'touchend',
          (end) => {
            end.preventDefault();
            lift.abort();
          },
          { signal: lift.signal }
        );
        cell.addEventListener('touchcancel', () => lift.abort(), { signal: lift.signal });
        open(item);
      }, LONG_PRESS_MS);
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      if (timer.current !== undefined && Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > LONG_PRESS_SLOP) {
        cancel();
      }
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture: (event: React.MouseEvent<HTMLElement>) => {
      if (fired.current) {
        event.preventDefault();
        event.stopPropagation();
        fired.current = false;
      }
    }
  };
}

/**
 * A tap on a phone row's avatar (J6-41, as Gmail and Outlook): it ticks the row, which starts a selection, instead of opening the mail. The
 * avatar's area counts 6px past its edges (a 44px target round the 32px face).
 */
function onAvatar(event: React.MouseEvent<HTMLElement>): boolean {
  const face = event.currentTarget.querySelector('.ml-avatar, .ml-pick');
  if (face === null || event.detail === 0) {
    // Enter or Space on the row (detail 0) is never a tap on the avatar.
    return false;
  }
  const box = face.getBoundingClientRect();
  return event.clientX >= box.left - 6 && event.clientX <= box.right + 6 && event.clientY >= box.top - 6 && event.clientY <= box.bottom + 6;
}
/** The quick-action buttons inherit the toolbar's look from the stylesheet. */
const NO_STYLE: React.CSSProperties = {};

/**
 * The settle of a released swipe (M2, J2-09): the row goes on at the speed the finger let it go and slows to a stop at the edge. A constant
 * deceleration from speed v covers the rest d in 2d / v, with a curve whose first slope is 2 (an ease-out quad); the time is held between
 * 90 ms and the exit rule (0.7 of the distance rule), and the first control point keeps the start speed when it is held.
 */
function swipeSettle(rest: number, speed: number): { ms: number; curve: string } {
  const longest = Math.round(durationFor(rest) * 0.7);
  if (speed <= 0 || rest <= 0) {
    // No speed to keep: the stylesheet's curve (messagelist.css .ml-swipe-pane).
    return { ms: longest, curve: '' };
  }
  const ms = Math.round(Math.min(longest, Math.max(SWIPE_SETTLE_MIN, (2 * rest) / speed)));
  const slope = (speed * ms) / rest;
  const x1 = Math.min(1 / 3, 1 / slope);
  return { ms, curve: `cubic-bezier(${x1.toFixed(3)}, ${Math.min(1, x1 * slope).toFixed(3)}, 0.667, 1)` };
}

/** What an empty folder says it holds; the Inbox's wording is the default (Drafts and Snoozed have their own lines below). */
function emptyHint(folder: string, tr: TFunction): string {
  if (folder.startsWith('label:')) {
    return tr('list.hint_label');
  }
  if (folder === 'spam') {
    return tr('list.hint_spam');
  }
  if (folder === 'trash') {
    return tr('list.hint_trash');
  }
  if (folder === 'archive') {
    return tr('list.hint_archive');
  }
  if (folder === 'sent') {
    return tr('list.hint_sent');
  }
  if (folder === 'starred') {
    return tr('list.hint_starred');
  }
  return tr('list.hint_inbox');
}

/**
 * The heading of a group of rows. The ids come from lib/mail.ts (the day groups of every folder) and lib/snooze.ts (the
 * Snoozed folder); an id nobody knows is shown as it is.
 */
function groupHeading(id: string, tr: TFunction): string {
  if (id === 'Today' || id === 'today') {
    return tr('list.group_today');
  }
  if (id === 'Yesterday') {
    return tr('list.group_yesterday');
  }
  if (id === 'This week') {
    return tr('list.group_this_week');
  }
  if (id === 'Earlier') {
    return tr('list.group_earlier');
  }
  if (id === 'tomorrow') {
    return tr('list.group_tomorrow');
  }
  if (id === 'next-7-days') {
    return tr('list.group_next_7_days');
  }
  if (id === 'later') {
    return tr('list.group_later');
  }
  return id;
}

/** How a row names the other side: the sender, or in Drafts the recipients (a "No recipient" text when none is set yet). */
function partyLabel(m: Message, isDrafts: boolean, tr: TFunction): string {
  if (!isDrafts) {
    return displayName(m);
  }
  const recipients = nonEmpty(m.to_address.trim());
  return recipients === undefined ? tr('list.no_recipient') : tr('list.draft_to', { recipients });
}

/** Whose initials the avatar shows: the sender, or in Drafts the first recipient (none yet: a question mark). */
function avatarName(m: Message, isDrafts: boolean): string {
  return isDrafts ? (m.to_address.split(',', 1)[0] ?? '').trim() : displayName(m);
}

const fold = (text: string): string => text.toLocaleLowerCase();

/** True when `text` holds the search (the same case-insensitive match the search makes). */
function holds(text: string, query: string): boolean {
  return query !== '' && fold(text).includes(fold(query));
}

/**
 * `text` with every match of the search marked (`<mark>`): bold in the row, so a person sees why it was found. Where lower-casing changes
 * the length of the text (a few scripts), nothing is marked rather than the wrong letters.
 */
function marked(text: string, query: string): React.ReactNode {
  const needle = fold(query);
  const haystack = fold(text);
  if (needle === '' || haystack.length !== text.length || !haystack.includes(needle)) {
    return text;
  }
  const parts: React.ReactNode[] = [];
  let from = 0;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + needle.length)) {
    if (at > from) {
      parts.push(text.slice(from, at));
    }
    parts.push(
      <mark key={at} className="ml-hit">
        {text.slice(at, at + needle.length)}
      </mark>
    );
    from = at + needle.length;
  }
  parts.push(text.slice(from));
  return parts;
}

/**
 * Why a row was found when its visible words do not show it: the search matched an address (the server matches the sender's and the
 * recipients' addresses). The line names that address with the match marked, in place of the preview.
 */
function matchHint(m: Message, query: string, shown: string[], tr: TFunction): string | null {
  if (query === '' || shown.some((text) => holds(text, query))) {
    return null;
  }
  if (holds(m.from_address, query)) {
    return tr('list.match_from', { address: m.from_address });
  }
  const to = [m.to_address, m.cc ?? ''].join(', ');
  const address = to
    .split(/[,;]+/)
    .map((part) => part.trim())
    .find((part) => holds(part, query));
  return address === undefined ? null : tr('list.match_to', { address });
}

/**
 * A short text with a number in it ("3 unread", "2 selected") whose number rolls when it changes (DESIGN-v3 H2, ui/Odometer): the words stay,
 * the digits move. The whole text is read as one (Odometer says its value once); without a number in the text it is the plain text.
 */
export function RollingText({ text, count }: { text: string; count: number | undefined }): React.ReactElement {
  const digits = count === undefined ? '' : String(count);
  const at = digits === '' ? -1 : text.indexOf(digits);
  if (count === undefined || at === -1) {
    return <>{text}</>;
  }
  return (
    <>
      {text.slice(0, at)}
      <Odometer value={count} format={(value) => fmt.number(value)} />
      {text.slice(at + digits.length)}
    </>
  );
}

/**
 * A row shows at most this many labels (a quiet dot and name, lead review 4: chips cut the preview and added colour); the rest are said by a
 * quiet "+N" (and in full to screen readers); the reader shows them all.
 */
const ROW_LABELS_MAX = 1;

interface RowButtonProps {
  t: ThemeTokens;
  message: Message;
  sender: string;
  /** The name the avatar's initials come from. */
  avatar: string;
  /** Whose hue the avatar wears (the sender's address: one tint per person, DESIGN-v3 2). */
  avatarHue: string;
  subject: string;
  /** The row's time, already in words. */
  time: string;
  /** Wake time of a snoozed mail: shown in place of the date on the phone board, because that is what matters in the Snoozed folder. */
  snoozedUntil: number | null;
  preview: string;
  labels: string[];
  unread: boolean;
  selected: boolean;
  /** The row is ticked (multi-select): its name starts with "Selected". */
  checked: boolean;
  /**
   * A phone's selection mode: the avatar becomes a round tick (filled when ticked) and the row is a toggle button (a tap ticks it).
   * Undefined: not selecting.
   */
  pick?: boolean;
  /** The phone board: no label chips, and a snoozed row shows its wake time where the date is. */
  compact: boolean;
  /** The search, marked in the sender, the subject and the preview. */
  query: string;
  /** All mail results: the folder the row is in, as a quiet chip. */
  folderChip: string | null;
  /** The list's one Tab stop (roving tabindex): 0 on that row, -1 on every other. */
  tabIndex: 0 | -1;
  onFocus: () => void;
  onSelect: (id: string) => void;
  /** A phone: a tap on the avatar ticks the row (J6-41) instead of `onSelect`. */
  onPick?: (id: string) => void;
  /**
   * Opens the row's menu: Shift+F10 or the context-menu key on the focused row, a right click (with the pointer's place), a touch browser's
   * own long press. On the button (a control), so the keys reach it wherever the row has focus.
   */
  onMenu?: (item: HTMLElement, point?: { x: number; y: number }) => void;
}

/**
 * The button of one row: the unread dot, the sender's initials, then three lines: the sender and the time, the subject (and a paperclip),
 * the preview with the chips (labels, snooze time, the folder of a search result). The star and the quick actions are separate buttons
 * beside it (a button cannot hold a button), see StarButton and QuickActions. Under the compact density (the device preference) the avatar
 * goes and the subject and the preview share the second line (messagelist.css).
 *
 * Its accessible name is the row's summary, not all of its text (J1-20): its state (unread, selected), the sender, the time, the subject
 * and the meta (the paperclip's name, the chips: the folder of a result, the labels), from its content in the order it is seen (so the
 * name holds the visible words, 2.5.3); the preview is left out of the name (aria-hidden) and is the button's description instead.
 */
const RowButton: React.FC<RowButtonProps> = ({
  t,
  message: m,
  sender,
  avatar,
  avatarHue,
  subject,
  time,
  snoozedUntil,
  preview,
  labels,
  unread,
  selected,
  checked,
  pick,
  compact,
  query,
  folderChip,
  tabIndex,
  onFocus,
  onSelect,
  onPick,
  onMenu
}) => {
  const tr = useT();
  const uid = React.useId();
  // A phone row has room for one chip only: the folder of an All mail result (its snooze time is in the time slot, it shows no labels).
  const chips = folderChip !== null || (!compact && (labels.length > 0 || snoozedUntil !== null));
  const shown = [sender, subject, preview];
  const hint =
    matchHint(m, query, shown, tr) ?? (query !== '' && !shown.some((text) => holds(text, query)) ? tr('list.match_hidden') : null);
  const state = [unread ? tr('list.unread_sr') : '', checked ? tr('list.selected_sr') : ''].filter((part) => part !== '').join(' ');
  const described = hint !== null || preview !== '';
  return (
    <button
      type="button"
      className="ml-row"
      data-unread={unread ? 'true' : undefined}
      aria-current={selected ? 'true' : undefined}
      aria-pressed={pick}
      aria-describedby={described ? `${uid}-preview` : undefined}
      tabIndex={tabIndex}
      onFocus={onFocus}
      onClick={(event) => {
        if (onPick !== undefined && onAvatar(event)) {
          onPick(m.id);
          return;
        }
        onSelect(m.id);
      }}
      onContextMenu={(event) => {
        const item = event.currentTarget.closest('li');
        if (onMenu !== undefined && item !== null) {
          event.preventDefault();
          // A right click names the pointer's place; the context-menu key (no pointer) fires it at 0,0 or at the element.
          onMenu(item, event.clientX === 0 && event.clientY === 0 ? undefined : { x: event.clientX, y: event.clientY });
        }
      }}
    >
      <span aria-hidden="true" className="ml-dot" />
      {pick === undefined ? (
        <Avatar name={avatar} hue={personHue(avatarHue)} shape="stamp" size={compact ? 'lg' : 'md'} className="ml-avatar" />
      ) : (
        <span aria-hidden="true" className="ml-pick" data-checked={pick ? 'true' : undefined}>
          {pick ? <Check size={18} strokeWidth={2.25} /> : null}
        </span>
      )}
      <span className="ml-main">
        {state === '' ? null : <VisuallyHidden>{state}</VisuallyHidden>}
        <span className="ml-line">
          <span className="ml-sender">{marked(sender, query)}</span>
          {compact && snoozedUntil !== null ? (
            <span className="ml-time-slot">
              <SnoozeChip t={t} until={snoozedUntil} bare />
            </span>
          ) : (
            <span className="ml-time">{time}</span>
          )}
        </span>
        <span className="ml-line2">
          <span className="ml-subject">{marked(subject, query)}</span>
          {m.has_attachments === 1 ? (
            <Paperclip role="img" aria-label={tr('list.has_attachments')} size={14} strokeWidth={1.75} className="ml-clip" />
          ) : null}
        </span>
        {preview !== '' || chips || hint !== null ? (
          <span className="ml-line3">
            {hint === null ? (
              preview === '' ? null : (
                <span id={`${uid}-preview`} aria-hidden="true" className="ml-preview">
                  {marked(preview, query)}
                </span>
              )
            ) : (
              <span id={`${uid}-preview`} aria-hidden="true" className="ml-preview" data-match="true">
                {marked(hint, query)}
              </span>
            )}
            {chips ? (
              <span className="ml-chips">
                {folderChip === null ? null : (
                  <Chip icon={<FolderOpen size={12} strokeWidth={1.75} aria-hidden="true" />}>{folderChip}</Chip>
                )}
                {snoozedUntil === null || compact ? null : <SnoozeChip t={t} until={snoozedUntil} selected={selected} />}
                {labels.slice(0, ROW_LABELS_MAX).map((label) => (
                  <span key={label} className="ml-label">
                    {/* The label's hue is data: the only colour of the label is its dot. */}
                    <span aria-hidden="true" className="ml-label-dot" style={{ background: getLabelChip(label, t).dot }} />
                    <span className="ml-label-text">{label}</span>
                  </span>
                ))}
                {labels.length > ROW_LABELS_MAX ? (
                  <>
                    {/* The rest: a quiet count on screen, the names for a screen reader (the row's name keeps every label). */}
                    <span aria-hidden="true" className="ml-more-labels">
                      +{fmt.number(labels.length - ROW_LABELS_MAX)}
                    </span>
                    <VisuallyHidden>{labels.slice(ROW_LABELS_MAX).join(', ')}</VisuallyHidden>
                  </>
                ) : null}
              </span>
            ) : null}
          </span>
        ) : null}
      </span>
    </button>
  );
};

interface StarButtonProps {
  message: Message;
  sender: string;
  starred: boolean;
  onToggleStar: (message: Message) => void;
}

/**
 * The star of a row, on its subject line. Quiet (an outline) until the mail is starred; turning it on pops it once (M6). Not a Tab stop of
 * its own: the arrow keys reach it from its row (the list is one Tab stop).
 */
const StarButton: React.FC<StarButtonProps> = ({ message: m, sender, starred, onToggleStar }) => {
  const tr = useT();
  const [pop, setPop] = React.useState(false);
  return (
    <button
      type="button"
      className="ml-star"
      tabIndex={-1}
      aria-label={tr('list.star_from', { sender })}
      aria-pressed={starred}
      onClick={() => {
        setPop(!starred);
        onToggleStar(m);
      }}
    >
      <Star
        size={16}
        strokeWidth={1.75}
        fill={starred ? 'currentColor' : 'none'}
        aria-hidden="true"
        className={pop ? 'nm-anim-pop' : undefined}
        onAnimationEnd={() => setPop(false)}
      />
    </button>
  );
};

interface QuickActionsProps {
  t: ThemeTokens;
  message: Message;
  folder: string;
  unread: boolean;
  actions: RowActions;
  /** Called before an action that takes the row out of the list: focus goes to the next row at once (M1). */
  onLeave: () => void;
}

/**
 * The actions of a desktop row, shown on hover and while the row has keyboard focus, in the place of the time (messagelist.css): Archive,
 * Move to Trash, Mark as read/unread and Snooze, or in Trash and Spam Move to Inbox and Delete forever. Each one is labelled (name and
 * tooltip) and 28px. Drafts have none (a draft opens in the compose). None is a Tab stop: Right and Left reach them from the row.
 */
const QuickActions: React.FC<QuickActionsProps> = ({ t, message: m, folder, unread, actions, onLeave }) => {
  const tr = useT();
  const inTrash = folder === 'trash';
  const inSpam = folder === 'spam';
  const inBin = inTrash || inSpam;
  const canSnooze = folder !== 'sent' && !inBin;
  const leave = (run: (message: Message) => void) => () => {
    onLeave();
    run(m);
  };
  return (
    <div className="ml-quick">
      {inBin ? (
        <IconButton label={tr('action.move_to_inbox')} size="sm" tabIndex={-1} onClick={leave(actions.restore)}>
          <Inbox size={16} strokeWidth={1.75} aria-hidden="true" />
        </IconButton>
      ) : (
        <IconButton label={tr('action.archive')} size="sm" tabIndex={-1} onClick={leave(actions.archive)}>
          <Archive size={16} strokeWidth={1.75} aria-hidden="true" />
        </IconButton>
      )}
      {inTrash ? null : (
        <IconButton label={tr('action.move_to_trash')} size="sm" tabIndex={-1} onClick={leave(actions.trash)}>
          <Trash2 size={16} strokeWidth={1.75} aria-hidden="true" />
        </IconButton>
      )}
      {inBin ? (
        <IconButton label={tr('action.delete_forever')} size="sm" tabIndex={-1} onClick={() => actions.deleteForever(m)}>
          <MailX size={16} strokeWidth={1.75} aria-hidden="true" />
        </IconButton>
      ) : null}
      <IconButton
        label={unread ? tr('action.mark_read') : tr('action.mark_unread')}
        size="sm"
        tabIndex={-1}
        onClick={() => actions.toggleRead(m)}
      >
        {unread ? <MailOpen size={16} strokeWidth={1.75} aria-hidden="true" /> : <Mail size={16} strokeWidth={1.75} aria-hidden="true" />}
      </IconButton>
      {canSnooze ? (
        <SnoozeMenu
          t={t}
          buttonStyle={NO_STYLE}
          iconSize={16}
          snoozed={folder === 'snoozed'}
          onSnooze={(until) => {
            onLeave();
            actions.snooze(m, until);
          }}
          onUnsnooze={leave(actions.unsnooze)}
        />
      ) : null}
    </div>
  );
};

interface CompactRowProps {
  t: ThemeTokens;
  message: Message;
  sender: string;
  avatar: string;
  avatarHue: string;
  subject: string;
  time: string;
  /** Wake time of a snoozed mail: shown in place of the date, because that is what matters in the Snoozed folder. */
  snoozedUntil: number | null;
  preview: string;
  unread: boolean;
  starred: boolean;
  /** Ticked (multi-select). */
  checked: boolean;
  /** Something is ticked: a tap ticks this row instead of opening it, its avatar is the tick, and it does not swipe. */
  selecting: boolean;
  /** The row menu is open on this row: it keeps a tint so the menu's subject is seen. */
  menuOpen: boolean;
  query: string;
  folderChip: string | null;
  tabIndex: 0 | -1;
  onFocus: () => void;
  onSelect: (id: string) => void;
  /** A tap on the avatar ticks the row (J6-41): a selection starts without the long press. */
  onPick?: (id: string) => void;
  onToggleStar: (message: Message) => void;
  onSwipeArchive?: (message: Message) => void;
  onSwipeTrash?: (message: Message) => void;
  /** A long press (or the context-menu key): opens the row's menu. */
  onMenu?: (message: Message, item: HTMLElement, touch?: boolean) => void;
  itemRef: React.Ref<HTMLLIElement>;
}

/**
 * Mobile list row from the mobile board. Touch users swipe it left to archive it and right to move it to Trash (M2): the row follows the
 * finger, the action shows behind it (the accent for Archive, the danger colour for Trash), it arms at 96px or 35% of the row (the icon
 * grows), and letting go armed, or a flick, does it, the row going on at the speed it was let go; otherwise it slides back. Reduced motion
 * only drops the settle after the release. A long press opens the row's menu (the way to every action without a swipe).
 */
const CompactRow: React.FC<CompactRowProps> = ({
  t,
  message: m,
  sender,
  avatar,
  avatarHue,
  subject,
  time,
  snoozedUntil,
  preview,
  unread,
  starred,
  checked,
  selecting,
  menuOpen,
  query,
  folderChip,
  tabIndex,
  onFocus,
  onSelect,
  onPick,
  onToggleStar,
  onSwipeArchive: swipeArchive,
  onSwipeTrash: swipeTrash,
  onMenu,
  itemRef
}) => {
  // While a selection is made a sideways move is a scroll or nothing: the row's tap ticks it.
  const onSwipeArchive = selecting ? undefined : swipeArchive;
  const onSwipeTrash = selecting ? undefined : swipeTrash;
  const tr = useT();
  const [dx, setDx] = React.useState(0);
  const [armed, setArmed] = React.useState(false);
  const [settle, setSettle] = React.useState<{ ms: number; curve: string } | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const rowRef = React.useRef<HTMLDivElement | null>(null);
  // Handlers read this ref, not state: a quick flick can fire pointerup before React re-renders.
  const gesture = React.useRef({ startX: 0, startY: 0, tracking: false, active: false, dx: 0 });
  const last = React.useRef({ x: 0, at: 0, speed: 0 });
  const swiped = React.useRef(false);
  const press = React.useRef<number | undefined>(undefined);
  const swipeable = onSwipeArchive !== undefined || onSwipeTrash !== undefined;

  const width = (): number => rowRef.current?.offsetWidth ?? 390;
  const threshold = (): number => Math.max(SWIPE_REVEAL, width() * 0.35);
  const cancelPress = () => {
    window.clearTimeout(press.current);
    press.current = undefined;
  };

  const reset = () => {
    cancelPress();
    gesture.current.tracking = false;
    gesture.current.active = false;
    gesture.current.dx = 0;
    setDragging(false);
    setSettle(null);
    setArmed(false);
    setDx(0);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // A new press (any pointer) starts afresh: a long press that opened the menu left `swiped` set for the click it ended with.
    swiped.current = false;
    // Mouse users have the reader's buttons and the row's own actions; the gesture is touch/pen only.
    if (e.pointerType === 'mouse') {
      return;
    }
    // Where the finger went down, for the long press as well as the swipe (a move past the slop cancels the press).
    gesture.current = { startX: e.clientX, startY: e.clientY, tracking: swipeable, active: false, dx: 0 };
    last.current = { x: e.clientX, at: e.timeStamp, speed: 0 };
    const pane = e.currentTarget;
    const item = pane.closest('li');
    if (onMenu !== undefined && item !== null) {
      cancelPress();
      press.current = window.setTimeout(() => {
        press.current = undefined;
        // The finger is still down: the click it ends with must not open the mail.
        swiped.current = true;
        gesture.current.tracking = false;
        // Nor may the mouse events a browser makes of the lift land on the sheet's scrim (now under the finger) and take focus out of the menu.
        const lift = new AbortController();
        pane.addEventListener(
          'touchend',
          (end) => {
            end.preventDefault();
            lift.abort();
          },
          { signal: lift.signal }
        );
        pane.addEventListener('touchcancel', () => lift.abort(), { signal: lift.signal });
        onMenu(m, item, true);
      }, LONG_PRESS_MS);
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (press.current !== undefined && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > LONG_PRESS_SLOP) {
      cancelPress();
    }
    if (!g.tracking) {
      return;
    }
    const moveX = e.clientX - g.startX;
    if (!g.active) {
      // Wait for a clearly horizontal move so vertical scrolling is never hijacked.
      if (Math.abs(moveX) < 10 || Math.abs(moveX) < Math.abs(e.clientY - g.startY)) {
        return;
      }
      g.active = true;
      swiped.current = true;
      cancelPress();
      setDragging(true);
    }
    // Only toward an action the folder has; past 60% of the row the drag gives (a rubber band).
    const allowed = (moveX < 0 && onSwipeArchive !== undefined) || (moveX > 0 && onSwipeTrash !== undefined) ? moveX : 0;
    const limit = width() * 0.6;
    const pulled = Math.abs(allowed) > limit ? Math.sign(allowed) * (limit + (Math.abs(allowed) - limit) * 0.3) : allowed;
    const elapsed = Math.max(1, e.timeStamp - last.current.at);
    last.current = { x: e.clientX, at: e.timeStamp, speed: (e.clientX - last.current.x) / elapsed };
    g.dx = pulled;
    setDx(pulled);
    setArmed(Math.abs(pulled) >= threshold());
  };

  const onPointerUp = () => {
    cancelPress();
    const g = gesture.current;
    if (!g.active) {
      g.tracking = false;
      return;
    }
    const fling = Math.abs(last.current.speed) >= SWIPE_FLING && Math.sign(last.current.speed) === Math.sign(g.dx);
    if ((Math.abs(g.dx) >= threshold() || fling) && g.dx !== 0) {
      const toTrash = g.dx > 0;
      g.tracking = false;
      g.active = false;
      const rest = width() - Math.abs(g.dx);
      // The row leaves the rest of the way at the speed it was let go, slowing to the edge (swipeSettle); at once under reduced motion.
      const { ms, curve } = motionReduced() ? { ms: 0, curve: '' } : swipeSettle(rest, Math.abs(last.current.speed));
      setDragging(false);
      setSettle({ ms, curve });
      setDx(toTrash ? width() : -width());
      window.setTimeout(() => (toTrash ? onSwipeTrash?.(m) : onSwipeArchive?.(m)), ms);
    } else {
      reset();
    }
  };

  const revealed = dx !== 0;
  const action = dx > 0 ? 'trash' : 'archive';

  return (
    <li
      ref={itemRef}
      data-id={m.id}
      className="ml-item ml-swipe"
      data-checked={checked ? 'true' : undefined}
      data-menu-open={menuOpen ? 'true' : undefined}
      data-revealed={revealed ? 'true' : undefined}
      data-action={revealed ? action : undefined}
      data-armed={armed && revealed ? 'true' : undefined}
      // Only a starred row has a star (the phone has no room for an empty one); the subject makes room for it.
      data-star={starred ? 'true' : undefined}
    >
      {revealed ? (
        <span aria-hidden="true" className="ml-swipe-reveal" data-action={action} style={{ width: SWIPE_REVEAL }}>
          {action === 'trash' ? <Trash2 size={22} strokeWidth={1.75} /> : <Archive size={22} strokeWidth={1.75} />}
          {action === 'trash' ? tr('action.move_to_trash') : tr('action.archive')}
        </span>
      ) : null}
      <div
        ref={rowRef}
        className="ml-swipe-pane"
        data-swipeable={swipeable ? 'true' : undefined}
        data-dragging={dragging ? 'true' : undefined}
        data-revealed={revealed ? 'true' : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={reset}
        onClickCapture={(e) => {
          // A swipe (or a long press) that ends on the row must not also open the message.
          if (swiped.current) {
            e.preventDefault();
            e.stopPropagation();
            swiped.current = false;
          }
        }}
        style={
          dx === 0
            ? undefined
            : {
                transform: `translateX(${dx}px)`,
                transitionDuration: settle === null ? undefined : `${settle.ms}ms`,
                transitionTimingFunction: settle === null || settle.curve === '' ? undefined : settle.curve
              }
        }
      >
        <RowButton
          t={t}
          message={m}
          sender={sender}
          avatar={avatar}
          avatarHue={avatarHue}
          subject={subject}
          time={time}
          snoozedUntil={snoozedUntil}
          preview={preview}
          labels={[]}
          unread={unread}
          selected={false}
          checked={checked}
          pick={selecting ? checked : undefined}
          compact
          query={query}
          folderChip={folderChip}
          tabIndex={tabIndex}
          onFocus={onFocus}
          onSelect={onSelect}
          onPick={onPick}
          onMenu={onMenu === undefined ? undefined : (item) => onMenu(m, item)}
        />
        {starred ? <StarButton message={m} sender={sender} starred={starred} onToggleStar={onToggleStar} /> : null}
      </div>
    </li>
  );
};

interface FilterChipsProps {
  label: string;
  options: readonly { value: MailFilter; label: string }[];
  value: MailFilter;
  onChange: (value: MailFilter) => void;
}

/**
 * The phone's filters: one row of chips that scrolls sideways (never a grid), a radio group with one Tab stop where the arrows move and
 * choose (as the desktop's segmented control does). The edge that hides more chips fades out (messagelist.css `data-more`).
 */
const FilterChips: React.FC<FilterChipsProps> = ({ label, options, value, onChange }) => {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const chosen = options.findIndex((option) => option.value === value);
  const stop = Math.max(0, chosen);
  const rowRef = React.useCallback((row: HTMLDivElement | null) => {
    if (row === null) {
      return;
    }
    const measure = () => {
      const start = row.scrollLeft > 1;
      const end = row.scrollLeft + row.clientWidth < row.scrollWidth - 1;
      Object.assign(row.dataset, { more: start && end ? 'both' : start ? 'start' : end ? 'end' : 'none' });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    row.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer.disconnect();
      row.removeEventListener('scroll', measure);
    };
  }, []);
  const choose = (index: number) => {
    const option = options.at(index);
    if (option === undefined) {
      return;
    }
    onChange(option.value);
    const chip = refs.current[index];
    chip?.focus();
    chip?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: motionReduced() ? 'auto' : 'smooth' });
  };
  return (
    // The arrow keys are handled on the group, for the chip that has focus: the chips themselves are the controls (roving tabindex).
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- the radios inside are the focusable parts
    <div
      ref={rowRef}
      role="radiogroup"
      aria-label={label}
      className="ml-chiprow"
      onKeyDown={(event) => {
        const target = segmentTarget(options, chosen, event.key);
        if (target !== -1) {
          event.preventDefault();
          choose(target);
        }
      }}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(element) => {
            refs.current[index] = element;
          }}
          type="button"
          role="radio"
          className="ml-fchip"
          aria-checked={option.value === value}
          tabIndex={index === stop ? 0 : -1}
          onClick={() => choose(index)}
        >
          <span className="ml-fchip-face">{option.label}</span>
        </button>
      ))}
    </div>
  );
};

/** The rows of the list now: which ids, and under which view (folder, search, filter, layout). */
interface ListCommit {
  view: string;
  ids: Set<string>;
  /** How many rows the last change took out and put in. */
  removed: number;
  added: number;
}

/** The focusable row buttons of the list, top to bottom (not the copies of rows that are leaving). */
function liveRows(scroller: Element): HTMLElement[] {
  return [...scroller.querySelectorAll<HTMLElement>('li:not([data-leaving]) .ml-row')];
}

/** The focusable row button that follows (or, for the last one, precedes) the row of `item`. */
function neighbourRow(item: HTMLElement): HTMLElement | null {
  const scroller = item.closest('.ml-scroll');
  if (scroller === null) {
    return null;
  }
  const rows = liveRows(scroller);
  const own = item.querySelector<HTMLElement>('.ml-row');
  const index = own === null ? -1 : rows.indexOf(own);
  if (index === -1) {
    return null;
  }
  return rows.at(index + 1) ?? (index > 0 ? rows.at(index - 1) : undefined) ?? null;
}

/** The controls of a row that the Right and Left keys walk: its quick actions (top right), then its star. */
function rowControls(item: HTMLElement): HTMLElement[] {
  return [...item.querySelectorAll<HTMLElement>('.ml-quick button'), ...item.querySelectorAll<HTMLElement>('.ml-star')].filter(
    (control) => control.getClientRects().length > 0
  );
}

/** True when some of `el` is inside the visible part of its scroller (a row out of view leaves and arrives without motion). */
function inView(el: HTMLElement): boolean {
  const scroller = el.closest('.ml-scroll');
  if (scroller === null) {
    return false;
  }
  const box = el.getBoundingClientRect();
  const view = scroller.getBoundingClientRect();
  return box.bottom > view.top && box.top < view.bottom;
}

/** How long the list's scrollbar stays after the last scroll (messagelist.css shows it while `data-scrolling` is set). */
const SCROLLBAR_LINGER_MS = 900;

/**
 * The body of the view the list showed last (folder, search, filter), across mounts: a phone's list that comes back from the reader is the
 * same view drawn again, so it does not fade in as if it were new (M8 is for a change of view only).
 */
let lastBody = '';

/**
 * The heading of a search: `Results for "query"`, where only the query is cut short (an ellipsis) when the column is narrow: the words around
 * it stay whole, in every language's order (J4-38).
 */
function ResultsTitle({ query }: { query: string }): React.ReactElement {
  const tr = useT();
  const mark = '\u0001';
  const [before = '', after = ''] = tr('list.results_for', { query: mark }).split(mark);
  return (
    <>
      {before === '' ? null : <span className="ml-title-text">{before}</span>}
      <span className="ml-title-q">{query}</span>
      {after === '' ? null : <span className="ml-title-text">{after}</span>}
    </>
  );
}

export const MessageList: React.FC<MessageListProps> = ({
  t,
  messages,
  selectedId,
  onSelect,
  onToggleStar,
  onSwipeArchive,
  onSwipeTrash,
  rowActions,
  leaveStyle,
  title,
  folder,
  subtitle,
  subtitleCount,
  filter,
  onFilterChange,
  onMarkAllRead,
  canMarkAllRead = true,
  onRefresh,
  isLoading,
  searchQuery,
  scope = 'folder',
  onScopeChange,
  resultsText = '',
  onEmptyFolder,
  searchSlot,
  notices,
  isDrafts = false,
  isSnoozed = false,
  compact = false,
  scrollMemory,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  loadFailed = false,
  onRetry,
  selection = NOTHING,
  onSelectionChange,
  selectionBar,
  selectionNote,
  labels: allLabels = NO_LABELS,
  menuRequest = null
}) => {
  const tr = useT();
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  // Multi-select (J6-26): something is ticked, so every row shows its box (a phone's tap ticks).
  const selectable = onSelectionChange !== undefined && !isDrafts;
  const selecting = selectable && selection.size > 0;
  /** The row clicked last: Shift+click ticks or clears every row from it to the one clicked. */
  const anchor = React.useRef<string | null>(null);
  /** The ids of the rows as the list shows them, top to bottom (the day groups may order them apart from `messages`). */
  const shownOrder = (): string[] =>
    scrollerRef.current === null
      ? messages.map((m) => m.id)
      : liveRows(scrollerRef.current).flatMap((row) => row.closest<HTMLElement>('li[data-id]')?.dataset.id ?? []);
  const check = (id: string, range: boolean) => {
    if (onSelectionChange === undefined) {
      return;
    }
    onSelectionChange(range ? selectRange(selection, shownOrder(), anchor.current, id) : toggleOne(selection, id));
    anchor.current = id;
  };
  const filters = filterOptions(folder, tr);
  // The scrollbar shows while the list scrolls (with a mouse; messagelist.css): set on each scroll, cleared a moment after the last one.
  // data-stuck: the rows' top is above the scroller's (a day heading sticks there), so the rows fade in under it (messagelist.css).
  // data-scrolled on the list (a phone): rows pass under the search that stays above them, which then draws its hairline.
  React.useEffect(() => {
    const scroller = scrollerRef.current;
    if (scroller === null) {
      return;
    }
    let timer: number | undefined;
    const onScroll = () => {
      scroller.dataset.scrolling = '';
      const body = scroller.querySelector('.ml-body');
      scroller.toggleAttribute('data-stuck', body !== null && body.getBoundingClientRect().top < scroller.getBoundingClientRect().top - 1);
      scroller.closest('.ml-root')?.toggleAttribute('data-scrolled', scroller.scrollTop > 0);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        delete scroller.dataset.scrolling;
      }, SCROLLBAR_LINGER_MS);
    };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      scroller.removeEventListener('scroll', onScroll);
      window.clearTimeout(timer);
    };
  }, []);
  // Restore the offset the list had before it was unmounted (reader opened, then Back).
  React.useLayoutEffect(() => {
    if (scrollMemory && scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollMemory.current;
    }
  }, [scrollMemory]);
  const groups = React.useMemo(() => {
    const byGroup = new Map<string, Message[]>();
    for (const m of messages) {
      // Drafts are listed by last save (the server's order), so that is the date they are grouped by too; snoozed mail by the
      // day it comes back (soonest first), so the groups never reorder the server's list.
      const key = isSnoozed
        ? typeof m.snoozed_until === 'number'
          ? snoozeGroupOf(m.snoozed_until)
          : 'later'
        : groupOf(isDrafts ? m.updated_at : m.created_at);
      const bucket = byGroup.get(key);
      if (bucket) {
        bucket.push(m);
      } else {
        byGroup.set(key, [m]);
      }
    }
    const order: readonly string[] = isSnoozed ? SNOOZE_GROUP_ORDER : GROUP_ORDER;
    return order.flatMap((g) => {
      const items = byGroup.get(g);
      return items ? [{ id: g, items }] : [];
    });
  }, [messages, isDrafts, isSnoozed]);

  const query = searchQuery ?? '';
  const searching = query !== '';
  const allMail = searching && scope === 'all';
  // An empty Inbox with no search, filter or failed load is the "all caught up" screen, which Edgar owns; so is a list that could not load.
  const caughtUp = folder === 'inbox' && filter === 'all' && !loadFailed && !searching;
  // A search that found nothing offers the way back, and, while it looked in this folder only, all mail.
  // ONE Clear control (J6-37): the head's on a desktop, the search field's own on a phone; the empty state only offers to look further.
  const noResultsActions =
    searching && scope === 'folder' && onScopeChange !== undefined ? (
      <Button variant="primary" onClick={() => onScopeChange('all')}>
        {tr('list.search_all')}
      </Button>
    ) : undefined;
  // Trash and Spam keep mail until it is deleted (there is no automatic purge): one quiet line says so, with Empty <folder> beside it.
  const bin = !searching && (folder === 'trash' || folder === 'spam');
  const emptyable = bin && onEmptyFolder !== undefined && messages.length > 0 && filter === 'all';

  // ---- The list is one Tab stop (roving tabindex): the row focus was on last, else the open row, else the first one. j and k (App) move
  // the open row and focus with it, so the stop follows the open row whenever it changes.
  const [rove, setRove] = React.useState<{ id: string | null; selected: string | null }>({ id: null, selected: selectedId });
  if (rove.selected !== selectedId) {
    setRove({ id: selectedId, selected: selectedId });
  }
  const stopId =
    rove.id !== null && messages.some((m) => m.id === rove.id)
      ? rove.id
      : selectedId !== null && messages.some((m) => m.id === selectedId)
        ? selectedId
        : (messages.at(0)?.id ?? null);
  const focusRow = (id: string) => () => {
    if (rove.id !== id) {
      setRove({ id, selected: selectedId });
    }
  };

  // The snooze button of a quick-action row is the reader's button (SnoozeMenu): it is taken out of the Tab order here, like its neighbours.
  React.useLayoutEffect(() => {
    for (const button of scrollerRef.current?.querySelectorAll<HTMLElement>('.ml-quick .ml-snooze > button') ?? []) {
      button.tabIndex = -1;
    }
  });

  // ---- The row menu (long press, Shift+F10, the context-menu key, a right click).
  const [menu, setMenu] = React.useState<{
    message: Message;
    sender: string;
    subject: string;
    touch: boolean;
    /** A desktop popup's place (J3-23); undefined: a phone's bottom sheet. */
    anchor?: RowMenuAnchor;
    view: RowMenuView;
  } | null>(null);
  const menuReturn = React.useRef<HTMLElement | null>(null);
  const menuItem = React.useRef<HTMLElement | null>(null);
  // `touch`: opened by a long press, so the sheet itself takes focus (no keyboard ring on its first action under a finger). A mouse or a
  // keyboard (not a phone's board, not a coarse pointer) gets the popup: at the pointer for a right click, else under the row's actions.
  const openMenu = (m: Message, item: HTMLElement, touch = false, point?: { x: number; y: number }, view: RowMenuView = 'actions') => {
    if (rowActions === undefined || isDrafts) {
      return;
    }
    menuItem.current = item;
    menuReturn.current = item.querySelector<HTMLElement>('.ml-row');
    let place: RowMenuAnchor | undefined;
    if (!touch && !compact && !window.matchMedia('(pointer: coarse)').matches) {
      // Shift+F10: under the row, its right edge under the row's actions, so the row it acts on stays in view (J3-23).
      const actionsBox = item.querySelector('.ml-quick')?.getBoundingClientRect();
      const rowBox = item.getBoundingClientRect();
      const right = actionsBox !== undefined && actionsBox.width > 0 ? actionsBox.right : rowBox.right;
      place = point === undefined ? { x: right, y: rowBox.bottom, align: 'end' } : { ...point, align: 'start' };
    }
    // A long press on Android also fires a contextmenu event for the same row: the open menu stays as it is.
    setMenu((open) =>
      open?.message.id === m.id && open.view === view
        ? open
        : { message: m, sender: partyLabel(m, isDrafts, tr), subject: subjectOf(m, tr('list.no_subject')), touch, anchor: place, view }
    );
  };
  // b and l (App): the menu of that row, opened on the snooze times or the labels.
  const openMenuRef = React.useRef(openMenu);
  const messagesRef = React.useRef(messages);
  React.useLayoutEffect(() => {
    openMenuRef.current = openMenu;
    messagesRef.current = messages;
  });
  React.useEffect(() => {
    if (menuRequest === null) {
      return;
    }
    const item = scrollerRef.current?.querySelector<HTMLElement>(`li[data-id="${CSS.escape(menuRequest.id)}"]:not([data-leaving])`);
    const m = messagesRef.current.find((message) => message.id === menuRequest.id);
    if (item !== null && item !== undefined && m !== undefined) {
      item.querySelector<HTMLElement>('.ml-row')?.focus({ preventScroll: true });
      openMenuRef.current(m, item, false, undefined, menuRequest.view);
    }
  }, [menuRequest]);
  // J5-24: a touch tablet's long press on a desktop row opens its menu (the sheet, as a phone's long press does), with Select in it.
  const longPress = useRowLongPress((item) => {
    const m = messagesRef.current.find((message) => message.id === item.dataset.id);
    if (m !== undefined) {
      openMenuRef.current(m, item, true);
    }
  });
  // An action of the menu that takes the row away: once the menu has closed, focus goes to the next row (never to the page).
  const onMenuLeave = () => {
    const item = menuItem.current;
    const neighbour = item === null ? null : neighbourRow(item);
    const scroller = scrollerRef.current;
    menuReturn.current = neighbour ?? scroller;
    window.requestAnimationFrame(() => {
      if (item?.contains(document.activeElement) === true || document.activeElement === document.body) {
        (neighbour ?? scroller)?.focus({ preventScroll: true });
      }
    });
  };

  const onListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const scroller = scrollerRef.current;
    const target = event.target;
    if (scroller === null || !(target instanceof HTMLElement) || event.altKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const item = target.closest<HTMLElement>('li.ml-item');
    if (item === null || !scroller.contains(item)) {
      return;
    }
    const row = item.querySelector<HTMLElement>('.ml-row');
    const rows = liveRows(scroller);
    const index = row === null ? -1 : rows.indexOf(row);
    const onRow = target === row;
    const controls = rowControls(item);
    const at = controls.indexOf(target);
    const page = Math.max(1, Math.floor(scroller.clientHeight / Math.max(1, row?.offsetHeight ?? 80)) - 1);
    const box = item.querySelector<HTMLElement>('.ml-check input');
    // The row's box (multi-select): Right or Escape go back to the row.
    if (box !== null && target === box && (event.key === 'ArrowRight' || event.key === 'Escape')) {
      event.preventDefault();
      row?.focus({ preventScroll: true });
      return;
    }
    // Shift+Down and Shift+Up tick this row and the next one, which takes focus; going back over a ticked run unticks (J6-26).
    if (selectable && onRow && event.shiftKey && (event.key === 'ArrowDown' || event.key === 'ArrowUp') && item.dataset.id !== undefined) {
      event.preventDefault();
      const grown = extendSelection(selection, shownOrder(), item.dataset.id, event.key === 'ArrowDown' ? 1 : -1);
      if (grown.to !== null) {
        onSelectionChange(grown.selected);
        anchor.current = grown.to;
        const to = scroller.querySelector<HTMLElement>(`li[data-id="${CSS.escape(grown.to)}"]:not([data-leaving]) .ml-row`);
        to?.focus({ preventScroll: true });
        to?.scrollIntoView({ block: 'nearest' });
      }
      return;
    }
    // Escape on a row clears the selection.
    if (event.key === 'Escape' && onRow && selecting) {
      event.preventDefault();
      onSelectionChange(new Set());
      return;
    }
    // Shift+F10 and the context-menu key open the row's menu (J5-12). Browsers turn them into a contextmenu event only sometimes (not every
    // platform, not a synthetic key), so the key itself opens it; the row button's contextmenu handler covers a right click.
    if ((event.key === 'F10' && event.shiftKey) || event.key === 'ContextMenu') {
      const m = messages.find((message) => message.id === item.dataset.id);
      if (m !== undefined && !isDrafts && rowActions !== undefined) {
        event.preventDefault();
        openMenu(m, item);
      }
      return;
    }
    let next: HTMLElement | undefined;
    switch (event.key) {
      case 'ArrowDown': {
        next = rows.at(index + 1);
        break;
      }
      case 'ArrowUp': {
        next = index > 0 ? rows.at(index - 1) : undefined;
        break;
      }
      case 'Home': {
        next = rows.at(0);
        break;
      }
      case 'End': {
        next = rows.at(-1);
        break;
      }
      case 'PageDown': {
        next = rows.at(Math.min(rows.length - 1, index + page));
        break;
      }
      case 'PageUp': {
        next = rows.at(Math.max(0, index - page));
        break;
      }
      case 'ArrowRight': {
        next = onRow ? controls.at(0) : at === -1 ? undefined : controls.at(at + 1);
        break;
      }
      case 'ArrowLeft': {
        next = onRow ? (box ?? undefined) : at > 0 ? controls.at(at - 1) : (row ?? undefined);
        break;
      }
      case 'Escape': {
        next = onRow ? undefined : (row ?? undefined);
        break;
      }
      default: {
        return;
      }
    }
    // A key of the list is the list's even where nothing is beyond (the last row and Down do not scroll the page).
    event.preventDefault();
    if (next !== undefined) {
      next.focus({ preventScroll: true });
      next.scrollIntoView({ block: 'nearest' });
    }
  };

  // ---- Rows that leave and arrive (M1, M4) ----
  // A row that leaves the list (archived, trashed, snoozed ... in this same view) plays its exit on a copy left where it was: its content
  // slides away and fades, then its height closes. A row that comes back (Undo) opens its height and slides back in from where it went; new
  // mail opens its height and drops in. Nothing waits for either: the data, the selection and the focus have already moved.
  const view = `${folder}\n${query}\n${scope}\n${filter}\n${compact ? 'phone' : 'desk'}`;
  const commit = React.useRef<ListCommit>({ view: '', ids: new Set(), removed: 0, added: 0 });
  const items = React.useRef(new Map<string, HTMLLIElement>());
  const leaveStyleRef = React.useRef(leaveStyle);
  React.useLayoutEffect(() => {
    leaveStyleRef.current = leaveStyle;
  }, [leaveStyle]);

  // The ref of every row (it knows its row by `data-id`): one function for the life of the list, so React detaches it only when a row goes.
  // It detaches while the row is still on the page, which is when the copy is taken; whether it plays is decided once the change is committed.
  const itemRef = React.useCallback((el: HTMLLIElement | null) => {
    const id = el?.dataset.id;
    if (el === null || id === undefined) {
      return;
    }
    items.current.set(id, el);
    return () => {
      const parent = el.parentElement;
      const next = el.nextSibling;
      const seenIn = commit.current.view;
      const visible = inView(el);
      const copy = el.cloneNode(true);
      queueMicrotask(() => {
        if (el.isConnected) {
          // Not gone (React's StrictMode attaches twice).
          return;
        }
        if (items.current.get(id) === el) {
          items.current.delete(id);
        }
        const now = commit.current;
        if (!(copy instanceof HTMLElement) || parent === null || !parent.isConnected || !visible) {
          return;
        }
        if (now.view !== seenIn || now.removed > ROW_MOTION_MAX || now.ids.has(id)) {
          // Another view, a bulk change, or the row is still listed (it moved to another day group): no exit to play.
          return;
        }
        for (const node of [copy, ...copy.querySelectorAll('[id]')]) {
          node.removeAttribute('id');
        }
        copy.setAttribute('aria-hidden', 'true');
        copy.inert = true;
        copy.dataset.leaving = 'true';
        parent.insertBefore(copy, next !== null && next.parentNode === parent ? next : null);
        const style = leaveStyleRef.current?.(id) ?? 'slide';
        void leaveRow(copy, style === 'fade' ? 'none' : 'left').then(() => {
          copy.remove();
        });
      });
    };
  }, []);

  const [fresh, setFresh] = React.useState(0);
  const newest = React.useRef(0);
  React.useLayoutEffect(() => {
    const before = commit.current;
    const ids = new Set(messages.map((m) => m.id));
    const sameView = before.view === view;
    const added = sameView ? messages.filter((m) => !before.ids.has(m.id)) : [];
    const removed = sameView ? [...before.ids].filter((id) => !ids.has(id)).length : 0;
    commit.current = { view, ids, removed, added: added.length };
    const latest = messages.reduce((max, m) => Math.max(max, m.created_at), 0);
    const seenNewest = newest.current;
    newest.current = sameView ? Math.max(seenNewest, latest) : latest;
    if (!sameView) {
      setFresh(0);
      if (scrollerRef.current !== null && before.view !== '') {
        // Another folder (or search, or filter) starts at its top.
        scrollerRef.current.scrollTop = 0;
      }
      return;
    }
    if (before.ids.size === 0 || added.length === 0 || added.length > ROW_MOTION_MAX + 1) {
      return;
    }
    const scrolled = (scrollerRef.current?.scrollTop ?? 0) > 24;
    const arrived = added.filter((m) => m.created_at > seenNewest);
    if (scrolled && arrived.length > 0) {
      // Scrolled down: nothing moves under the reader (the browser keeps the visible rows in place); a pill says what came in.
      setFresh((count) => count + arrived.length);
    }
    for (const m of added) {
      const el = items.current.get(m.id);
      if (el === undefined || !inView(el)) {
        continue;
      }
      if (!arrived.includes(m)) {
        // An older mail that is listed again: an Undo bringing back the row that just left (M1 backwards).
        void returnRow(el);
        continue;
      }
      // H5: its height opens and it drops in (M4), settling with a small overshoot under a soft accent wash that fades (lib/shellMotion).
      void enterRow(el);
      landRow(el);
    }
  }, [messages, view]);

  // The body fades in for a new view (M8), not when the same view is drawn again (a phone's list back from the reader).
  const bodyKey = `${folder}\n${query}\n${scope}\n${filter}`;
  const [stillBody, setStillBody] = React.useState(() => (lastBody === bodyKey ? bodyKey : null));
  // A view that changes while the list is on screen is new: forget the "still" during render as soon as the key moves on (React's pattern
  // for state that follows a prop), so going back to that view later fades in as any change of view does.
  if (stillBody !== null && stillBody !== bodyKey) {
    setStillBody(null);
  }
  React.useEffect(() => {
    lastBody = bodyKey;
  }, [bodyKey]);

  const toTop = () => {
    const scroller = scrollerRef.current;
    setFresh(0);
    if (scroller === null) {
      return;
    }
    scroller.scrollTo({ top: 0, behavior: motionReduced() ? 'auto' : 'smooth' });
    // The pill goes away under the pointer: focus moves to the first row instead of the page.
    scroller.querySelector<HTMLElement>('.ml-row')?.focus({ preventScroll: true });
  };

  // Focus moves to the next row at once when a row's own action takes it away (M1).
  const leaveFrom = (id: string) => () => {
    const el = items.current.get(id);
    if (el?.contains(document.activeElement) === true) {
      neighbourRow(el)?.focus({ preventScroll: false });
    }
  };

  // DESIGN-v3 H3: one capsule marks the open row and glides to the next one (a desktop; never while rows are ticked, the ticked ones stand
  // out then). It is a child of the scrolled content, under the rows.
  const bodyRef = React.useRef<HTMLDivElement | null>(null);
  const glideRef = useGlide(bodyRef, ".ml-cell[data-selected='true']", { key: selectedId, enabled: !compact && !selecting });

  const filterBar = isDrafts ? null : compact ? (
    <FilterChips label={tr('list.filter_label')} options={filters} value={filter} onChange={onFilterChange} />
  ) : (
    <div className="ml-filters">
      <SegmentedControl label={tr('list.filter_label')} wrap stretch options={filters} value={filter} onChange={onFilterChange} />
    </div>
  );

  // The scope of a search: the open folder or all mail. ONE Clear control (J6-37): the search field's own, which stands right above it now
  // on a desktop too (DESIGN-v3 4.1: the search is the list sheet's).
  const scopeBar =
    searching && onScopeChange !== undefined ? (
      <div className="ml-scope">
        <SegmentedControl
          label={tr('list.scope_label')}
          options={[
            { value: 'folder' as const, label: title },
            { value: 'all' as const, label: tr('list.scope_all') }
          ]}
          value={scope}
          onChange={onScopeChange}
        />
      </div>
    ) : null;

  // How long mail stays in Trash or Spam, beside Empty Trash: only while the folder holds mail (an empty one's own line says it is empty).
  const binLine =
    bin && messages.length > 0 ? (
      <div className="ml-bin">
        <p className="ml-bin-text">{tr('list.kept_until_deleted', { folder: title })}</p>
        {emptyable ? (
          <Button variant="danger" size="sm" onClick={onEmptyFolder}>
            {tr('list.empty_folder', { folder: title })}
          </Button>
        ) : null}
      </div>
    ) : null;

  return (
    <section
      aria-label={title}
      className="ml-root"
      data-compact={compact ? 'true' : undefined}
      data-selecting={selecting ? 'true' : undefined}
    >
      {compact ? null : (
        <div className="ml-head">
          {/* The title and its count cross-fade when the folder changes (M8); a search turns them into the results and their count. Only
              the quoted search gives way when the column is narrow: the count and where it looked never do (J6-37, J4-38). The count's
              number rolls (DESIGN-v3 H2). */}
          <div key={searching ? 'search' : title} className="ml-heading" data-search={searching ? 'true' : undefined}>
            <h1 id="list-title" className="ml-title">
              {searching ? <ResultsTitle query={query} /> : title}
            </h1>
            <span className="ml-subtitle">{searching ? resultsText : <RollingText text={subtitle} count={subtitleCount} />}</span>
          </div>
          <div className="ml-actions">
            {/* Drafts are never unread, Trash and Spam are not read from the list, and with nothing unread there is nothing to mark. */}
            {isDrafts || bin || !canMarkAllRead ? null : (
              <IconButton label={tr('list.mark_all_read')} size="sm" onClick={onMarkAllRead}>
                <CheckCheck size={16} strokeWidth={1.75} aria-hidden="true" />
              </IconButton>
            )}
            <IconButton label={tr('list.refresh')} size="sm" onClick={onRefresh}>
              <RefreshCw size={16} strokeWidth={1.75} className={isLoading ? 'nm-spin' : undefined} aria-hidden="true" />
            </IconButton>
          </div>
        </div>
      )}

      {compact ? null : (
        <>
          {searchSlot === undefined ? null : <div className="ml-search">{searchSlot}</div>}
          {scopeBar}
          {binLine}
          {filterBar}
          {/* Right above the rows it is about, under the filter it counts within (J6-39). */}
          {selecting ? selectionNote : null}
        </>
      )}
      {/* DESIGN-v4m R3: the phone's search stays under the app bar (outside the scroller), one tap away however far the list scrolled; the
          scope, the Trash line and the filters scroll away with the rows. A hairline under it once rows pass under it (data-scrolled). */}
      {compact && searchSlot !== undefined ? <div className="ml-search">{searchSlot}</div> : null}

      <div className="ml-scroll-wrap">
        {fresh > 0 ? (
          <Button size="sm" className="ml-new" leadingIcon={<ArrowUp size={14} strokeWidth={2} aria-hidden="true" />} onClick={toTop}>
            {tr('app.new_messages', { count: fresh })}
          </Button>
        ) : null}
        {/* The keys of the list (arrows, Home, End, Page Up and Down, Right and Left into a row's actions) are handled here, for the row or
            the control that has focus; each one is a button, so this element is not a control. */}
        {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- see above */}
        <div
          ref={scrollerRef}
          onScroll={(e) => {
            if (scrollMemory) {
              // eslint-disable-next-line no-param-reassign, react-hooks/immutability -- scrollMemory is a ref object owned by the parent; writing .current is its purpose
              scrollMemory.current = e.currentTarget.scrollTop;
            }
            if (fresh > 0 && e.currentTarget.scrollTop <= 24) {
              setFresh(0);
            }
          }}
          onKeyDown={onListKeyDown}
          className="ml-scroll"
          data-compact={compact ? 'true' : undefined}
        >
          {/* The phone's notices, scope, Trash line and filters scroll away with the rows; the app bar and the search above them stay. */}
          {compact ? (
            <div className="ml-tools" data-closing={isDrafts && !searching ? 'true' : undefined}>
              {notices}
              {scopeBar}
              {binLine}
              {filterBar}
              {selecting ? selectionNote : null}
            </div>
          ) : null}
          {/* A new view's rows fade in (M8): the body is drawn afresh for each folder, search and filter. */}
          <div ref={bodyRef} key={bodyKey} className="ui-glide-host ml-body" data-still={stillBody === bodyKey ? 'true' : undefined}>
            {compact ? null : <div ref={glideRef} aria-hidden="true" className="ui-glide ml-glide" />}
            {isLoading && groups.length === 0 ? <ListSkeleton className="ml-skel" label={tr('list.loading')} lines={3} /> : null}

            {groups.map((g) => (
              <div key={g.id} className="ml-group">
                <h2 className="ml-group-title">{groupHeading(g.id, tr)}</h2>
                <ul role="list" className="ml-list" data-clear={compact && g === groups.at(-1) && !hasMore ? 'true' : undefined}>
                  {g.items.map((m) => {
                    const selected = m.id === selectedId;
                    const unread = m.is_read === 0;
                    const starred = m.is_starred === 1;
                    const labels = labelsOf(m);
                    // A search result's preview starts a few words before the match, so the marked word is in view (J6-32).
                    const preview = searching ? searchSnippetOf(m, query, 120) : snippetOf(m, 120);
                    const checked = selectable && selection.has(m.id);
                    const menuOpen = menu?.message.id === m.id;
                    const sender = partyLabel(m, isDrafts, tr);
                    const avatar = avatarName(m, isDrafts);
                    // One tint per person: the sender's address (in Drafts, the first recipient's).
                    const avatarHue = isDrafts ? avatar : m.from_address;
                    // A row under a day heading of its own time says only the clock time (not Yesterday twice); Snoozed is grouped by wake day.
                    const time = formatRowTime(isDrafts ? m.updated_at : m.created_at, !isSnoozed);
                    const subject = subjectOf(m, tr('list.no_subject'));
                    const snoozedUntil = m.folder === 'snoozed' && typeof m.snoozed_until === 'number' ? m.snoozed_until : null;
                    const folderChip = allMail ? folderName(m.folder) : null;
                    const tabIndex = m.id === stopId ? 0 : -1;

                    if (compact) {
                      return (
                        <CompactRow
                          key={m.id}
                          t={t}
                          message={m}
                          sender={sender}
                          avatar={avatar}
                          avatarHue={avatarHue}
                          subject={subject}
                          time={time}
                          snoozedUntil={snoozedUntil}
                          preview={preview}
                          unread={unread}
                          starred={starred}
                          checked={checked}
                          selecting={selecting}
                          menuOpen={menuOpen}
                          query={query}
                          folderChip={folderChip}
                          tabIndex={tabIndex}
                          onFocus={focusRow(m.id)}
                          // While rows are ticked a tap ticks (or unticks) the row instead of opening it.
                          onSelect={selecting ? (id) => check(id, false) : onSelect}
                          onPick={selectable ? (id) => check(id, false) : undefined}
                          onToggleStar={onToggleStar}
                          onSwipeArchive={onSwipeArchive}
                          onSwipeTrash={onSwipeTrash}
                          onMenu={isDrafts || rowActions === undefined ? undefined : openMenu}
                          itemRef={itemRef}
                        />
                      );
                    }

                    return (
                      <li
                        key={m.id}
                        ref={itemRef}
                        data-id={m.id}
                        className="ml-item"
                        data-star={isDrafts ? undefined : 'true'}
                        data-checked={checked ? 'true' : undefined}
                        data-menu-open={menuOpen ? 'true' : undefined}
                      >
                        <div
                          className="ml-cell"
                          data-selected={selected ? 'true' : undefined}
                          // A touch tablet's long press opens the row menu (J5-24); a mouse never starts it.
                          {...(isDrafts || rowActions === undefined ? {} : longPress)}
                        >
                          {selectable ? (
                            // The row's box (J6-26): in place of the avatar on hover and focus, on every row while something is ticked.
                            // Not a Tab stop (the list is one): Left reaches it from the row, x ticks the row in focus.
                            <Checkbox
                              className="ml-check"
                              label={<VisuallyHidden>{tr('list.select_message', { sender })}</VisuallyHidden>}
                              checked={checked}
                              tabIndex={-1}
                              onClick={(event) => check(m.id, event.shiftKey)}
                            />
                          ) : null}
                          <RowButton
                            t={t}
                            message={m}
                            sender={sender}
                            avatar={avatar}
                            avatarHue={avatarHue}
                            subject={subject}
                            time={time}
                            snoozedUntil={snoozedUntil}
                            preview={preview}
                            labels={labels}
                            unread={unread}
                            selected={selected}
                            checked={checked}
                            compact={false}
                            query={query}
                            folderChip={folderChip}
                            tabIndex={tabIndex}
                            onFocus={focusRow(m.id)}
                            onSelect={onSelect}
                            onMenu={isDrafts || rowActions === undefined ? undefined : (item, point) => openMenu(m, item, false, point)}
                          />
                          {isDrafts ? null : <StarButton message={m} sender={sender} starred={starred} onToggleStar={onToggleStar} />}
                          {isDrafts || rowActions === undefined ? null : (
                            <QuickActions
                              t={t}
                              message={m}
                              folder={allMail ? m.folder : folder}
                              unread={unread}
                              actions={rowActions}
                              onLeave={leaveFrom(m.id)}
                            />
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}

            {!isLoading && groups.length === 0 ? (
              <EmptyState
                className="ml-empty"
                illustration={caughtUp || loadFailed}
                art={caughtUp || loadFailed ? undefined : <FlightTrail size="md" />}
                idle={caughtUp}
                title={
                  loadFailed
                    ? tr('list.load_failed')
                    : filter === 'all'
                      ? searching
                        ? tr('list.no_results', { query })
                        : tr('list.empty_in', { folder: title })
                      : searching
                        ? tr('list.no_match_search')
                        : tr('list.no_match')
                }
                description={
                  loadFailed
                    ? tr('list.load_failed_hint')
                    : filter === 'all'
                      ? searching
                        ? allMail
                          ? tr('list.scope_all_hint')
                          : tr('list.try_other_search')
                        : isDrafts
                          ? tr('list.hint_drafts')
                          : isSnoozed
                            ? tr('list.hint_snoozed')
                            : emptyHint(folder, tr)
                      : searching
                        ? tr('list.hint_clear_filter')
                        : tr('list.hint_switch_all')
                }
                action={loadFailed ? <Button onClick={onRetry}>{tr('common.retry')}</Button> : noResultsActions}
              />
            ) : null}

            {hasMore ? (
              <div className="ml-more">
                {/* `loading` sets aria-disabled, not disabled: the button keeps keyboard focus while it loads. */}
                <Button
                  variant="ghost"
                  fullWidth
                  loading={loadingMore}
                  onClick={() => {
                    if (!loadingMore) {
                      onLoadMore?.();
                    }
                  }}
                >
                  {loadingMore ? tr('common.loading') : tr('list.load_more')}
                </Button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      {compact ? null : (
        // The selection's bar floats at the bottom centre of the list sheet while rows are ticked (DESIGN-v3 4.1); the anchor stays, so
        // the bar's copy can fade out in place when it goes (SelectionBar useLeaveInPlace).
        <div className="ml-dock">
          <span aria-hidden="true" className="ml-dock-anchor" />
          {selecting ? selectionBar : null}
        </div>
      )}
      {rowActions === undefined ? null : (
        <RowMenu
          message={menu?.message ?? null}
          folder={menu !== null && allMail ? menu.message.folder : folder}
          sender={menu?.sender ?? ''}
          subject={menu?.subject ?? ''}
          actions={rowActions}
          onToggleStar={onToggleStar}
          onClose={() => setMenu(null)}
          onLeave={onMenuLeave}
          returnFocusRef={menuReturn}
          focusSheet={menu?.touch === true}
          anchor={menu?.anchor}
          labels={allLabels}
          checked={menu !== null && selection.has(menu.message.id)}
          initialView={menu?.view}
        />
      )}
    </section>
  );
};
