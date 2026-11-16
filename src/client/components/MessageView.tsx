import React from 'react';
import {
  Archive,
  Ban,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Download,
  Ellipsis,
  Forward,
  Inbox,
  Mail,
  Paperclip,
  Reply,
  ReplyAll,
  ShieldAlert,
  Star,
  Tag,
  Trash2,
  type LucideIcon
} from 'lucide-react';
import type { Attachment, Message } from '../types';
import type { ThemeTokens } from '../theme';
import { getLabelChip } from '../theme';
import {
  arrivedUnverified,
  bareAddress,
  bodyParagraphs,
  displayName,
  fileTypeOf,
  formatBytes,
  formatFullDate,
  labelsOf,
  splitAddressList,
  subjectOf
} from '../lib/mail';
import { announce } from '../lib/announce';
import { useT, type MessageKey } from '../lib/i18n';
import { getUnlockedKey } from '../lib/crypto/keyStore';
import { loadEmbeddedImages } from '../lib/mailcrypto/inline';
import { safeFileName } from '../lib/mailcrypto/files';
import { NOTE_KEYS, isUnreadable } from '../lib/mailcrypto/texts';
import { useMailDownloads } from '../lib/mailcrypto/useMailDownloads';
import { quoteBlocks, splitQuote } from '../lib/mailQuote';
import { usePrefs } from '../lib/prefs';
import { shortcutHint, type MailShortcut } from '../lib/shortcuts';
import {
  Avatar,
  Banner,
  Button,
  Chip,
  Disclosure,
  Divider,
  EmptyState,
  IconButton,
  Menu,
  SegmentedControl,
  Skeleton,
  Spinner,
  Toolbar,
  Tooltip,
  VisuallyHidden,
  type MenuItem,
  type MenuTriggerProps
} from '../ui';
import { cx } from '../ui/cx';
import { E2eBadge } from './E2eBadge';
import { FileTypeTile } from './FileTypeTile';
import { UnverifiedChip } from './UnverifiedChip';
import { MailFrame } from './MailFrame';
import { SnoozeChip, SnoozeMenu } from './SnoozeMenu';
import { LabelMenu, LabelPicker } from './reader/LabelMenu';
import { QuoteNodes } from './reader/QuoteText';
import { ToolButton } from './reader/ToolButton';
import { phoneBar, type PhoneMoreItem } from './reader/actions';
import {
  alignedLayout,
  barAlignment,
  replyDensity,
  useFontsLoaded,
  usePaneMeasure,
  wordWidths,
  type BarDensity
} from './reader/barDensity';
import { nextMessageIn, positionIndex } from './reader/motion';
import './reader.css';

interface MessageViewProps {
  t: ThemeTokens;
  message: Message | null;
  attachments: Attachment[];
  isLoading: boolean;
  labels: string[];
  /** Where a failed download is reported (the app's toast). Without it the reader shows the failure itself, under the message. */
  onNotice?: (text: string) => void;
  onReply: (message: Message) => void;
  onReplyAll: (message: Message) => void;
  onForward: (message: Message) => void;
  onToggleStar: (message: Message) => void;
  onArchive: (message: Message) => void;
  onTrash: (message: Message) => void;
  onSpam: (message: Message) => void;
  /** Trash and Spam only: back to the Inbox. */
  onRestore: (message: Message) => void;
  /** Trash and Spam only: remove the message for good (the owner asks first). */
  onDeleteForever: (message: Message) => void;
  onMarkUnread: (message: Message) => void;
  onSnooze: (message: Message, until: Date) => void;
  onUnsnooze: (message: Message) => void;
  onToggleLabel: (message: Message, label: string) => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  position: string;
  onBack?: () => void;
  /** The list beside the reader has no rows (an empty folder, no match, a failed or first load): there is nothing to choose, so the empty reader
   * only names itself, quietly; the list's own state says what is going on (and carries Edgar where one belongs), instead of a second Edgar and
   * a hint pointing at a list with nothing in it. */
  listEmpty?: boolean;
  /** The open message could not be loaded: the reader says so and offers `onRetry` (Try again). */
  loadFailed?: boolean;
  onRetry?: () => void;
  /** The signed-in person's own address: a message sent to it alone says 'to me' (the address is in the recipients' disclosure). */
  selfAddress?: string;
  compact?: boolean;
}

/** A message on screen with its files. */
interface Shown {
  message: Message;
  attachments: Attachment[];
}

const EMPTY_FILES: Attachment[] = [];

/**
 * How long the reader keeps the last message on screen while the next one loads before it shows the skeleton (J2-01, research/02 M13: a
 * load under 300 ms shows no skeleton at all, so stepping through the list never flashes grey bars).
 */
const SKELETON_GRACE_MS = 300;

/** Download all (J6-43): the pause between two files, so the browser takes each one. */
const DOWNLOAD_GAP_MS = 400;

const hasText = (value: string | null | undefined): value is string => value !== null && value !== undefined && value !== '';

/** The Snooze button asks for the look of the other toolbar buttons; they are styled by class (`.rd-bar` in reader.css), so there is nothing to add. */
const NO_STYLE: React.CSSProperties = {};

interface DownloadLinkProps {
  href: string;
  /** The name the browser saves the file under. */
  download: string;
  label: string;
  children: React.ReactNode;
}

/**
 * A plain attachment's card, which is its download: a link (so the browser saves the file itself) named "<type>, <name>, <size>, download"
 * (what the card shows, 2.5.3), with that name as its tooltip too (a long name is cut on the card).
 */
const DownloadLink: React.FC<DownloadLinkProps> = ({ href, download, label, children }) => {
  const ref = React.useRef<HTMLAnchorElement | null>(null);
  const [tip, setTip] = React.useState(false);
  return (
    <>
      <a
        ref={ref}
        href={href}
        download={download}
        aria-label={label}
        className="rd-file"
        onPointerEnter={(event) => setTip(event.pointerType === 'mouse')}
        onPointerLeave={() => setTip(false)}
        onPointerDown={() => setTip(false)}
        onFocus={(event) => setTip(event.currentTarget.matches(':focus-visible'))}
        onBlur={() => setTip(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            setTip(false);
          }
        }}
      >
        {children}
      </a>
      <Tooltip open={tip} text={label} anchorRef={ref} />
    </>
  );
};

/**
 * Ref for a line of text cut with an ellipsis, and whether it is cut now (its text is wider than its box): null until it is measured, kept
 * current while the line resizes, and measured again when `text` (what the line shows) changes. An open line (white-space: normal, it wraps)
 * is not measured, so opening it never takes away the control that closes it.
 */
function useCutLine(text: string): [(element: HTMLElement | null) => (() => void) | undefined, boolean | null] {
  const [cut, setCut] = React.useState<boolean | null>(null);
  const ref = React.useCallback(
    (element: HTMLElement | null) => {
      if (element === null) {
        return;
      }
      const measure = () => {
        if (window.getComputedStyle(element).whiteSpace === 'nowrap') {
          setCut(text !== '' && element.scrollWidth > element.clientWidth);
        }
      };
      // Measured as soon as it is attached, before the first paint.
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => {
        observer.disconnect();
        setCut(null);
      };
    },
    [text]
  );
  return [ref, cut];
}

/**
 * An address shown whole (the recipients are open): it may wrap after its @ and before a dot (a <wbr> there), never inside a name. Each
 * piece is a nowrap span, as a hyphen inside a name ('riverside-clinic') would otherwise be a break of its own.
 */
function wrappableAddress(address: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  for (const part of address.replaceAll('@', '@\n').replaceAll('.', '\n.').split('\n')) {
    if (nodes.length > 0) {
      nodes.push(<wbr key={nodes.length} />);
    }
    nodes.push(
      <span key={nodes.length} className="rd-addr-part">
        {part}
      </span>
    );
  }
  return nodes;
}

/** The More button of the phone's bottom bar (it opens a ui Menu): drawn by the Menu with its trigger props, the icon over a short word. */
const moreTrigger = (label: string, short: string, iconSize: number) =>
  function MoreTrigger(props: MenuTriggerProps): React.ReactElement {
    return (
      <button type="button" aria-label={label} className="rd-tab" {...props}>
        <Ellipsis size={iconSize} strokeWidth={1.75} aria-hidden="true" />
        <span aria-hidden="true" className="rd-tab-text">
          {short}
        </span>
      </button>
    );
  };

/** The small menu beside Reply in the header (desktop): Reply all, Forward. */
const replyMenuTrigger = (label: string) =>
  function ReplyMenuTrigger(props: MenuTriggerProps): React.ReactElement {
    return (
      <IconButton label={label} size="sm" className="rd-reply-more" {...props}>
        <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />
      </IconButton>
    );
  };

/** One move of the toolbar: what it says, its icon, what it does. */
interface Move {
  label: string;
  icon: LucideIcon;
  run: () => void;
}

/** The actions of the desktop toolbar that may show their words. */
type ActionId = 'archive' | 'main' | 'other' | 'delete' | 'unread' | 'snooze' | 'label';

/**
 * The order in which the actions get their words when the pane has room (J4-18, J6-09): the frequent triage first (Archive, Move to Trash,
 * Snooze, Mark unread, Labels), the rare Move to Spam last. Mark unread comes before Labels (J4-18): its envelope alone says less, and Labels
 * opens a titled picker. In Trash and Spam: Move to Inbox (the way back) and Delete forever (the one that cannot be undone, named in words as
 * soon as there is room) first.
 */
function wordPriority(inBin: boolean, canSnooze: boolean, inSpam = false): ActionId[] {
  if (inSpam) {
    // J4-32: in Spam, Move to Trash carries the same trash can as Delete forever (J3-16): it says its words right after Move to Inbox, so
    // the reversible move never reads as the permanent one.
    return ['main', 'other', 'delete', 'archive', 'unread', 'label'];
  }
  if (inBin) {
    return ['main', 'delete', 'archive', 'unread', 'label', 'other'];
  }
  return canSnooze ? ['archive', 'main', 'snooze', 'unread', 'label', 'other'] : ['archive', 'main', 'unread', 'label', 'other'];
}

/** The word of the Labels action (its catalogue key): it puts labels on and takes them off (J4-42). */
const LABELS: MessageKey = 'reader.labels';

const widthCache = new Map<string, number[] | null>();

/**
 * The widths of the toolbar's words (`words`, one a line) in the toolbar's face, measured once per set of words and per font load (`epoch`
 * goes up when the fonts are in: a fallback face has other widths). Null where nothing can measure (the server).
 */
function measuredWidths(words: string, epoch: number): number[] | null {
  if (typeof document === 'undefined' || epoch < 0) {
    return null;
  }
  const family = getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || 'sans-serif';
  const key = `${epoch}\n${family}\n${words}`;
  if (!widthCache.has(key)) {
    widthCache.set(key, wordWidths(words.split('\n'), family));
  }
  return widthCache.get(key) ?? null;
}

/** The skeleton of a message that is on its way: the head (subject, sender) and a few lines of text, in the place they will take. */
const ReaderSkeleton: React.FC<{ compact: boolean; grace: boolean }> = ({ compact, grace }) => {
  const tr = useT();
  return (
    // `grace`: nothing was on screen before, so the skeleton itself waits (300 ms, reader.css) before it fades in; a load under that shows none.
    <div className="rd-page rd-skel" data-compact={compact} data-grace={grace ? 'true' : undefined} role="status">
      <VisuallyHidden>{tr('reader.loading_message')}</VisuallyHidden>
      <Skeleton width="64%" height={26} />
      <div className="rd-skel-sender">
        <Skeleton circle width={40} height={40} />
        <div className="rd-skel-who">
          <Skeleton width="40%" height={14} />
          <Skeleton width="56%" height={12} />
        </div>
      </div>
      <div className="rd-skel-text">
        <Skeleton width="96%" height={12} />
        <Skeleton width="100%" height={12} />
        <Skeleton width="88%" height={12} />
        <Skeleton width="72%" height={12} />
      </div>
    </div>
  );
};

export const MessageView: React.FC<MessageViewProps> = ({
  t,
  message: openMessage,
  attachments: openAttachments,
  isLoading,
  labels,
  onReply,
  onReplyAll,
  onForward,
  onToggleStar,
  onArchive,
  onTrash,
  onSpam,
  onRestore,
  onDeleteForever,
  onMarkUnread,
  onSnooze,
  onUnsnooze,
  onToggleLabel,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  position,
  onBack,
  onNotice,
  listEmpty = false,
  loadFailed = false,
  onRetry,
  selfAddress,
  compact = false
}) => {
  const tr = useT();
  // J2-01: the last message that was on screen stays there while the next one loads (no flash of grey bars on Older / Newer / j / k); the
  // skeleton only comes after SKELETON_GRACE_MS, and even then the toolbar stays where it is. Adjusted while rendering: the props are what
  // it follows.
  const [kept, setKept] = React.useState<Shown | null>(null);
  if (openMessage !== null && !isLoading && (kept?.message !== openMessage || kept.attachments !== openAttachments)) {
    setKept({ message: openMessage, attachments: openAttachments });
  }
  if (openMessage === null && !isLoading && kept !== null) {
    setKept(null);
  }
  const [graceOver, setGraceOver] = React.useState(false);
  if (!isLoading && graceOver) {
    setGraceOver(false);
  }
  React.useEffect(() => {
    if (!isLoading) {
      return;
    }
    const timer = window.setTimeout(() => setGraceOver(true), SKELETON_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [isLoading]);
  const shownView: Shown | null = isLoading ? kept : openMessage === null ? null : { message: openMessage, attachments: openAttachments };
  const message = shownView?.message ?? null;
  const attachments = shownView?.attachments ?? EMPTY_FILES;
  // The next message is late: its skeleton replaces the kept one (the toolbar stays, its actions wait).
  const waiting = isLoading && graceOver;

  const downloads = useMailDownloads(message, onNotice);
  const [showHtml, setShowHtml] = React.useState(true);
  const [recipientsOpen, setRecipientsOpen] = React.useState(false);
  // J6-29: the quote that ends a plain-text reply is folded until "Show quoted text".
  const [quoteOpen, setQuoteOpen] = React.useState(false);
  // The phone's label picker opens from the More menu of the bottom bar.
  const [labelsOpen, setLabelsOpen] = React.useState(false);
  const [paneRef, pane] = usePaneMeasure();
  // The reply row is measured on its own: its width is the column's, scrollbar and page margins included.
  const [replyRef, replyRow] = usePaneMeasure();
  const fontsLoaded = useFontsLoaded();
  // J6-31: the toolbar's tooltips name the single key of each action (lib/shortcuts.ts) while single-key shortcuts are on.
  const { shortcuts: keysOn } = usePrefs();
  const keyOf = (id: MailShortcut): string | undefined => (keysOn ? shortcutHint(id) : undefined);
  // The sender's address and the recipients are one line each, cut with an ellipsis where they do not fit.
  const [addrRef, addrCut] = useCutLine(message?.from_address ?? '');
  const [rcptRef, rcptCut] = useCutLine(`${message?.to_address ?? ''}\n${message?.cc ?? ''}`);
  const rootRef = React.useRef<HTMLElement | null>(null);
  const pageRef = React.useRef<HTMLDivElement | null>(null);
  const moreRef = React.useRef<HTMLDivElement | null>(null);
  // J4-42: the label chips of the header, and which chip's X takes focus once a label has gone (the next one, else the previous one, else
  // the Labels button; on a phone the reader itself).
  const tagsRef = React.useRef<HTMLDivElement | null>(null);
  const tagFocus = React.useRef<number | null>(null);
  const labelsKey = message?.labels ?? '';
  React.useLayoutEffect(() => {
    const index = tagFocus.current;
    if (index === null) {
      return;
    }
    tagFocus.current = null;
    const buttons = [...(tagsRef.current?.querySelectorAll<HTMLElement>('.ui-chip-x') ?? [])];
    const target =
      buttons.at(index) ??
      (index > 0 ? buttons.at(index - 1) : undefined) ??
      rootRef.current?.querySelector<HTMLElement>('.rd-lm button') ??
      rootRef.current;
    target?.focus({ preventScroll: true });
  }, [labelsKey]);
  // J6-43: Download all of a plain message is running (its files are saved one after the other).
  const [savingAll, setSavingAll] = React.useState(false);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the HTML/plain toggle, the recipients and the label picker reset whenever another message is shown
    setShowHtml(true);
    setRecipientsOpen(false);
    setQuoteOpen(false);
    setLabelsOpen(false);
  }, [message?.id]);

  // M9: what was shown last (its id and its place in the list), to tell the direction of a move to the next or previous message.
  const latest = React.useRef({ position, compact });
  React.useLayoutEffect(() => {
    latest.current = { position, compact };
  });
  const shown = React.useRef<{ id: string; index: number | null } | null>(null);
  const messageId = message?.id ?? null;
  React.useLayoutEffect(() => {
    if (messageId === null) {
      return;
    }
    const before = shown.current;
    const index = positionIndex(latest.current.position);
    shown.current = { id: messageId, index };
    const page = pageRef.current;
    if (page === null || before?.id === messageId) {
      return;
    }
    if (latest.current.compact) {
      // The phone opens the reader with the shell's push (M9, lib/shellMotion): that is the motion, the reader adds none of its own.
      return;
    }
    if (before !== null) {
      // Played once the new message is rendered in place of the old one (never a blank page while it renders).
      nextMessageIn(page, index !== null && before.index !== null && index < before.index ? -1 : 1);
    }
  }, [messageId]);

  // Focus is never lost to the page: a toolbar button that goes, or waits, while the next message loads (Archive, pressed with the keyboard)
  // leaves its focus on the reader itself, and the same button takes it back when the message is there.
  const keptTool = React.useRef<number | null>(null);
  React.useLayoutEffect(() => {
    const root = rootRef.current;
    if (root === null) {
      return;
    }
    if (isLoading) {
      if (keptTool.current !== null && (document.activeElement === document.body || document.activeElement === null)) {
        root.focus({ preventScroll: true });
      }
      return;
    }
    const index = keptTool.current;
    if (index !== null && document.activeElement === root) {
      const tool = [...root.querySelectorAll<HTMLButtonElement>('.rd-bar button')].at(index);
      if (tool !== undefined && !tool.disabled) {
        tool.focus({ preventScroll: true });
      }
    }
  }, [isLoading, messageId, waiting]);
  const rememberTool = (event: React.FocusEvent<HTMLElement>) => {
    const tools = [...event.currentTarget.querySelectorAll<HTMLElement>('.rd-bar button')];
    const index = tools.indexOf(event.target);
    if (index !== -1) {
      keptTool.current = index;
    } else if (event.target !== event.currentTarget) {
      keptTool.current = null;
    }
  };
  const setRoot = (element: HTMLElement | null) => {
    rootRef.current = element;
    return paneRef(element);
  };

  const inTrash = message?.folder === 'trash';
  const inSpam = message?.folder === 'spam';
  const inBin = inTrash || inSpam;
  // Drafts, sent mail, Trash and Spam are not in the inbox flow, so there is nothing to snooze. In Trash and Spam the bar also gains
  // Move to Inbox and Delete forever: dropping Snooze keeps it at the 8 buttons the density arithmetic (reader/barDensity.ts) and a 320px phone allow.
  const canSnooze = message !== null && message.folder !== 'drafts' && message.folder !== 'sent' && !inBin;
  const snoozed = message?.folder === 'snoozed';
  const priority = wordPriority(inBin, canSnooze, inSpam);
  const wordKeys: Record<ActionId, MessageKey> = {
    archive: 'action.archive',
    main: inBin ? 'action.move_to_inbox' : 'action.move_to_trash',
    other: inSpam ? 'action.move_to_trash' : 'action.move_to_spam',
    delete: 'action.delete_forever',
    // J4-18: "Mark unread" beside the envelope (its menus keep "Mark as unread"): short enough to have its words at 1440.
    unread: 'reader.mark_unread',
    snooze: snoozed ? 'action.unsnooze' : 'action.snooze',
    label: LABELS
  };
  // The words of the actions in the order they get them, measured in the toolbar's face, again once the fonts have loaded.
  const priorityWords = priority.map((id) => tr(wordKeys[id])).join('\n');
  const widths = measuredWidths(priorityWords, fontsLoaded);

  // Phone: one bar on top of the message (the app's own bar is gone while it is open): Back, the message's place in the list, Newer, Older.
  // It stands in every state of the reader (loading, failed), so Back is always there.
  const phoneTop = compact ? (
    <Toolbar aria-label={tr('reader.nav_label')} className="rd-top">
      {onBack ? (
        <ToolButton
          label={tr('reader.back_to_list')}
          icon={<ChevronLeft size={22} strokeWidth={1.75} aria-hidden="true" />}
          size="md"
          onClick={onBack}
        />
      ) : null}
      <span className="rd-pos">{position}</span>
      <ToolButton
        label={tr('reader.newer_message')}
        icon={<ChevronUp size={20} strokeWidth={1.75} aria-hidden="true" />}
        size="md"
        onClick={onPrev}
        disabled={!hasPrev}
      />
      <ToolButton
        label={tr('reader.older_message')}
        icon={<ChevronDown size={20} strokeWidth={1.75} aria-hidden="true" />}
        size="md"
        onClick={onNext}
        disabled={!hasNext}
      />
    </Toolbar>
  ) : null;

  if (message === null && isLoading) {
    // Nothing was on screen before (the first message opened): the skeleton, after the same grace, under the toolbar's band.
    return (
      <article ref={setRoot} tabIndex={-1} aria-busy="true" className="rd-root" data-state="loading" data-compact={compact}>
        {/* The toolbar's band, empty, so the message does not push its head down when it arrives (desktop: the bar is above it). */}
        {compact ? phoneTop : <div aria-hidden="true" className="rd-bar rd-bar-skel" />}
        <ReaderSkeleton compact={compact} grace />
      </article>
    );
  }

  if (message === null) {
    // J3-17: the empty pane says what it is in the list's own type pair (heading and line), centred on the room under the pane header the
    // list shares (desktop: an empty band of the toolbar's height, without its hairline), so both empty states sit on one axis.
    return (
      <article ref={setRoot} tabIndex={-1} className="rd-root" data-state="empty" data-compact={compact}>
        {compact ? phoneTop : <div aria-hidden="true" className="rd-bar rd-bar-skel" data-blank="true" />}
        <div className="rd-state">
          {loadFailed ? (
            <EmptyState
              title={tr('reader.load_failed')}
              description={tr('list.load_failed_hint')}
              action={
                onRetry === undefined ? undefined : (
                  <Button size="sm" onClick={onRetry}>
                    {tr('common.retry')}
                  </Button>
                )
              }
            />
          ) : listEmpty ? (
            <EmptyState title={tr('reader.none_selected')} description={tr('reader.none_selected_empty_hint')} />
          ) : (
            <EmptyState illustration title={tr('reader.none_selected')} description={tr('reader.none_selected_hint')} />
          )}
        </div>
      </article>
    );
  }

  const messageLabels = labelsOf(message);
  const paragraphs = bodyParagraphs(message, !showHtml);
  // J6-29: a reply's trailing quote (attribution + '>' lines, or an Outlook header block), folded under the new words.
  const folded = paragraphs.length > 0 ? splitQuote(paragraphs.join('\n\n')) : null;
  const ownParagraphs = folded === null ? paragraphs : folded.body.split(/\n{2,}/).filter((p) => p.trim() !== '');
  const starred = message.is_starred === 1;
  const sender = displayName(message);
  const snoozeUntil = snoozed && typeof message.snoozed_until === 'number' ? message.snoozed_until : null;
  const layout = compact ? null : alignedLayout(pane.width, pane.coarse, widths);
  const density: BarDensity = layout === null ? 'phone' : layout.density;
  // J3-36: the first and last glyphs of the bar on the reading column's content edges, with what room the layout leaves (barDensity.ts).
  const align = layout === null || pane.width === null ? null : barAlignment(pane.width, pane.coarse, layout, widths ?? []);
  // The actions that show their words: the first ones of `priority`, as many as the pane has room for.
  const worded = new Set(priority.slice(0, layout?.words ?? 0));
  const showCount = !compact && density !== 'tight';
  const iconSize = compact ? 20 : 16;
  const sealed = message.is_e2e === 1 && message.mail_state === 'ready';
  const unverified = arrivedUnverified(message);
  const fullRecipients = hasText(message.cc)
    ? tr('reader.to_cc_line', { to: message.to_address, cc: message.cc })
    : tr('reader.to_line', { to: message.to_address });
  // Sent to the signed-in address alone: the line says 'to me', and the address is in the disclosure, where the whole list always is.
  const self = selfAddress === undefined ? '' : bareAddress(selfAddress);
  const toEntries = splitAddressList(message.to_address);
  const toMe = self !== '' && !hasText(message.cc) && toEntries.length === 1 && bareAddress(toEntries[0]) === self;
  const recipients = toMe && !recipientsOpen ? tr('reader.to_me') : fullRecipients;
  // The recipients open in place (a Disclosure) only when there is something to show: the line, or the sender's address, is cut, or it says
  // 'to me'. Until the lines are measured (the first render, the server), a line of more than one recipient is taken as cut.
  const manyRecipients = hasText(message.cc) || toEntries.length > 1;
  const offerAll = recipientsOpen || toMe || addrCut === true || (rcptCut ?? manyRecipients);
  const recipientsLine = (
    <span ref={rcptRef} className="rd-rcpt-text">
      {recipients}
    </span>
  );
  // On a desktop the row of Reply, Reply all and Forward takes smaller buttons, then drops their icons, before it would wrap.
  const reply = compact ? 'full' : replyDensity(replyRow.width);
  // A message the browser could not open has no content to forward.
  const canForward = !isUnreadable(message.mail_state);
  const replyActions = [
    { label: tr('action.reply'), icon: Reply, action: () => onReply(message) },
    { label: tr('action.reply_all'), icon: ReplyAll, action: () => onReplyAll(message) },
    ...(canForward ? [{ label: tr('action.forward'), icon: Forward, action: () => onForward(message) }] : [])
  ];

  // The moves, by folder: the main one (Move to Trash; Move to Inbox in Trash and Spam), Delete forever (Trash and Spam), and the other bin
  // (Move to Spam; Move to Trash in Spam). Each folder hides the button of its own place.
  const archive: Move = { label: tr('action.archive'), icon: Archive, run: () => onArchive(message) };
  const toTrash: Move = { label: tr('action.move_to_trash'), icon: Trash2, run: () => onTrash(message) };
  const toSpam: Move = { label: tr('action.move_to_spam'), icon: Ban, run: () => onSpam(message) };
  const toInbox: Move = { label: tr('action.move_to_inbox'), icon: Inbox, run: () => onRestore(message) };
  const mainMove = inBin ? toInbox : toTrash;
  const otherMove = inSpam ? toTrash : toSpam;
  // Delete forever has the trash can of every other delete (J3-16), in the danger colour and named in words as soon as there is room.
  const deleteForever: Move = { label: tr('action.delete_forever'), icon: Trash2, run: () => onDeleteForever(message) };
  // One envelope meaning everywhere (the list's quick actions too): Mark as unread shows the closed envelope it leaves, Mark as read the open one.
  const markUnread: Move = { label: tr('action.mark_unread'), icon: Mail, run: () => onMarkUnread(message) };
  // Its words in the toolbar (J4-18): the shorter "Mark unread", which is its accessible name too (what is seen is what is said).
  const unreadWord: Move = { ...markUnread, label: tr('reader.mark_unread') };

  const tool = (
    move: Move,
    options: { labelled?: boolean; danger?: boolean; size?: 'sm' | 'md'; className?: string; short?: string; key?: MailShortcut } = {}
  ) => {
    const Icon = move.icon;
    return (
      <ToolButton
        label={move.label}
        icon={<Icon size={iconSize} strokeWidth={1.75} aria-hidden="true" />}
        labelled={options.labelled === true}
        danger={options.danger === true}
        size={options.size ?? 'sm'}
        className={options.className}
        short={options.short}
        // J6-31: the single key that does the same, in the tooltip ("Archive (E)"), while single-key shortcuts are on.
        shortcut={options.key === undefined ? undefined : keyOf(options.key)}
        // The next message is late and its skeleton is on screen: the actions wait for it (they would act on a message nobody sees).
        disabled={waiting}
        onClick={move.run}
      />
    );
  };

  const snoozeButton = (options: { short?: string; labelled?: boolean }) => (
    <SnoozeMenu
      t={t}
      buttonStyle={NO_STYLE}
      iconSize={iconSize}
      size={compact ? 'md' : 'sm'}
      labelled={options.labelled === true}
      short={options.short}
      shortcut={compact ? undefined : keyOf('snooze')}
      disabled={waiting}
      snoozed={snoozed}
      onSnooze={(until) => onSnooze(message, until)}
      onUnsnooze={() => onUnsnooze(message)}
    />
  );

  // J6-43: every file of the message. An encrypted one is opened here and saved (useMailDownloads), a plain one is a link the browser saves
  // itself: one after the other, a moment apart, as a browser takes one download at a time from a page.
  const downloadAll = () => {
    if (message.enc_fmt === 1) {
      downloads.saveAll(attachments);
      return;
    }
    setSavingAll(true);
    void (async () => {
      for (const file of attachments) {
        const link = document.createElement('a');
        link.href = `/api/attachments/${file.id}`;
        link.download = safeFileName(file.filename, '');
        // Not .append(): @cloudflare/workers-types overrides Element.append with the HTMLRewriter signature.
        // eslint-disable-next-line unicorn/prefer-dom-node-append -- see above
        document.body.appendChild(link);
        link.click();
        link.remove();
        await new Promise((resolve) => {
          window.setTimeout(resolve, DOWNLOAD_GAP_MS);
        });
      }
      setSavingAll(false);
    })();
  };

  // The phone's bottom bar: Archive, the main move, Reply, then Snooze (Delete forever in Trash and Spam, Mark as unread where nothing can be
  // snoozed), and More with the rest: no action of the desktop bar is lost on a 320px phone (reader/actions.ts). Each button has its short
  // word under its icon (J5-15), so Archive and Move to Trash are told apart at a glance.
  const phone = phoneBar(message.folder);
  const fourth = phone.fourth;
  const OtherIcon = otherMove.icon;
  const moreChoices: Record<PhoneMoreItem, MenuItem> = {
    'other-move': {
      id: 'other-move',
      label: otherMove.label,
      icon: <OtherIcon size={16} strokeWidth={1.75} aria-hidden="true" />,
      onSelect: otherMove.run
    },
    unread: {
      id: 'unread',
      label: markUnread.label,
      icon: <Mail size={16} strokeWidth={1.75} aria-hidden="true" />,
      onSelect: markUnread.run
    },
    label: {
      id: 'label',
      label: tr('reader.labels'),
      icon: <Tag size={16} strokeWidth={1.75} aria-hidden="true" />,
      onSelect: () => setLabelsOpen(true)
    }
  };
  const moreItems = phone.more.map((item) => moreChoices[item]);

  // Phone: the bottom bar's five buttons share one row (nm-bar, index.css), down to a 320px phone; it never wraps. On desktop the pane's
  // width picks the density (reader/barDensity.ts): words beside the icons of the most used actions where they fit, icons with tooltips
  // below; the arithmetic keeps the bar to one row. Groups: Archive | Move to Trash, Move to Spam | Mark as unread, Snooze, Label; in Trash
  // and Spam: Move to Inbox, Archive, the other move | Mark as unread, Label | Delete forever (last, on its own: J4-03).
  const actionBar = (
    <Toolbar
      aria-label={tr('reader.actions_label')}
      className={cx('rd-bar', compact ? 'nm-bar' : 'nm-bar-d')}
      data-density={density}
      data-compact={compact}
      style={align === null ? undefined : { paddingInlineStart: align.start, paddingInlineEnd: align.end }}
    >
      {compact ? (
        <>
          {tool(archive, { size: 'md', short: tr('action.archive') })}
          {tool(mainMove, { size: 'md', short: inBin ? tr('reader.bar_inbox') : tr('reader.bar_trash') })}
          {tool({ label: tr('action.reply'), icon: Reply, run: () => onReply(message) }, { size: 'md', short: tr('action.reply') })}
          {fourth === 'delete' ? tool(deleteForever, { size: 'md', danger: true, short: tr('reader.bar_delete') }) : null}
          {fourth === 'snooze' ? snoozeButton({ short: snoozed ? tr('action.unsnooze') : tr('action.snooze') }) : null}
          {fourth === 'unread' ? tool(markUnread, { size: 'md', short: tr('reader.bar_unread') }) : null}
          <div ref={moreRef} className="rd-more">
            <Menu
              items={moreItems}
              align="end"
              label={tr('reader.more_actions')}
              trigger={moreTrigger(tr('reader.more_actions'), tr('reader.bar_more'), iconSize)}
            />
          </div>
        </>
      ) : inBin ? (
        <>
          {tool(toInbox, { labelled: worded.has('main') })}
          {tool(archive, { labelled: worded.has('archive'), className: 'rd-move', key: 'archive' })}
          {/* J4-32: in Spam, Move to Trash shows only with its words: as a bare grey can beside the red can of Delete forever it would
              read as the same action (the # key, Delete forever and Empty Spam still cover it where the bar has no room). */}
          {inSpam && !worded.has('other')
            ? null
            : tool(otherMove, { labelled: worded.has('other'), className: 'rd-move', key: inSpam ? 'trash' : undefined })}
          <Divider orientation="vertical" className="rd-sep" />
          {tool(worded.has('unread') ? unreadWord : markUnread, { labelled: worded.has('unread'), key: 'unread' })}
          <LabelMenu
            t={t}
            message={message}
            labels={labels}
            onToggleLabel={onToggleLabel}
            iconSize={iconSize}
            labelled={worded.has('label')}
            disabled={waiting}
            shortcut={keyOf('label')}
          />
          <Divider orientation="vertical" className="rd-sep" />
          {tool(deleteForever, { labelled: worded.has('delete'), danger: true })}
        </>
      ) : (
        <>
          {tool(archive, { labelled: worded.has('archive'), key: 'archive' })}
          <Divider orientation="vertical" className="rd-sep" />
          {tool(toTrash, { labelled: worded.has('main'), className: 'rd-move', key: 'trash' })}
          {tool(toSpam, { labelled: worded.has('other'), className: 'rd-move' })}
          <Divider orientation="vertical" className="rd-sep" />
          {tool(worded.has('unread') ? unreadWord : markUnread, { labelled: worded.has('unread'), key: 'unread' })}
          {canSnooze ? snoozeButton({ labelled: worded.has('snooze') }) : null}
          <LabelMenu
            t={t}
            message={message}
            labels={labels}
            onToggleLabel={onToggleLabel}
            iconSize={iconSize}
            labelled={worded.has('label')}
            disabled={waiting}
            shortcut={keyOf('label')}
          />
        </>
      )}
      {compact ? null : (
        <>
          {showCount ? <span className="rd-count">{position}</span> : <span className="rd-spacer" />}
          <ToolButton
            label={tr('reader.newer_message')}
            icon={<ChevronLeft size={iconSize} strokeWidth={1.75} aria-hidden="true" />}
            shortcut={keyOf('previous')}
            onClick={onPrev}
            disabled={!hasPrev}
          />
          <ToolButton
            label={tr('reader.older_message')}
            icon={<ChevronRight size={iconSize} strokeWidth={1.75} aria-hidden="true" />}
            shortcut={keyOf('next')}
            onClick={onNext}
            disabled={!hasNext}
          />
        </>
      )}
    </Toolbar>
  );

  // Desktop: Reply in the header too (J6-10), beside the star, with Reply all and Forward in its small menu: the primary action of a long or
  // HTML message is never only below the fold. The row under the message stays the primary place.
  const replyMenu: MenuItem[] = [
    {
      id: 'reply-all',
      label: tr('action.reply_all'),
      icon: <ReplyAll size={16} strokeWidth={1.75} aria-hidden="true" />,
      onSelect: () => onReplyAll(message)
    },
    ...(canForward
      ? [
          {
            id: 'forward',
            label: tr('action.forward'),
            icon: <Forward size={16} strokeWidth={1.75} aria-hidden="true" />,
            onSelect: () => onForward(message)
          }
        ]
      : [])
  ];

  const page = (
    <div ref={pageRef} className="rd-page" data-compact={compact}>
      <header className="rd-head">
        <h2 id="msg-subject" className="rd-subject">
          {subjectOf(message, tr('reader.no_subject'))}
        </h2>
        {messageLabels.length > 0 || snoozeUntil !== null ? (
          <div ref={tagsRef} className="rd-tags">
            {snoozeUntil === null ? null : <SnoozeChip t={t} until={snoozeUntil} />}
            {/* J4-42: each label chip takes itself off with its X ("Remove label Travel", 44 px on touch), says so, and hands focus on. */}
            {messageLabels.map((label, index) => (
              <Chip
                key={label}
                colors={getLabelChip(label, t)}
                className="rd-tag"
                onRemove={() => {
                  tagFocus.current = index;
                  onToggleLabel(message, label);
                  announce(tr('reader.label_removed', { label }));
                }}
                removeLabel={tr('reader.remove_label', { label })}
              >
                {label}
              </Chip>
            ))}
          </div>
        ) : null}

        <div className="rd-sender">
          <Avatar name={sender} size="lg" />
          <div className="rd-who">
            <div className="rd-line">
              <span className="rd-from">
                <span className="rd-name">{sender}</span>
                {/* A sender without a display name is already shown as the address. */}
                {sender === message.from_address ? null : (
                  <span ref={addrRef} className="rd-addr">
                    {recipientsOpen ? wrappableAddress(message.from_address) : message.from_address}
                  </span>
                )}
                {/* The trust chips belong to the sender: on its line, after the address (they wrap under it where the line is short, and never
                    cover it: their touch box takes no more of the line than the chip). */}
                {sealed || unverified ? (
                  <span className="rd-prov">
                    {sealed ? <E2eBadge t={t} sheet={compact} /> : null}
                    {unverified ? <UnverifiedChip t={t} sheet={compact} onSpam={inSpam ? undefined : () => onSpam(message)} /> : null}
                  </span>
                ) : null}
              </span>
            </div>
            {/* J3-21: the date has ONE place in every state and at every width: first on the line under the sender, before the recipients
                (a trust chip wraps on the sender's line and never moves it; paging j/k keeps it still). */}
            <div className="rd-meta">
              <span className="rd-date">{formatFullDate(message.created_at)}</span>
              {offerAll ? (
                <Disclosure className="rd-rcpt" open={recipientsOpen} onOpenChange={setRecipientsOpen}>
                  {recipientsLine}
                </Disclosure>
              ) : (
                <p className="rd-rcpt">{recipientsLine}</p>
              )}
            </div>
          </div>
          <div className="rd-tools">
            {compact ? null : (
              <>
                <IconButton label={tr('action.reply')} size="sm" shortcut={keyOf('reply')} onClick={() => onReply(message)}>
                  <Reply size={16} strokeWidth={1.75} aria-hidden="true" />
                </IconButton>
                <Menu
                  items={replyMenu}
                  align="end"
                  label={tr('reader.reply_options')}
                  trigger={replyMenuTrigger(tr('reader.reply_options'))}
                />
              </>
            )}
            <IconButton
              label={tr('action.star')}
              size="sm"
              pressed={starred}
              shortcut={keyOf('star')}
              className="rd-star"
              onClick={() => onToggleStar(message)}
            >
              <Star size={16} strokeWidth={1.75} aria-hidden="true" />
            </IconButton>
          </div>
        </div>
      </header>

      {/* J6-42: a message in Spam says where it is and what to be careful with, quietly, with the way back beside it. */}
      {inSpam ? (
        <div className="rd-spam">
          <ShieldAlert size={16} strokeWidth={1.75} aria-hidden="true" />
          <p className="rd-spam-text">{tr('reader.spam_notice')}</p>
          <Button size="sm" leadingIcon={<Inbox size={16} strokeWidth={1.75} aria-hidden="true" />} onClick={toInbox.run}>
            {tr('action.move_to_inbox')}
          </Button>
        </div>
      ) : null}

      {isUnreadable(message.mail_state) ? (
        <div data-mail-state={message.mail_state} className="rd-note">
          <Banner>{tr(NOTE_KEYS[message.mail_state])}</Banner>
        </div>
      ) : null}

      {hasText(message.body_html) && hasText(message.body_text) ? (
        <SegmentedControl
          className="rd-view"
          label={tr('reader.view_label')}
          options={[
            { value: 'html', label: tr('reader.view_html') },
            { value: 'plain', label: tr('reader.view_plain') }
          ]}
          value={showHtml ? 'html' : 'plain'}
          onChange={(view) => setShowHtml(view === 'html')}
        />
      ) : null}

      {hasText(message.body_html) && showHtml ? (
        <MailFrame
          key={message.id}
          html={message.body_html}
          t={t}
          loadEmbedded={
            message.enc_fmt === 1 ? (references) => loadEmbeddedImages(message, attachments, references, getUnlockedKey()) : undefined
          }
        />
      ) : (
        <div className="rd-text" data-compact={compact}>
          {ownParagraphs.map((p, i) => (
            // eslint-disable-next-line react/no-array-index-key -- paragraphs are plain strings that can repeat and are never reordered
            <p key={i}>{p}</p>
          ))}
          {folded === null ? null : (
            <div className="rd-quote">
              <Button
                variant="ghost"
                size="sm"
                className="rd-quote-btn"
                aria-expanded={quoteOpen}
                leadingIcon={<Ellipsis size={16} strokeWidth={1.75} aria-hidden="true" />}
                onClick={() => setQuoteOpen((open) => !open)}
              >
                {quoteOpen ? tr('reader.hide_quoted') : tr('reader.show_quoted')}
              </Button>
              {quoteOpen ? (
                <blockquote className="rd-quoted">
                  {folded.attribution === null ? null : <p className="rd-quote-attr">{folded.attribution}</p>}
                  <QuoteNodes nodes={quoteBlocks(folded.quote)} />
                </blockquote>
              ) : null}
            </div>
          )}
        </div>
      )}

      {attachments.length > 0 ? (
        <section aria-labelledby="rd-files-title" className="rd-files">
          <div className="rd-files-head">
            <h3 id="rd-files-title" className="rd-files-title">
              <Paperclip size={14} strokeWidth={1.75} aria-hidden="true" />
              {/* One file: its card shows its size, so the heading only counts it; several: the count and their total. */}
              {attachments.length === 1
                ? tr('reader.one_attachment')
                : tr('reader.attachments_summary', {
                    count: attachments.length,
                    size: formatBytes(attachments.reduce((sum, a) => sum + a.size, 0))
                  })}
            </h3>
            {/* J6-43: two files or more: all of them, saved one after the other (no archive format, no new dependency). */}
            {attachments.length > 1 ? (
              <Button
                variant="ghost"
                size="sm"
                className="rd-dl-all"
                loading={savingAll || downloads.busy === 'all'}
                disabled={downloads.busy !== null || savingAll}
                leadingIcon={<Download size={16} strokeWidth={1.75} aria-hidden="true" />}
                onClick={downloadAll}
              >
                {tr('reader.download_all')}
              </Button>
            ) : null}
          </div>
          <ul role="list" className="rd-file-list">
            {attachments.map((att) => {
              // PX-7: the name the sender gave is shown the way it is saved (no direction controls: "photo\u202Egpj.exe" would read
              // "photoexe.jpg"), and the type tile is read from that same name.
              const name = safeFileName(att.filename, tr('list.attachment'));
              const type = fileTypeOf(name);
              const fetching = downloads.busy === att.id;
              const size = formatBytes(att.size);
              // The name starts with what the card shows, in its order (type tile, name, size), then the action (2.5.3: checkers read the tile too).
              const downloadLabel = tr('reader.download_file', { name, type, size });
              const card = (
                <>
                  {/* The type tile: one look with the compose's file chips (FileTypeTile, J3-15). */}
                  <FileTypeTile type={type} t={t} />
                  {/* Spaces between the parts (the flex row ignores them): the card's text reads "PDF name size", not "PDFname". */}{' '}
                  <span className="rd-file-main">
                    <span className="rd-file-name">{name}</span> <span className="rd-file-size">{size}</span>
                  </span>
                  <span aria-hidden="true" className="rd-file-dl">
                    {fetching ? <Spinner size={16} decorative /> : <Download size={16} strokeWidth={1.75} />}
                  </span>
                </>
              );
              // The whole card is the download (a link for a plain file; a button for an encrypted one, which is fetched and opened
              // here, then saved: a plain link would save the encrypted bytes).
              return (
                <li key={att.id} className="rd-file-item">
                  {message.enc_fmt === 1 ? (
                    <button
                      type="button"
                      className="rd-file"
                      aria-label={downloadLabel}
                      aria-busy={fetching}
                      disabled={downloads.busy !== null}
                      onClick={() => downloads.saveAttachment(att)}
                    >
                      {card}
                    </button>
                  ) : (
                    <DownloadLink href={`/api/attachments/${att.id}`} download={safeFileName(att.filename, '')} label={downloadLabel}>
                      {card}
                    </DownloadLink>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {/* Reply is the one primary action of the reader; Reply all and Forward are the secondary ones beside it. J6-42: not in Spam, nor for a
          sender nobody verified: there a reply is something to think twice about, so it is a secondary button like the others. */}
      <div ref={replyRef} className="rd-reply" data-compact={compact}>
        {replyActions.map((item, index) => {
          const Icon = item.icon;
          return (
            <Button
              key={item.label}
              variant={index === 0 && !inSpam && !unverified ? 'primary' : 'secondary'}
              size={reply === 'full' ? 'md' : 'sm'}
              onClick={item.action}
              leadingIcon={reply === 'tight' ? undefined : <Icon size={16} strokeWidth={1.75} aria-hidden="true" />}
            >
              {item.label}
            </Button>
          );
        })}
      </div>

      {message.mail_state === 'ready' && hasText(message.r2_key) ? (
        <Button
          variant="ghost"
          size="sm"
          className="rd-raw"
          onClick={downloads.saveRaw}
          disabled={downloads.busy !== null}
          aria-busy={downloads.busy === 'raw'}
          leadingIcon={
            downloads.busy === 'raw' ? <Spinner size={16} decorative /> : <Download size={16} strokeWidth={1.75} aria-hidden="true" />
          }
        >
          {downloads.busy === 'raw' ? tr('common.loading') : tr('mailcrypto.download_raw')}
        </Button>
      ) : null}
      {downloads.error === null ? null : (
        <Banner tone="danger" className="rd-error">
          {downloads.error}
        </Banner>
      )}
    </div>
  );

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the article only follows where focus is (to give it back after a load); its controls are the buttons
    <article
      aria-labelledby={waiting ? undefined : 'msg-subject'}
      aria-busy={isLoading ? true : undefined}
      ref={setRoot}
      tabIndex={-1}
      className="rd-root"
      data-state={isLoading ? 'loading' : undefined}
      data-compact={compact}
      onFocus={rememberTool}
    >
      {compact ? phoneTop : actionBar}

      {/* While the next message loads the last one stays (its heading still names the article); once it is late, its skeleton. */}
      <div className="rd-scroll">{waiting ? <ReaderSkeleton compact={compact} grace={false} /> : page}</div>

      {compact ? actionBar : null}
      {compact ? (
        <LabelPicker
          t={t}
          open={labelsOpen}
          anchorRef={moreRef}
          onClose={() => setLabelsOpen(false)}
          returnFocus={() => moreRef.current?.querySelector('button')?.focus()}
          focusIn
          sheet
          message={message}
          labels={labels}
          onToggleLabel={onToggleLabel}
        />
      ) : null}
    </article>
  );
};
