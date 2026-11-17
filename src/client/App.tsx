import React from 'react';
import { CheckCheck, Menu as MenuIcon, Moon, PenLine, Search, Sun, User, X } from 'lucide-react';
import { Sidebar } from './components/Sidebar';
import {
  MessageList,
  RollingText,
  type MailFilter,
  type RowActions,
  type RowMenuRequest,
  type SearchScope
} from './components/MessageList';
import {
  SelectAllLine,
  SelectionBar,
  type SelectAllPhase,
  type SelectionActions,
  type SelectionMenuRequest
} from './components/SelectionBar';
import { SELECTION_SUMMARY_TITLE_ID, SelectionSummary } from './components/SelectionSummary';
import { MessageView } from './components/MessageView';
import { ComposeModal, type ComposeDraft } from './components/ComposeModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { AuthGate } from './components/auth/AuthGate';
import { LockedMailBanner } from './components/LockedMailBanner';
import { NoticesBanner } from './components/NoticesBanner';
import { SettingsModal, type SettingsSection } from './components/SettingsModal';
import { ShortcutsDialog } from './components/ShortcutsDialog';
import { AdminConsole } from './components/admin/AdminConsole';
import { Toast, type ToastState } from './components/Toast';
import {
  applyTheme,
  avatarHue,
  getTokens,
  storedThemeChoice,
  storeThemeChoice,
  systemPrefersDark,
  watchSystemTheme,
  type ThemeChoice,
  type ThemeTokens
} from './theme';
import { displayName, folderName, formatSender, labelsOf, nonEmpty, replyRedirect, SEARCH_MAX, subjectOf } from './lib/mail';
import { isUnreadable } from './lib/mailcrypto/texts';
import { ApiError, apiPost } from './lib/api';
import { announce } from './lib/announce';
import { useBackStack } from './lib/backStack';
import { useSession } from './lib/auth';
import { useDocumentTitle } from './lib/documentTitle';
import { DraftOpenError, fetchDraft } from './lib/drafts';
import { trapTab } from './lib/focusTrap';
import { fmt, useT, type TFunction } from './lib/i18n';
import {
  useBatchAction,
  useLabels,
  useMarkAllRead,
  useMessageDetail,
  useMessages,
  useStats,
  useUpdateLabels,
  type BatchAction
} from './lib/queries';
import { useRealtime } from './lib/realtime';
import { usePrefs } from './lib/prefs';
import { ownerInitials, useSettings } from './lib/settings';
import { SELECTION_SHORTCUTS, SHOW_SHORTCUTS_EVENT, shortcutOf, type TriageShortcut } from './lib/shortcuts';
import { chunks, extendSelection, keepListed, pageState, toggleAll, toggleOne } from './lib/selection';
import { canResnooze, formatSnoozeUntil } from './lib/snooze';
import { RETURN_SLIDE_DELAY_MS, enterPane, flyAway, flyBack, homeRef, leaveDrawer, leavePane, type PhonePane } from './lib/shellMotion';
import { useCountdown } from './lib/useCountdown';
import {
  Button,
  EmptyState,
  FlightTrail,
  IconButton,
  Kbd,
  TextField,
  VisuallyHidden,
  motionReduced,
  useSwipeToDismiss,
  type FlyHomeOptions,
  type HomingKind
} from './ui';
import { initialsOf, isCjk } from './ui/initials';
import type { Attachment, FolderStats, Message } from './types';
import './components/mailbox.css';

const EMPTY_STATS: FolderStats = {};
const EMPTY_MESSAGES: Message[] = [];
const NO_SELECTION: ReadonlySet<string> = new Set();
const EMPTY_ATTACHMENTS: Attachment[] = [];

// Folders whose rows can be swiped to Archive on mobile (the others are already out of the inbox flow).
const SWIPE_ARCHIVE_FOLDERS = new Set(['inbox', 'starred', 'snoozed']);
// Folders whose rows can be swiped to Trash on mobile (Trash and Spam have their own actions in the reader; a draft opens the compose).
const SWIPE_TRASH_FOLDERS = new Set(['inbox', 'starred', 'snoozed', 'archive', 'sent']);

// `list[index]` is undefined past either end of the list, which the plain index type does not say.
function messageAt(list: Message[], index: number): Message | undefined {
  return list[index];
}

/** The rows a filter chip keeps (All keeps every row). */
function filterRows(messages: Message[], filter: MailFilter): Message[] {
  if (filter === 'unread') {
    return messages.filter((m) => m.is_read === 0);
  }
  if (filter === 'starred') {
    return messages.filter((m) => m.is_starred === 1);
  }
  if (filter === 'attachments') {
    return messages.filter((m) => m.has_attachments === 1);
  }
  return messages;
}

/** Select all in a folder (J6-39) ticks at most this many messages, the most recent: the pages it loads stay in the list. */
const SELECT_ALL_CAP = 500;

/** What a failed request tells the user: no connection (fetch throws a TypeError then), the server's reason, or `fallback` (already translated by the caller). */
function failureText(tr: TFunction, error: unknown, fallback: string): string {
  return error instanceof TypeError ? tr('app.no_connection') : error instanceof Error ? error.message : fallback;
}

/** The id of the region of the mailbox that holds the messages: the list (or, on a phone, the open message). The skip link goes there. */
const MESSAGES_ID = 'mail-messages';

/** The message region (the list), also where focus goes when a toast that held it closes without naming a place. */
function messagesRegion(): HTMLElement | null {
  return document.querySelector<HTMLElement>(`#${MESSAGES_ID}`);
}

/** Where the skip link lands: the open message's row, else the first row, else the region itself (an empty folder, a phone's reader). */
function messagesTarget(): HTMLElement | null {
  const region = messagesRegion();
  if (region === null || region.dataset.pane === 'reader') {
    return region;
  }
  return region.querySelector<HTMLElement>('[aria-current="true"]') ?? region.querySelector<HTMLElement>('li button') ?? region;
}

/**
 * Where focus goes after an Undo on a desktop: the row of the mail that came back, which is the open one again. Null until the list has
 * drawn it (the toast waits for it); a phone opens nothing, so its toasts name the list instead.
 */
function restoredRow(): HTMLElement | null {
  return messagesRegion()?.querySelector<HTMLElement>('[aria-current="true"]') ?? null;
}

/** The bar of a selection goes with it: focus that was on it lands on the list's row (the open one, else the first), never on the page. */
function keepFocusInList(): void {
  window.requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active === null || active === document.body || !active.isConnected) {
      messagesTarget()?.focus({ preventScroll: true });
    }
  });
}

/** How long a toast waits at most for the rows it names to leave the list (rows that never leave do not hold it up). */
const ROWS_GONE_LIMIT_MS = 600;

/**
 * J2-20: resolves once none of `ids` has a row in the list any more (the optimistic removal is drawn and the rows' exits have started), or
 * after ROWS_GONE_LIMIT_MS: the toast that names where they went comes with their exit, never before it (research/02 M1). A short timer,
 * not a frame callback, so a hidden tab still gets its toast.
 */
function rowsGone(ids: readonly string[]): Promise<void> {
  const start = performance.now();
  const listed = () => {
    const region = messagesRegion();
    return region !== null && ids.some((id) => region.querySelector(`li[data-id="${CSS.escape(id)}"]:not([data-leaving])`) !== null);
  };
  return new Promise((resolve) => {
    const check = () => {
      if (!listed() || performance.now() - start > ROWS_GONE_LIMIT_MS) {
        resolve();
      } else {
        window.setTimeout(check, 16);
      }
    };
    window.setTimeout(check, 0);
  });
}

/** The time a snoozed mail snoozes again for on an Undo, or null when it is due or about to be (it goes to the Inbox instead). */
function resnoozeTime(message: Message): number | null {
  const until = message.snoozed_until;
  return typeof until === 'number' && canResnooze(until, Date.now()) ? until : null;
}

/** The folders the row menu's Move to folder offers (the others are not destinations). */
const MOVE_TARGETS = ['inbox', 'archive', 'spam', 'trash'] as const;

/** How a row menu's answer opens the compose: Reply, Reply all (J6-40) or Forward. */
type AnswerKind = 'reply' | 'replyAll' | 'forward';

/** Before a row menu's Reply or Forward has a message to answer. */
function ignoreAnswer(): void {
  // nothing is waiting yet
}

/** Hands focus from a row that is about to leave the list to the next row (or, for the last one, the one before), as its own buttons do (M1). */
function focusNeighbourRow(item: HTMLElement): void {
  const rows = [...(messagesRegion()?.querySelectorAll<HTMLElement>('li:not([data-leaving]) .ml-row') ?? [])];
  const own = item.querySelector<HTMLElement>('.ml-row');
  const index = own === null ? -1 : rows.indexOf(own);
  if (index !== -1) {
    (rows.at(index + 1) ?? (index > 0 ? rows.at(index - 1) : undefined))?.focus();
  }
}

/** Where a single message's flight starts (DESIGN-v3 H1): its row in the list, or the open message's subject when the reader acted on it. */
type FlightOrigin = 'row' | 'reader';

/** The element a flight of `message` lifts off: the row (when it is listed and on screen) or the reader's subject, as `origin` asks first. */
function flightFrom(message: Message, origin: FlightOrigin): Element | null {
  const row = messagesRegion()?.querySelector(`li[data-id="${CSS.escape(message.id)}"]:not([data-leaving])`) ?? null;
  const subject = document.querySelector('#msg-subject');
  return origin === 'reader' ? (subject ?? row) : (row ?? subject);
}

/** The token of a message: the sender's initials on the sender's own hue (the row's avatar). */
function tokenOf(message: Message, kind: HomingKind, count?: number): FlyHomeOptions {
  return { initials: initialsOf(displayName(message)), hue: avatarHue(message.from_address), kind, count };
}

/** The kind of flight a move to a folder is (any other folder: a plain move). */
const MOVE_KINDS: ReadonlyMap<string, HomingKind> = new Map([
  ['archive', 'archive'],
  ['trash', 'trash'],
  ['spam', 'spam'],
  ['inbox', 'restore']
]);
function kindOf(target: string): HomingKind {
  return MOVE_KINDS.get(target) ?? 'move';
}

/** The id of the open message's pane on a desktop: the second skip link goes there (past the list, to Reply and the toolbar). */
const READER_ID = 'mail-reader';

/**
 * After Empty Trash/Spam: the Empty button goes with the messages, so focus that is on it (the confirm gives it back) or that fell to the
 * page lands on the (now empty) list, never on <body>.
 */
function focusListAfterEmpty(): void {
  window.requestAnimationFrame(() => {
    const active = document.activeElement;
    if (active === null || active === document.body || active.closest('.ml-bin') !== null) {
      messagesRegion()?.focus({ preventScroll: true });
    }
  });
}

/**
 * The date of a reply or forward header in the mail itself (J4-20): the way mail clients write it, in the UI language and without seconds
 * ("Mon, Nov 16, 2026, 2:33 PM"; vi "14:33 Thứ 2, 16 thg 11, 2026"; zh-CN "2026年11月16日周一 14:33").
 */
const QUOTED_DATE: Intl.DateTimeFormatOptions = {
  weekday: 'short',
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit'
};

/** The owner's round avatar in the phone's app bar: the one way into Settings there (account, appearance, notifications, sign out). The button is 44px around the same 32px face. Its name starts with the letters it shows (2.5.3: a voice user says what they see). */
function AccountButton({ initials, onClick }: { initials: string; onClick: () => void }) {
  const tr = useT();
  return (
    <IconButton
      label={initials === '' ? tr('app.account_settings') : tr('app.account_named', { initials })}
      className="mb-account"
      data-account-button=""
      onClick={onClick}
    >
      <span aria-hidden="true" className="ui-avatar" data-size="md" data-script={isCjk(initials) ? 'cjk' : undefined}>
        {/* No initials while the settings load (or failed to): a person icon instead of an empty circle. */}
        {initials === '' ? <User size={16} strokeWidth={1.75} /> : initials}
      </span>
    </IconButton>
  );
}

/**
 * The account at the foot of the desktop rail (DESIGN-v3 4.1): the owner's avatar, name and address; the one way into Settings on a desktop
 * (the same button as the phone's avatar: `data-account-button`). Its name is what it shows, then what it opens (2.5.3).
 */
function AccountRow({ initials, name, address, onClick }: { initials: string; name: string; address: string; onClick: () => void }) {
  const tr = useT();
  const shown = name === '' ? address : name;
  return (
    <button type="button" className="mb-account-row" data-account-button="" onClick={onClick}>
      <span aria-hidden="true" className="ui-avatar" data-size="md" data-script={isCjk(initials) ? 'cjk' : undefined}>
        {initials === '' ? <User size={16} strokeWidth={1.75} /> : initials}
      </span>
      <span className="mb-account-text">
        <span className="mb-account-name">{shown === '' ? tr('app.account_settings') : shown}</span>
        {name === '' || address === '' ? null : <span className="mb-account-addr">{address}</span>}
      </span>
      {shown === '' ? null : <VisuallyHidden>{tr('app.account_settings')}</VisuallyHidden>}
    </button>
  );
}

/** Where a swipe of the drawer may not start: in a field (its text is selected by a drag). */
const FIELD = 'input, select, textarea, [contenteditable="true"]';

/** Lets the phone drawer be swiped away to the left (ui/useSwipeToDismiss); mounted with the drawer, so the panel is there when it starts. */
function DrawerSwipe({ panel, onDismiss }: { panel: React.RefObject<HTMLDivElement | null>; onDismiss: () => void }): null {
  // The drawer is mostly buttons (Compose, the folders): a swipe may start on one (a tap still reaches it; a drag takes the pointer, so the
  // lift is no click), only not in a field.
  useSwipeToDismiss(panel, {
    direction: 'left',
    onDismiss,
    startsDrag: (event) => !(event.target instanceof Element && event.target.closest(FIELD) !== null)
  });
  return null;
}

/** Seconds between two checks of the server while it cannot be reached (lib/auth useSession retries every 5 s). */
const SESSION_RETRY_S = 5;

/** Empty Trash/Spam calls the server again while it answers `more` (one chunk of up to 8000 mails a call), at most this many times. */
const EMPTY_ROUNDS = 50;

/** The status line of the "Could not reach the server" screen: "Trying again…" while a check runs, else the seconds to the next one. */
function RetryStatus({ checking }: { checking: boolean }) {
  const tr = useT();
  // A check that ends starts the count again (null -> 5).
  const left = useCountdown(checking ? null : SESSION_RETRY_S);
  return <p className="mb-retry">{checking || left === 0 ? tr('app.retrying') : tr('app.retry_in', { seconds: fmt.number(left) })}</p>;
}

function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = React.useState(() => (typeof window === 'undefined' ? false : window.matchMedia(query).matches));
  React.useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = () => setMatches(mql.matches);
    handler();
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = React.useState(value);
  React.useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export default function App() {
  const tr = useT();
  // The theme chosen on this device: light, dark, or the system's (new devices), which follows a change of the system while the app is open.
  const [themeChoice, setThemeChoice] = React.useState<ThemeChoice>(() => (typeof window === 'undefined' ? 'system' : storedThemeChoice()));
  const [systemDark, setSystemDark] = React.useState<boolean>(() => systemPrefersDark());
  React.useEffect(() => watchSystemTheme(() => setSystemDark(systemPrefersDark())), []);
  const dark = themeChoice === 'system' ? systemDark : themeChoice === 'dark';
  const t = React.useMemo(() => getTokens(dark), [dark]);
  const chooseTheme = React.useCallback((choice: ThemeChoice) => {
    setThemeChoice(choice);
    storeThemeChoice(choice);
  }, []);

  React.useEffect(() => {
    applyTheme(dark);
    document.body.style.background = t.bg;
    document.body.style.color = t.text;
    // The status bar of the installed app follows this choice, not the OS setting the static <meta> tags in index.html react to.
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.content = t.bg;
    }
  }, [dark, t]);

  // Nothing mail-related mounts (or is requested) until the server has confirmed the login cookie AND no gate is open (a gate answers 403 on
  // every route but its own).
  const session = useSession();
  const authenticated = session.data?.authenticated === true;
  useRealtime(authenticated && (session.data?.gate ?? null) === null);

  // Started offline: the check failed and nothing retries it on its own, so redo it when the connection returns.
  const { refetch: recheckSession } = session;
  React.useEffect(() => {
    const onOnline = () => {
      void recheckSession();
    };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
  }, [recheckSession]);

  if (session.data === undefined) {
    // useSession retries every 5 s while this lasts; the error screen stays up between attempts instead of flashing blank.
    if (!session.isError && session.errorUpdateCount === 0) {
      // Session check in flight: stay blank so a signed-in user never sees the login form flash by.
      return <div className="mb-blank" />;
    }
    return (
      <main className="mb-status">
        {/* DESIGN-v3 4.3: Edgar with his flight trail behind him, the headline, one line, the action; no card. */}
        <div className="mb-status-scene">
          <FlightTrail size="md" className="mb-status-trail" />
          <EmptyState
            illustration
            idle
            titleAs="h1"
            title={tr('app.server_unreachable')}
            description={tr('app.server_unreachable_hint')}
            action={
              <>
                <Button
                  variant="primary"
                  onClick={() => {
                    void session.refetch();
                  }}
                >
                  {tr('common.retry')}
                </Button>
                {/* J3-34: the countdown is helper text under the button (12px below it, quiet and tabular), not a label above it. */}
                <RetryStatus checking={session.isFetching} />
              </>
            }
          />
        </div>
      </main>
    );
  }
  return (
    <AuthGate t={t} session={session.data}>
      <Mailbox
        t={t}
        dark={dark}
        onToggleDark={() => chooseTheme(dark ? 'light' : 'dark')}
        themeChoice={themeChoice}
        onThemeChoice={chooseTheme}
      />
    </AuthGate>
  );
}

interface MailboxProps {
  t: ThemeTokens;
  dark: boolean;
  onToggleDark: () => void;
  themeChoice: ThemeChoice;
  onThemeChoice: (choice: ThemeChoice) => void;
}

function Mailbox({ t, dark, onToggleDark, themeChoice, onThemeChoice }: MailboxProps) {
  const tr = useT();
  const [folder, setFolder] = React.useState('inbox');
  const [filter, setFilter] = React.useState<MailFilter>('all');
  const [searchInput, setSearchInput] = React.useState('');
  const search = useDebounced(searchInput, 300);
  // Where a search looks: the open folder, or all mail (every folder but Spam and Trash). A new search starts in the folder again.
  const [scope, setScope] = React.useState<SearchScope>('folder');

  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const listSearch = search.trim();
  const allMail = listSearch !== '' && scope === 'all';
  // The view the list asks the server for: the folder, or `all` while a search looks in all mail.
  const listFolder = allMail ? 'all' : folder;
  const statsQuery = useStats();
  const messagesQuery = useMessages({ folder: listFolder, search: listSearch });
  const detailQuery = useMessageDetail(selectedId);
  const serverLabels = useLabels().data;
  const stats = statsQuery.data ?? EMPTY_STATS;
  const messages = messagesQuery.data ?? EMPTY_MESSAGES;
  const currentMessage = detailQuery.data?.message ?? null;
  const attachments = detailQuery.data?.attachments ?? EMPTY_ATTACHMENTS;
  // Any list request in flight (first load, folder switch, search, Refresh) spins the refresh icon and,
  // while there are no rows to show, the loading placeholder. Loading more has its own button label.
  const isLoadingList = messagesQuery.isFetching && !messagesQuery.isFetchingNextPage;
  // A Try again after a failed load is a load too: the reader shows its skeleton, not the failure, while it runs.
  const isLoadingMessage = detailQuery.isLoading || (detailQuery.isError && detailQuery.isFetching);
  // The list request failed and there is nothing to show: say so (with Retry) instead of looking like an empty folder.
  const loadFailed = messagesQuery.isError && messages.length === 0;

  const [composeOpen, setComposeOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<ComposeDraft>({});
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  // The section Settings opens on: Profile from the avatar, Keyboard from the shortcuts dialog, Security from a notice.
  const [settingsSection, setSettingsSection] = React.useState<SettingsSection>('profile');
  const openSettings = React.useCallback((section: SettingsSection = 'profile') => {
    setSettingsSection(section);
    setIsSettingsOpen(true);
  }, []);
  const [adminOpen, setAdminOpen] = React.useState(false);
  // The list of keyboard shortcuts (the ? key).
  const [keysOpen, setKeysOpen] = React.useState(false);
  // The mail whose Delete forever waits for the owner's yes (see ConfirmDialog).
  const [confirmDelete, setConfirmDelete] = React.useState<Message | null>(null);
  // Empty Trash / Empty Spam waits for the owner's yes too (it names the count; there is no Undo).
  const [confirmEmpty, setConfirmEmpty] = React.useState<{ folder: string; count: number } | null>(null);
  // The ticked messages whose Delete forever waits for the owner's yes (the selection bar in Trash and Spam; no Undo).
  const [confirmBulkDelete, setConfirmBulkDelete] = React.useState<Message[] | null>(null);
  // The rows ticked for an action on several messages at once (J6-26); see lib/selection.ts.
  const [checked, setChecked] = React.useState<ReadonlySet<string>>(NO_SELECTION);
  // The b and l keys: the row menu App asks the list to open (on the snooze times or the labels).
  const [menuRequest, setMenuRequest] = React.useState<RowMenuRequest | null>(null);
  // b, l and v while messages are ticked (J6-38): the selection bar opens its Snooze, Add label or Move to folder list.
  const [selectionMenu, setSelectionMenu] = React.useState<SelectionMenuRequest | null>(null);
  // Select all in Inbox (J6-39): loading the other pages, or done; with the number of ticked messages it was done for.
  const [selectAll, setSelectAll] = React.useState<{ phase: SelectAllPhase; size: number } | null>(null);
  // Reply or Forward chosen in a row menu: the message opens, and the compose follows once its text is there (it is quoted).
  const [pendingAnswer, setPendingAnswer] = React.useState<{ id: string; kind: AnswerKind } | null>(null);
  const [toast, setToast] = React.useState<ToastState | null>(null);

  const [sidebarOpen, setSidebarOpen] = React.useState(false);
  const [mobilePane, setMobilePane] = React.useState<'list' | 'reader'>('list');
  const isMobile = useMediaQuery('(max-width: 900px)');
  const searchRef = React.useRef<HTMLInputElement | null>(null);
  // Read inside reconcileSelection so a breakpoint change does not re-run it.
  const isMobileRef = React.useRef(isMobile);
  React.useLayoutEffect(() => {
    isMobileRef.current = isMobile;
  }, [isMobile]);
  // Same for the folder: a draft opens in the compose, never in the reader, so Drafts selects nothing on its own.
  const folderRef = React.useRef(folder);
  React.useLayoutEffect(() => {
    folderRef.current = folder;
  }, [folder]);

  // Identity comes from the server settings; nothing about the owner is hard-coded in the client.
  const settings = useSettings().data;
  const initials = ownerInitials(settings);
  // This device's choices: single-key shortcuts can be turned off in Settings (WCAG 2.1.4).
  const singleKeys = usePrefs().shortcuts;

  // System Back closes the topmost layer on phones instead of leaving the app. Order: bottom to top.
  useBackStack(
    [
      { open: mobilePane === 'reader', close: () => setMobilePane('list') },
      // A phone's selection mode: Back clears it (the bar's Close does too).
      { open: checked.size > 0, close: () => setChecked(NO_SELECTION) },
      { open: sidebarOpen, close: () => setSidebarOpen(false) },
      { open: isSettingsOpen, close: () => setIsSettingsOpen(false) },
      { open: adminOpen, close: () => setAdminOpen(false) },
      { open: composeOpen, close: () => setComposeOpen(false) },
      { open: confirmDelete !== null, close: () => setConfirmDelete(null) },
      { open: confirmEmpty !== null, close: () => setConfirmEmpty(null) },
      { open: keysOpen, close: () => setKeysOpen(false) }
    ],
    isMobile
  );
  // Scroll offset of the mobile list, kept here because the list unmounts while the reader is open.
  const listScroll = React.useRef(0);

  // The one way a mail gets opened (a tap on a row, a notification link): select it and, on phones, show the reader.
  const openMessage = React.useCallback((id: string) => {
    setSelectedId(id);
    if (isMobileRef.current) {
      setMobilePane('reader');
    }
  }, []);

  // Notification tap: `/?m=<message id>` opens that mail (even when it is not in the loaded list), then the
  // param is dropped so a reload or the Back button does not open it again.
  const openedByLink = React.useRef(false);
  React.useEffect(() => {
    const url = new URL(window.location.href);
    const id = nonEmpty(url.searchParams.get('m'));
    if (id === undefined) {
      return;
    }
    openedByLink.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the link is read once on load, from the URL
    openMessage(id);
    url.searchParams.delete('m');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [openMessage]);

  React.useEffect(() => {
    // The phone reader has no content or Back button without a selected message (e.g. it just left
    // the list), so return to the list.
    if (isMobile && mobilePane === 'reader' && selectedId === null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the pane is state, and it must follow the selection being cleared
      setMobilePane('list');
    }
  }, [isMobile, mobilePane, selectedId]);

  const { refetch: refetchStats } = statsQuery;
  const { refetch: refetchMessages, fetchNextPage } = messagesQuery;

  // A mail that is gone (the server's 404: deleted meanwhile, or an old notification link) must not leave an empty reader open.
  // Clearing the selection sends a phone back to the list (effect above); nothing else gets selected. Any other failure (offline, a
  // server error) keeps the mail open: the reader says it could not be opened and offers Try again (MessageView `loadFailed`).
  const detailFailed = detailQuery.isError;
  const detailError = detailQuery.error;
  const detailGone = detailFailed && detailError instanceof ApiError && detailError.status === 404;
  const readerFailed = detailFailed && !detailGone && selectedId !== null;
  const { refetch: refetchDetail } = detailQuery;
  React.useEffect(() => {
    if (detailGone && selectedId !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the selection is state, and it must follow the failed load of the selected mail
      setSelectedId(null);
      // A failure stays until dismissed.
      setToast({ text: tr('app.message_unavailable'), error: true });
    }
  }, [detailGone, selectedId, tr]);

  const refreshStats = React.useCallback(() => {
    void refetchStats();
  }, [refetchStats]);

  const loadMore = async () => {
    const result = await fetchNextPage();
    if (result.isFetchNextPageError) {
      setToast({ text: tr('app.load_more_failed'), error: true });
    }
  };
  // Not offered on the previous search's rows shown while the next search loads.
  const hasMore = messagesQuery.hasNextPage && !messagesQuery.isPlaceholderData;

  // Decides what is selected once a list is in. `keepSelection` leaves nothing selected when the selected
  // mail is no longer in the list (unstar in Starred, Undo) instead of jumping to the first one.
  const reconcileSelection = React.useCallback((list: Message[], options?: { keepSelection?: boolean }) => {
    setSelectedId((prev) => {
      if (prev !== null && list.some((m) => m.id === prev)) {
        return prev;
      }
      if (options?.keepSelection === true && prev !== null) {
        return null;
      }
      // Opening a message marks it read on the server, so on mobile only a tap may select one.
      if (isMobileRef.current || folderRef.current === 'drafts') {
        return null;
      }
      return list[0]?.id ?? null;
    });
  }, []);

  const refreshMessages = React.useCallback(
    async (options?: { keepSelection?: boolean }) => {
      const result = await refetchMessages();
      if (result.isError) {
        // The list stays as it was (or failed); without this a failed Refresh looks like nothing happened.
        setToast({ text: failureText(tr, result.error, tr('app.refresh_failed')), error: true });
      }
      if (result.data && !result.isError && !result.isPlaceholderData) {
        reconcileSelection(result.data, options);
      }
    },
    [refetchMessages, reconcileSelection, tr]
  );

  // Refresh button and the failed list's Retry: reload the list and the folder counts.
  const refreshList = () => {
    void refreshMessages();
    refreshStats();
  };

  // Select once per list (first load, folder switch, new search) when it is fully loaded; optimistic
  // patches and later refetches of the same list keep the selection as it is.
  const listKey = `${listFolder}\n${listSearch}`;
  const listSettled = messagesQuery.data !== undefined && !messagesQuery.isPlaceholderData && !messagesQuery.isFetching;
  const needsSelection = React.useRef(true);
  React.useEffect(() => {
    needsSelection.current = true;
  }, [listKey]);
  React.useEffect(() => {
    if (!needsSelection.current || !listSettled) {
      return;
    }
    needsSelection.current = false;
    if (openedByLink.current) {
      // The notification link already chose the mail (it may not even be in this list).
      openedByLink.current = false;
      return;
    }
    reconcileSelection(messagesQuery.data);
  }, [listKey, listSettled, messagesQuery.data, reconcileSelection]);

  const visibleMessages = React.useMemo(() => filterRows(messages, filter), [messages, filter]);

  // The ticked rows: cleared for another folder, search, filter or layout, and only those still listed count (a row that left is not ticked).
  const selectionView = `${listFolder}\n${listSearch}\n${filter}\n${isMobile ? 'phone' : 'desk'}`;
  const [checkedView, setCheckedView] = React.useState(selectionView);
  if (checkedView !== selectionView) {
    setCheckedView(selectionView);
    setChecked(NO_SELECTION);
    setSelectAll(null);
  }
  // The view a running Select all was started in: its pages are dropped when the person has moved on.
  const selectionViewRef = React.useRef(selectionView);
  React.useLayoutEffect(() => {
    selectionViewRef.current = selectionView;
  }, [selectionView]);
  const visibleIds = React.useMemo(() => visibleMessages.map((m) => m.id), [visibleMessages]);
  const selection = keepListed(checked, visibleIds);
  const selectedRows = visibleMessages.filter((m) => selection.has(m.id));
  // "3 selected" is said through the live region whenever the count changes (the bar shows it too); "Selection cleared" when Escape, Clear,
  // Close or the last box empties it, so the region never keeps an old count. Not after an action that moved the ticked mail (its toast
  // speaks) and not when another folder, search or filter starts afresh (`quietClear`); a finished Select all says its own line instead.
  const announcedCount = React.useRef(0);
  const announcedView = React.useRef(selectionView);
  const quietClear = React.useRef(false);
  const quietCount = React.useRef(false);
  React.useEffect(() => {
    if (selection.size > 0 && selection.size !== announcedCount.current && !quietCount.current) {
      announce(tr('list.selected_count', { count: selection.size }));
    } else if (selection.size === 0 && announcedCount.current > 0 && !quietClear.current && announcedView.current === selectionView) {
      announce(tr('list.selection_cleared'));
    }
    quietClear.current = false;
    quietCount.current = false;
    announcedCount.current = selection.size;
    announcedView.current = selectionView;
  }, [selection.size, selectionView, tr]);

  const availableLabels = React.useMemo(() => {
    const found = new Set<string>(serverLabels);
    // The open mail's own labels stay listed even before the label list has caught up with a change.
    if (currentMessage !== null) {
      for (const label of labelsOf(currentMessage)) {
        found.add(label);
      }
    }
    return [...found].toSorted((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, [serverLabels, currentMessage]);

  const title = folder.startsWith('label:') ? folder.slice(6) : folderName(folder);
  // A folder holds more mail than the loaded pages, so its counts come from the server, like the sidebar's. Search, the filter
  // chips and label folders (no server count) count the loaded rows.
  const folderStats: Partial<FolderStats> = stats;
  // The browser tab names the open folder and its unread mail from the server's count ("Inbox (2) - Edging Mail", WCAG 2.4.2).
  const folderUnread = folderStats[folder]?.unread ?? 0;
  useDocumentTitle([folderUnread > 0 ? tr('app.title_unread', { folder: title, count: folderUnread }) : title]);
  const serverCount = listSearch === '' && filter === 'all' ? folderStats[folder] : undefined;
  const poolCount = serverCount?.total ?? messages.length;
  const unreadCount = serverCount?.unread ?? messages.filter((m) => m.is_read === 0).length;
  // Empty while the folder's first load is out: "0 messages" would be a claim the server has not made yet. Counts of loaded rows
  // get a '+' while more pages exist: they are a floor, not the total.
  const more = serverCount === undefined && hasMore ? '+' : '';
  let subtitle = '';
  // The number in it rolls when it changes (DESIGN-v3 H2, MessageList RollingText).
  let subtitleCount: number | undefined;
  if (messagesQuery.data !== undefined) {
    if (unreadCount > 0) {
      subtitle = tr('app.subtitle_unread', { count: unreadCount, more });
      subtitleCount = unreadCount;
    } else if (folder === 'drafts') {
      subtitle = tr('app.subtitle_drafts', { count: poolCount, more });
      subtitleCount = poolCount;
    } else {
      subtitle = tr('app.subtitle_messages', { count: poolCount, more });
      subtitleCount = poolCount;
    }
  }

  // Status messages for screen readers (WCAG 4.1.3), through the app's live region. A finished search says how many it found and where, once
  // per search (the filter chips narrow what is counted, as on screen): the same words the results head shows.
  const visibleCount = visibleMessages.length;
  const resultsText = tr('app.search_results', {
    count: visibleCount,
    more: hasMore ? '+' : '',
    scope: allMail ? tr('list.scope_all') : title
  });
  const announcedSearch = React.useRef('');
  React.useEffect(() => {
    if (listSearch === '') {
      announcedSearch.current = '';
      return;
    }
    if (!listSettled || announcedSearch.current === listKey) {
      return;
    }
    announcedSearch.current = listKey;
    announce(resultsText);
  }, [listSearch, listKey, listSettled, resultsText]);
  // Mark all as read is offered only while something in the view is unread (the server's count, or the loaded rows').
  const canMarkAllRead = folder !== 'drafts' && folder !== 'trash' && folder !== 'spam' && unreadCount > 0;

  // New mail in the open list (a push from the server, Refresh) is said once: "2 new messages". Only mail newer than the newest already
  // listed counts, so an Undo that brings an old one back or a page loaded further down says nothing; Sent and Drafts fill by your own hand.
  const newest = React.useRef<{ key: string; at: number } | null>(null);
  const listedData = messagesQuery.isPlaceholderData ? undefined : messagesQuery.data;
  React.useEffect(() => {
    if (listedData === undefined) {
      return;
    }
    const latest = listedData.reduce((max, m) => Math.max(max, m.created_at), 0);
    const seen = newest.current;
    if (seen?.key !== listKey) {
      newest.current = { key: listKey, at: latest };
      return;
    }
    const arrived = listedData.filter((m) => m.created_at > seen.at).length;
    if (arrived > 0 && listSearch === '' && folder !== 'sent' && folder !== 'drafts') {
      announce(tr('app.new_messages', { count: arrived }));
    }
    newest.current = { key: listKey, at: Math.max(seen.at, latest) };
  }, [listedData, listKey, listSearch, folder, tr]);

  const { mutateAsync: runBatch } = useBatchAction();
  const { mutateAsync: runMarkAllRead, isPending: markingAllRead } = useMarkAllRead();
  const { mutateAsync: runUpdateLabels } = useUpdateLabels();

  const batch = React.useCallback(
    async (action: BatchAction, ids: string[], extra?: { folder?: string; until?: number }) => {
      if (ids.length === 0) {
        return false;
      }
      try {
        await runBatch({ action, ids, ...extra });
        return true;
      } catch (error) {
        console.error('Batch action failed', error);
        // The cache has rolled back by now: say so, otherwise the row just reappears (offline, server error).
        setToast({ text: failureText(tr, error, tr('app.action_failed')), error: true });
        return false;
      }
    },
    [runBatch, tr]
  );

  // The batch mutation patches every cached list optimistically, rolls back on failure and refreshes the stats.
  const toggleStar = async (message: Message) => {
    const next = message.is_starred === 1 ? 0 : 1;
    await batch(next === 1 ? 'star' : 'unstar', [message.id]);
    if (folder === 'starred' && next === 0) {
      void refreshMessages({ keepSelection: true });
    }
  };

  // The mail to open once `message` has left the visible list (archived, trashed, snoozed ...): its neighbour on desktop, nothing
  // on a phone (the reader returns to the list; opening the neighbour would mark it read). Taken from the list as it is now,
  // before the request, so the optimistic removal cannot change the answer.
  const neighbourOf = (message: Message): string | null => {
    if (isMobile) {
      return null;
    }
    const index = visibleMessages.findIndex((m) => m.id === message.id);
    return (messageAt(visibleMessages, index + 1) ?? messageAt(visibleMessages, index - 1))?.id ?? null;
  };

  // Mails whose archive/trash/spam/snooze/unsnooze is on its way: a second click on the still-open mail must not send it twice.
  const leaving = React.useRef(new Set<string>());
  // Where each message that left flew to (DESIGN-v3 H1), so its Undo flies it back from there to its row.
  const wentTo = React.useRef(new Map<string, string>());
  /** A message (or the ticked ones: `count`) leaves for `target`: its token flies home from `from`, and the Undo knows where it went. */
  const sendHome = (message: Message, target: string, from: Element | null, kind: HomingKind, count?: number) => {
    wentTo.current.set(message.id, target);
    flyAway(from, target, tokenOf(message, kind, count));
  };
  /** The Undo of `message` came back: its token flies from the folder it went to back to its row (the open subject on a phone's reader). */
  const flyBackHome = (message: Message, count?: number) => {
    const home = wentTo.current.get(message.id);
    wentTo.current.delete(message.id);
    if (home === undefined) {
      return;
    }
    window.requestAnimationFrame(() => {
      flyBack(home, flightFrom(message, 'row'), tokenOf(message, 'restore', count));
    });
  };
  // Mails deleted forever: their row leaves the list with a fade only (the others slide away), see MessageList `leaveStyle`.
  const fading = React.useRef(new Set<string>());
  const leaveStyle = React.useCallback((id: string): 'slide' | 'fade' => (fading.current.has(id) ? 'fade' : 'slide'), []);

  // Runs `exit` (a request that takes `message` out of the list) and returns its result, or null when this mail is already on its
  // way out. A phone goes back to the list at once, as it always did. On desktop the open mail stays open while the request is in
  // flight, and the neighbour opens only after it succeeded, only if the user is still on that mail: a failed request moves
  // nobody (the neighbour is never opened, so never marked read).
  const leaveMessage = async (message: Message, exit: () => Promise<boolean>): Promise<boolean | null> => {
    if (leaving.current.has(message.id)) {
      return null;
    }
    leaving.current.add(message.id);
    const neighbourId = neighbourOf(message);
    if (isMobile) {
      setSelectedId(null);
    }
    try {
      const ok = await exit();
      if (ok) {
        // The reader's next message renders as a transition, after the row's collapse has its frames (J2-06): the toast and the list come
        // first, the heavier reader render yields to them.
        React.startTransition(() => {
          setSelectedId((prev) => (prev === message.id ? neighbourId : prev));
        });
      }
      return ok;
    } finally {
      leaving.current.delete(message.id);
    }
  };

  // Snoozing is the one action whose server error is worth showing: a time that is too soon or too far is refused with the reason.
  const snoozeBatch = async (id: string, until: number): Promise<string | null> => {
    try {
      await runBatch({ action: 'snooze', ids: [id], until });
      return null;
    } catch (error) {
      console.error('Snooze failed', error);
      return failureText(tr, error, tr('app.snooze_failed'));
    }
  };

  // Puts a mail back where it was. A snoozed mail snoozes again for its time while that is still ahead; the server refuses a plain move
  // into Snoozed, and refuses a time that is due or about to be (the mail would stay where the action left it), so those go to the Inbox.
  const putBack = async (message: Message): Promise<boolean> => {
    if (message.folder !== 'snoozed') {
      return batch('move', [message.id], { folder: message.folder });
    }
    const until = resnoozeTime(message);
    if (until === null) {
      return batch('move', [message.id], { folder: 'inbox' });
    }
    const problem = await snoozeBatch(message.id, until);
    if (problem !== null) {
      setToast({ text: problem, error: true });
    }
    return problem === null;
  };

  // The Undo of a toast: put `message` (as it was before the action) back, refetch, and on desktop select it again. The toast waits for the
  // promise, then moves focus to `undoFocus`: the restored row (the open one) on a desktop, the list on a phone (which opens nothing).
  // The reader opens the restored mail when its row slides back in (J2-15): the list redraws with the row first, its slide starts about
  // 100 ms later (lib/shellMotion returnRow), and the reader swaps then, so it never shows a mail that has no row.
  const undoFor = (message: Message) => async (): Promise<void> => {
    const ok = await putBack(message);
    await refreshMessages({ keepSelection: true });
    if (ok) {
      flyBackHome(message);
    }
    if (ok && !isMobileRef.current) {
      if (!motionReduced()) {
        await new Promise((resolve) => {
          window.setTimeout(resolve, RETURN_SLIDE_DELAY_MS);
        });
      }
      setSelectedId(message.id);
    }
  };
  const undoFocus = isMobile ? messagesRegion : restoredRow;

  // The toast comes with the row's exit, not after the server's answer (J2-19), and not before the row has started to leave (J2-20: the
  // optimistic removal is drawn a moment after the click): Undo works at once (it waits for the request, then puts the mail back), and a
  // request that fails turns the same toast into the error (batch) while the row comes back; one that failed before the toast came shows
  // only the error.
  const moveMessage = async (message: Message, target: 'archive' | 'trash' | 'spam' | 'inbox', origin: FlightOrigin = 'row') => {
    if (leaving.current.has(message.id)) {
      return;
    }
    // DESIGN-v3 H1: the message flies home to the folder it goes to, from where it was, before its row's own exit moves it.
    sendHome(message, target, flightFrom(message, origin), kindOf(target));
    const label =
      target === 'trash'
        ? tr('toast.moved_to_trash')
        : target === 'spam'
          ? tr('toast.moved_to_spam')
          : target === 'inbox'
            ? tr('toast.moved_to_inbox')
            : tr('toast.archived');
    const request = leaveMessage(message, () => batch('move', [message.id], { folder: target }));
    const undo = undoFor(message);
    let failed = false;
    void rowsGone([message.id]).then(() => {
      if (failed) {
        return;
      }
      setToast({
        text: label,
        undo: async () => {
          if ((await request) === true) {
            await undo();
          }
        },
        returnFocus: undoFocus
      });
    });
    if ((await request) === false) {
      failed = true;
      void refreshMessages();
    }
  };

  // Trash and Spam only. Move to Inbox can be undone (the mail goes back to the folder it came from); Delete forever cannot, which is
  // why the toolbar asks first (confirmDelete) and the toast has no Undo.
  const restoreOrDelete = async (message: Message, action: 'restore' | 'delete', origin: FlightOrigin = 'row') => {
    if (action === 'delete') {
      // Deleted forever is not a journey: its row only fades (M1).
      fading.current.add(message.id);
    }
    if (action === 'restore') {
      // As the other moves: the toast with the row's exit (J2-19), and its flight home to the Inbox. Delete forever flies nowhere.
      await moveMessage(message, 'inbox', origin);
      return;
    }
    const ok = await leaveMessage(message, () => batch(action, [message.id]));
    if (ok !== true) {
      if (ok === false) {
        void refreshMessages();
      }
      return;
    }
    setToast({ text: tr('toast.deleted_forever') });
  };

  const snoozeMessage = async (message: Message, until: Date, origin: FlightOrigin = 'row') => {
    if (!leaving.current.has(message.id)) {
      sendHome(message, 'snoozed', flightFrom(message, origin), 'snooze');
    }
    const ok = await leaveMessage(message, async () => {
      const problem = await snoozeBatch(message.id, until.getTime());
      if (problem !== null) {
        setToast({ text: problem, error: true });
      }
      return problem === null;
    });
    if (ok !== true) {
      if (ok === false) {
        void refreshMessages();
      }
      return;
    }

    setToast({
      text: tr('toast.snoozed_until', { when: formatSnoozeUntil(until.getTime()) }),
      undo: undoFor(message),
      returnFocus: undoFocus
    });
  };

  // Brings a snoozed mail back to the Inbox now; Undo snoozes it again for the time it had (or leaves it in the Inbox when that is due).
  const unsnoozeMessage = async (message: Message, origin: FlightOrigin = 'row') => {
    if (!leaving.current.has(message.id)) {
      sendHome(message, 'inbox', flightFrom(message, origin), 'restore');
    }
    const ok = await leaveMessage(message, () => batch('move', [message.id], { folder: 'inbox' }));
    if (ok !== true) {
      if (ok === false) {
        void refreshMessages();
      }
      return;
    }

    setToast({
      text: tr('toast.moved_back_to_inbox'),
      undo: typeof message.snoozed_until === 'number' ? undoFor(message) : undefined,
      returnFocus: undoFocus
    });
  };

  const markAllRead = async () => {
    const ids = visibleMessages.filter((m) => m.is_read === 0).map((m) => m.id);
    // How many turned read, as the head said it ("3 unread"): the server's count of the folder, or the loaded rows'.
    const count = Math.max(unreadCount, ids.length);
    // Undo makes the rows that were unread unread again (the loaded ones: what the person saw), and focus goes back to the list.
    const undoable = (): ToastState => ({
      text: tr('toast.marked_all_read', { count }),
      undo: async () => {
        await batch('unread', ids);
      },
      returnFocus: messagesRegion
    });
    // All and Unread show every unread mail of the folder (or search): the server marks the pages that are not loaded too.
    // The Starred and Attachments chips only narrow the loaded rows, so they mark exactly what they show.
    if (filter === 'starred' || filter === 'attachments') {
      if (ids.length > 0 && (await batch('read', ids))) {
        setToast(undoable());
      }
      return;
    }
    try {
      // A second click while the first request is out would send the same request again.
      if (!markingAllRead) {
        await runMarkAllRead({ folder: listFolder, search: listSearch, ids });
        setToast(undoable());
      }
    } catch (error) {
      console.error('Mark all as read failed', error);
      setToast({ text: failureText(tr, error, tr('app.action_failed')), error: true });
    }
  };

  // Empty Trash / Empty Spam, after the owner's yes: every message there is deleted for good on the server (its attachments too). No Undo.
  const emptyFolder = async (target: string) => {
    try {
      // The server deletes at most one chunk per call (docs/api.md: up to 8000 mails) and says `more` while mail is left: call again until
      // it is all gone, adding up the count for the toast. A bound keeps a server that always says `more` from looping for ever.
      let deleted = 0;
      for (let round = 0; round < EMPTY_ROUNDS; round += 1) {
        const answer = await apiPost<{ deleted?: number; more?: boolean }>(
          '/api/messages/empty',
          { folder: target },
          'fail.queries_action'
        );
        deleted += typeof answer.deleted === 'number' ? answer.deleted : 0;
        if (answer.more !== true) {
          break;
        }
      }
      setSelectedId(null);
      setToast({ text: tr('toast.emptied', { count: deleted }) });
      focusListAfterEmpty();
    } catch (error) {
      console.error('Empty folder failed', error);
      setToast({ text: failureText(tr, error, tr('app.action_failed')), error: true });
    }
    refreshStats();
    await refreshMessages();
  };

  const markUnread = async (message: Message) => {
    const neighbourId = neighbourOf(message);
    // On a phone go back to the list: opening the neighbour would mark it read.
    if (isMobile) {
      setSelectedId(null);
    }
    const ok = await batch('unread', [message.id]);
    // Desktop: the unread mail stays open until the request succeeded, then the neighbour opens (a lone mail stays open).
    if (ok && neighbourId !== null) {
      setSelectedId((prev) => (prev === message.id ? neighbourId : prev));
    }
  };

  // A row's own Mark as read / Mark as unread (desktop quick actions). The open mail marked unread goes on to its neighbour, as from the
  // reader; any other row only changes its state.
  const toggleRead = async (message: Message) => {
    if (message.is_read === 0) {
      await batch('read', [message.id]);
    } else if (message.id === selectedId) {
      await markUnread(message);
    } else {
      await batch('unread', [message.id]);
    }
  };

  const toggleLabel = async (message: Message, label: string): Promise<boolean> => {
    const current = labelsOf(message);
    const next = current.includes(label) ? current.filter((l) => l !== label) : [...current, label];
    try {
      await runUpdateLabels({ id: message.id, labels: next });
      return true;
    } catch (error) {
      console.error('Failed to update labels', error);
      setToast({ text: failureText(tr, error, tr('app.labels_failed')), error: true });
      return false;
    }
  };

  // A label put on a message (not one taken off) flies a token to that label in the rail (DESIGN-v3 H1); the message stays where it is.
  const labelMessage = (message: Message, label: string, origin: FlightOrigin) => {
    if (!labelsOf(message).includes(label)) {
      flyAway(flightFrom(message, origin), `label:${label}`, tokenOf(message, 'label'));
    }
    void toggleLabel(message, label);
  };

  // ---- The ticked messages (J6-26): every action goes through POST /api/messages/batch in chunks of 100 ids, optimistic like a row's own
  // actions (the rows leave at once), with ONE toast whose Undo puts them all back. Its toast speaks for it, not "Selection cleared".
  const clearSelection = React.useCallback(() => {
    quietClear.current = true;
    setChecked(NO_SELECTION);
  }, []);
  const runChunks = async (action: BatchAction, ids: string[], extra?: { folder?: string; until?: number }): Promise<boolean> => {
    for (const part of chunks(ids)) {
      if (!(await batch(action, part, extra))) {
        return false;
      }
    }
    return true;
  };
  // M1 for a selection: focus that is on a row that leaves (or on the bar, which goes with the selection) moves at once to the first row
  // that stays, after the ticked ones (else before them), never to the page.
  const handOffFocus = (ids: readonly string[]) => {
    const active = document.activeElement;
    const leavingId = active instanceof HTMLElement ? active.closest<HTMLElement>('li[data-id]')?.dataset.id : undefined;
    const onBar = active instanceof HTMLElement && active.closest('.ml-selbar, .ml-selbar-phone, .mb-selsum') !== null;
    if (!onBar && (leavingId === undefined || !ids.includes(leavingId))) {
      return;
    }
    const items = [...(messagesRegion()?.querySelectorAll<HTMLElement>('li[data-id]:not([data-leaving])') ?? [])];
    const first = items.findIndex((li) => ids.includes(li.dataset.id ?? ''));
    const stays = (li: HTMLElement) => !ids.includes(li.dataset.id ?? '');
    const next = items.slice(Math.max(0, first)).find(stays) ?? items.slice(0, Math.max(0, first)).findLast(stays);
    (next?.querySelector<HTMLElement>('.ml-row') ?? messagesRegion())?.focus({ preventScroll: true });
  };
  // The first of `ids` that is listed again (the Undo of a selection's move): where focus goes once it is back.
  const rowOf = (ids: readonly string[]) => () =>
    messagesRegion()?.querySelector<HTMLElement>(`li[data-id="${CSS.escape(ids[0] ?? '')}"]:not([data-leaving]) .ml-row`) ?? null;
  // The Undo of a move of the selection: one batch per folder each mail came from; a snoozed one snoozes again for its time.
  const putBackAll = async (rows: Message[]): Promise<void> => {
    const byFolder = new Map<string, string[]>();
    for (const m of rows.filter((row) => row.folder !== 'snoozed')) {
      byFolder.set(m.folder, [...(byFolder.get(m.folder) ?? []), m.id]);
    }
    for (const [target, ids] of byFolder) {
      await runChunks('move', ids, { folder: target });
    }
    for (const m of rows.filter((row) => row.folder === 'snoozed')) {
      await putBack(m);
    }
    await refreshMessages({ keepSelection: true });
  };
  // Move (or snooze: `until`) every ticked mail: they leave the list at once, ONE toast says how many, its Undo puts them all back.
  const bulkMove = (target: string, until?: Date) => {
    const rows = selectedRows;
    const ids = rows.map((m) => m.id);
    if (ids.length === 0) {
      return;
    }
    // DESIGN-v3 H1: ONE token with the count flies from the first ticked row (or the selection bar) to where they all go.
    const first = rows[0];
    const lead = flightFrom(first, 'row') ?? document.querySelector('.ml-selbar, .ml-selbar-phone');
    sendHome(first, until === undefined ? target : 'snoozed', lead, until === undefined ? kindOf(target) : 'snooze', ids.length);
    handOffFocus(ids);
    clearSelection();
    keepFocusInList();
    // The open mail among them: a desktop reader goes on to the first row after it that stays (as a single archive does); a phone, to the list.
    if (selectedId !== null && selection.has(selectedId)) {
      const at = visibleMessages.findIndex((m) => m.id === selectedId);
      const after =
        visibleMessages.slice(at).find((m) => !selection.has(m.id)) ?? visibleMessages.slice(0, at).findLast((m) => !selection.has(m.id));
      setSelectedId(isMobile ? null : (after?.id ?? null));
    }
    for (const id of ids) {
      leaving.current.add(id);
    }
    const request = (
      until === undefined ? runChunks('move', ids, { folder: target }) : runChunks('snooze', ids, { until: until.getTime() })
    ).finally(() => {
      for (const id of ids) {
        leaving.current.delete(id);
      }
    });
    // J2-20: the toast comes once the rows have left the list (their exit has started), and not at all when the request failed first.
    let failed = false;
    void rowsGone(ids).then(() => {
      if (failed) {
        return;
      }
      setToast({
        text:
          until !== undefined
            ? tr('toast.snoozed_until', { when: formatSnoozeUntil(until.getTime()) })
            : target === 'archive'
              ? tr('toast.batch_archived', { count: ids.length })
              : tr('toast.batch_moved', { count: ids.length, folder: folderName(target) }),
        undo: async () => {
          if (await request) {
            await putBackAll(rows);
            flyBackHome(first, ids.length);
          }
        },
        returnFocus: isMobile ? messagesRegion : rowOf(ids)
      });
    });
    void request.then((ok) => {
      if (!ok) {
        failed = true;
        void refreshMessages();
      }
    });
  };
  // Read, unread, star, unstar: only the rows that change, and Undo turns exactly those back. The selection stays (more can follow).
  const bulkFlag = (action: 'read' | 'unread' | 'star' | 'unstar') => {
    const field = action === 'read' || action === 'unread' ? 'is_read' : 'is_starred';
    const value = action === 'read' || action === 'star' ? 1 : 0;
    const ids = selectedRows.filter((m) => m[field] !== value).map((m) => m.id);
    if (ids.length === 0) {
      return;
    }
    const count = ids.length;
    const reverse = { read: 'unread', unread: 'read', star: 'unstar', unstar: 'star' } as const;
    const text = {
      read: tr('toast.marked_all_read', { count }),
      unread: tr('toast.batch_unread', { count }),
      star: tr('toast.batch_starred', { count }),
      unstar: tr('toast.batch_unstarred', { count })
    }[action];
    const request = runChunks(action, ids);
    setToast({
      text,
      undo: async () => {
        if (await request) {
          await runChunks(reverse[action], ids);
        }
      },
      returnFocus: messagesRegion
    });
    if (folder === 'starred' && action === 'unstar') {
      void request.then(() => refreshMessages({ keepSelection: true }));
    }
  };
  // Trash and Spam, after the owner's yes: every ticked mail is deleted for good (it only fades out, M1). No Undo.
  const bulkDelete = async (rows: Message[]) => {
    const ids = rows.map((m) => m.id);
    handOffFocus(ids);
    clearSelection();
    keepFocusInList();
    for (const id of ids) {
      fading.current.add(id);
    }
    if (selectedId !== null && ids.includes(selectedId)) {
      setSelectedId(null);
    }
    if (await runChunks('delete', ids)) {
      setToast({ text: tr('toast.emptied', { count: ids.length }) });
    } else {
      void refreshMessages();
    }
  };
  // Add label: only the rows without it; Undo takes it off them again.
  const bulkLabel = async (label: string) => {
    const rows = selectedRows.filter((m) => !labelsOf(m).includes(label));
    if (rows.length === 0) {
      return;
    }
    const lead = rows.at(0);
    if (lead !== undefined) {
      flyAway(
        flightFrom(lead, 'row') ?? document.querySelector('.ml-selbar, .ml-selbar-phone'),
        `label:${label}`,
        tokenOf(lead, 'label', rows.length)
      );
    }
    const done = await Promise.all(rows.map((m) => toggleLabel(m, label)));
    if (done.every(Boolean)) {
      setToast({
        text: tr('toast.batch_labelled', { count: rows.length, label }),
        undo: async () => {
          await Promise.all(rows.map((m) => toggleLabel({ ...m, labels: JSON.stringify([...labelsOf(m), label]) }, label)));
        },
        returnFocus: messagesRegion
      });
    }
  };
  const selectionActions: SelectionActions = {
    archive: () => bulkMove('archive'),
    trash: () => bulkMove('trash'),
    restore: () => bulkMove('inbox'),
    deleteForever: () => setConfirmBulkDelete(selectedRows),
    read: () => bulkFlag('read'),
    unread: () => bulkFlag('unread'),
    star: () => bulkFlag('star'),
    unstar: () => bulkFlag('unstar'),
    move: (target) => bulkMove(target),
    snooze: (until) => bulkMove('snoozed', until),
    label: (label) => {
      void bulkLabel(label);
    }
  };
  const clearByHand = () => {
    setChecked(NO_SELECTION);
    keepFocusInList();
  };
  // The single keys while messages are ticked (J6-38, J4-41; lib/shortcuts SELECTION_SHORTCUTS): the bar's own actions, by its folder's rules
  // (Trash and Spam: e moves them to the Inbox; # in Trash asks to delete them forever), one batch and one toast. b, l and v open the bar's
  // Snooze, Add label and Move to folder lists.
  const selectionFolder = allMail ? 'all' : folder;
  // Each b, l or v press is a new request (its number), so the same list asked for twice opens twice.
  const menuRequests = React.useRef(0);
  const actOnSelection = (shortcut: TriageShortcut) => {
    const inBin = selectionFolder === 'trash' || selectionFolder === 'spam';
    switch (shortcut) {
      case 'archive': {
        if (inBin) {
          selectionActions.restore();
        } else {
          selectionActions.archive();
        }
        break;
      }
      case 'trash': {
        if (selectionFolder === 'trash') {
          selectionActions.deleteForever();
        } else {
          selectionActions.trash();
        }
        break;
      }
      case 'star': {
        if (selectedRows.some((m) => m.is_starred !== 1)) {
          selectionActions.star();
        } else {
          selectionActions.unstar();
        }
        break;
      }
      case 'unread': {
        selectionActions.unread();
        break;
      }
      case 'read': {
        selectionActions.read();
        break;
      }
      case 'snooze':
      case 'label':
      case 'move': {
        menuRequests.current += 1;
        setSelectionMenu({ view: shortcut, at: menuRequests.current });
        break;
      }
      // Reply, Reply all and Forward act on the open message, and x, Shift+J/K and ? never reach here (App's key handler).
      case 'reply':
      case 'replyAll':
      case 'forward':
      case 'select':
      case 'selectNext':
      case 'selectPrevious':
      case 'help': {
        break;
      }
    }
  };
  const selectionBar =
    selection.size === 0 ? undefined : (
      <SelectionBar
        t={t}
        count={selection.size}
        state={pageState(selection, visibleIds)}
        onToggleAll={() => setChecked(toggleAll(selection, visibleIds))}
        onClear={clearByHand}
        folder={selectionFolder}
        anyUnread={selectedRows.some((m) => m.is_read === 0)}
        anyUnstarred={selectedRows.some((m) => m.is_starred !== 1)}
        labels={availableLabels}
        actions={selectionActions}
        phone={isMobile}
        menuRequest={selectionMenu}
        onMenuRequestDone={() => setSelectionMenu(null)}
      />
    );

  // J6-39: every row of the page is ticked and the folder (or the search) has more pages: Select all in it loads the other pages, up to the
  // 500 most recent, and ticks them. The pages it loaded stay listed (a selection is only ever of listed rows).
  const pageAllTicked = selection.size > 0 && pageState(selection, visibleIds) === 'all';
  const selectAllShown =
    selectAll !== null && (selectAll.phase === 'loading' || selectAll.size === selection.size) ? selectAll.phase : null;
  const selectEverything = async () => {
    const view = selectionView;
    setSelectAll({ phase: 'loading', size: selection.size });
    let rows = messages;
    let further = hasMore;
    while (further && rows.length < SELECT_ALL_CAP) {
      const result = await fetchNextPage();
      if (result.isFetchNextPageError) {
        setSelectAll(null);
        setToast({ text: tr('app.load_more_failed'), error: true });
        return;
      }
      rows = result.data ?? rows;
      further = result.hasNextPage;
    }
    if (selectionViewRef.current !== view) {
      return;
    }
    const shown = filterRows(rows, filter);
    const ids = shown.slice(0, SELECT_ALL_CAP).map((m) => m.id);
    const capped = further || shown.length > SELECT_ALL_CAP;
    quietCount.current = true;
    setChecked(new Set(ids));
    setSelectAll({ phase: capped ? 'capped' : 'all', size: ids.length });
    // One line says what is ticked (it holds the count), in place of the plain count.
    announce(
      capped
        ? tr('list.all_selected_capped', { count: ids.length })
        : listSearch === ''
          ? tr('list.all_in_selected', { count: ids.length, folder: title })
          : tr('list.all_results_selected', { count: ids.length })
    );
  };
  const selectionNote =
    selectAllShown !== null || (pageAllTicked && hasMore) ? (
      <SelectAllLine
        phase={selectAllShown ?? 'offer'}
        count={selectAllShown === 'capped' || selectAllShown === 'all' ? selection.size : visibleIds.length}
        folder={listSearch === '' ? title : null}
        onSelectAll={() => {
          void selectEverything();
        }}
        onClear={clearByHand}
      />
    ) : undefined;
  // The reading pane while messages are ticked (desktop): the selection's summary and actions in place of the open message (J6-38, J4-41).
  const selectionSummary =
    isMobile || selection.size === 0 ? null : (
      <SelectionSummary
        rows={selectedRows}
        folder={selectionFolder}
        anyUnread={selectedRows.some((m) => m.is_read === 0)}
        anyUnstarred={selectedRows.some((m) => m.is_starred !== 1)}
        labels={availableLabels}
        actions={selectionActions}
        onClear={clearByHand}
      />
    );

  // The draft being fetched for a click in the Drafts folder; opening any compose meanwhile cancels it.
  const pendingDraft = React.useRef<string | null>(null);
  const openCompose = React.useCallback((next?: ComposeDraft) => {
    pendingDraft.current = null;
    setDraft(next ?? {});
    setComposeOpen(true);
  }, []);

  // A row of the Drafts folder opens the compose with the saved draft (desktop and phone alike).
  const openDraft = async (id: string) => {
    if (pendingDraft.current !== null) {
      return;
    }
    pendingDraft.current = id;
    try {
      const stored = await fetchDraft(id);
      if (pendingDraft.current !== id) {
        return;
      }
      const inReplyTo = nonEmpty(stored.in_reply_to);
      openCompose({
        draftId: stored.id,
        from: stored.from,
        to: stored.to.join(', '),
        cc: stored.cc.join(', '),
        bcc: stored.bcc.join(', '),
        subject: stored.subject,
        body: stored.text,
        html: stored.html,
        inReplyTo,
        // The server rebuilds the whole chain from the answered mail; this one id is what threads the sent reply.
        references: inReplyTo === undefined ? undefined : [inReplyTo],
        // N6 survives the save: the flag was sealed inside the draft (EC-3).
        sourceIsE2E: stored.from_e2e === true
      });
    } catch (error) {
      console.error('Could not open the draft', error);
      // A draft that is locked or sealed to another key says so; anything else is the general message.
      setToast({
        text: error instanceof DraftOpenError && error.reason !== 'damaged' ? error.message : tr('app.draft_unavailable'),
        error: true
      });
      void refreshMessages();
    } finally {
      if (pendingDraft.current === id) {
        pendingDraft.current = null;
      }
    }
  };

  const replyTo = (message: Message, all: boolean) => {
    const sender = nonEmpty(message.reply_to) ?? message.from_address;
    // Reply-all: everyone on the mail once (case-insensitive) except the owner's own address, which is on every inbound To.
    // The original Cc stays in Cc, minus anyone already in To.
    const taken = new Set([(settings?.email ?? '').trim().toLowerCase()]);
    const addresses = (...lists: (string | null | undefined)[]) =>
      lists
        .flatMap((list) => (list ?? '').split(/[,;]+/))
        .map((address) => address.trim())
        .filter((address) => {
          const key = address.toLowerCase();
          if (address === '' || taken.has(key)) {
            return false;
          }
          taken.add(key);
          return true;
        })
        .join(', ');
    const to = all ? addresses(sender, message.to_address) : sender;
    const cc = all ? addresses(message.cc) : undefined;
    const messageId = nonEmpty(message.message_id);
    // A message the browser could not open has no subject or text to answer with: the reply still goes to the sender, without a quote.
    const readable = !isUnreadable(message.mail_state);
    const answered = /^re:/i.test(message.subject) ? message.subject : `Re: ${message.subject}`;
    // J6-33: the attribution names the sender with the address ("Priya Nair <priya@example.com>"), as mail clients write it.
    const quoted = `${tr('app.reply_quote_header', { date: fmt.dateTime(message.created_at, QUOTED_DATE), name: formatSender(message) })}\n> ${(nonEmpty(message.body_text) ?? nonEmpty(message.snippet) ?? '').replaceAll('\n', '\n> ')}`;
    openCompose({
      to,
      cc,
      subject: readable ? answered : '',
      quote: readable ? quoted : undefined,
      // Threads the answer under this mail (In-Reply-To / References) on the server and in the recipient's client.
      inReplyTo: messageId,
      references: messageId === undefined ? undefined : [messageId],
      // N6: what is quoted from an end-to-end message must not leave for an outside address without a warning.
      sourceIsE2E: message.is_e2e === 1,
      replyRedirect: replyRedirect(message)
    });
  };

  const forward = (message: Message) => {
    if (isUnreadable(message.mail_state)) {
      return;
    }
    // The header lines become part of the outgoing mail, so they are in the UI language like the reply line.
    const header = [
      tr('app.forward_header_title'),
      tr('app.forward_header_from', { sender: formatSender(message) }),
      tr('app.forward_header_date', { date: fmt.dateTime(message.created_at, QUOTED_DATE) }),
      tr('app.forward_header_subject', { subject: message.subject })
    ].join('\n');
    openCompose({
      subject: /^fwd:/i.test(message.subject) ? message.subject : `Fwd: ${message.subject}`,
      quote: `${header}\n\n${nonEmpty(message.body_text) ?? nonEmpty(message.snippet) ?? ''}`,
      sourceIsE2E: message.is_e2e === 1
    });
  };

  // Reply, Reply all or Forward on a message that is open.
  const answerWith = (message: Message, kind: AnswerKind) => {
    if (kind === 'forward') {
      forward(message);
    } else {
      replyTo(message, kind === 'replyAll');
    }
  };
  // Reply, Reply all or Forward from a row menu: the message opens (a list row has no text to quote) and the compose follows once it is there.
  const answerFromRow = (m: Message, kind: AnswerKind) => {
    if (currentMessage?.id === m.id) {
      answerWith(currentMessage, kind);
      return;
    }
    setPendingAnswer({ id: m.id, kind });
    openMessage(m.id);
  };
  const answerPending = React.useRef<(message: Message, kind: AnswerKind) => void>(ignoreAnswer);
  React.useLayoutEffect(() => {
    answerPending.current = answerWith;
  });
  React.useEffect(() => {
    if (pendingAnswer === null || currentMessage?.id !== pendingAnswer.id) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the request is done once the message it waited for is open
    setPendingAnswer(null);
    answerPending.current(currentMessage, pendingAnswer.kind);
  }, [pendingAnswer, currentMessage]);

  // What a desktop row offers on hover and keyboard focus, in place of its time (MessageList QuickActions).
  const rowActions: RowActions = {
    archive: (m) => {
      void moveMessage(m, 'archive');
    },
    trash: (m) => {
      void moveMessage(m, 'trash');
    },
    restore: (m) => {
      void restoreOrDelete(m, 'restore');
    },
    deleteForever: setConfirmDelete,
    toggleRead: (m) => {
      void toggleRead(m);
    },
    snooze: (m, until) => {
      void snoozeMessage(m, until);
    },
    unsnooze: (m) => {
      void unsnoozeMessage(m);
    },
    move: (m, target) => {
      const known = MOVE_TARGETS.find((name) => name === target);
      if (known !== undefined) {
        void moveMessage(m, known);
      }
    },
    label: (m, label) => labelMessage(m, label, 'row'),
    reply: (m) => answerFromRow(m, 'reply'),
    replyAll: (m) => answerFromRow(m, 'replyAll'),
    forward: (m) => answerFromRow(m, 'forward'),
    select: (m) => setChecked(toggleOne(selection, m.id))
  };

  // Clicking the folder that is already open keeps the open mail and only asks for the list again.
  const selectFolder = (next: string) => {
    setFilter('all');
    if (next === folder) {
      void refreshMessages({ keepSelection: true });
      refreshStats();
      return;
    }
    setFolder(next);
    setSelectedId(null);
  };

  const selectRow = (id: string) => {
    // A search of all mail lists drafts too: a draft opens in the compose wherever it is listed.
    const row = allMail ? visibleMessages.find((m) => m.id === id) : undefined;
    if (folder === 'drafts' || row?.folder === 'drafts') {
      void openDraft(id);
    } else {
      openMessage(id);
    }
  };

  // Steps to the next or previous message of the list from `from` (the row that has focus; default the open message) and returns its id
  // (null: there is none), so j and k can move focus to its row too. With a message open the step opens that message; with none open
  // (nothing chosen yet, a phone's list) it only names the row, so j and k walk the rows as the arrow keys do and Enter opens one.
  const navigateRelative = React.useCallback(
    (direction: -1 | 1, from: string | null = selectedId): string | null => {
      if (from === null || leaving.current.has(from)) {
        // Nothing open and no row focused, or the mail is on its way out (archive in flight): there is no place to step from.
        return null;
      }
      const index = visibleMessages.findIndex((m) => m.id === from);
      const next = messageAt(visibleMessages, index + direction);
      if (next === undefined) {
        return null;
      }
      if (selectedId !== null) {
        setSelectedId(next.id);
      }
      return next.id;
    },
    [selectedId, visibleMessages]
  );

  // The single keys that act on a message (e, #, s, u, r, a, f) and ? (the list of keys). They act on the row that has focus in the list,
  // else on the open message; Reply, Reply all and Forward need the open message (its text is quoted). A row that leaves hands focus to the
  // next row first (M1), as its own buttons do. Kept in a ref so the key listener below is not re-attached on every render.
  const triage = React.useRef<((shortcut: TriageShortcut) => void) | null>(null);
  React.useLayoutEffect(() => {
    triage.current = (shortcut) => {
      if (shortcut === 'help') {
        setKeysOpen(true);
        return;
      }
      // J6-38, J4-41: while messages are ticked the triage keys act on all of them (r, a and f stay on the open message, x and Shift+J/K
      // change the selection).
      if (selection.size > 0 && SELECTION_SHORTCUTS.includes(shortcut)) {
        actOnSelection(shortcut);
        return;
      }
      const active = document.activeElement;
      const item = active instanceof HTMLElement ? active.closest<HTMLElement>('li[data-id]') : null;
      const focusedId = item !== null && messagesRegion()?.contains(item) === true ? item.dataset.id : undefined;
      const row = focusedId === undefined ? undefined : visibleMessages.find((m) => m.id === focusedId);
      const m = row ?? currentMessage ?? undefined;
      if (m === undefined) {
        return;
      }
      const where = allMail ? m.folder : folder;
      if (where === 'drafts') {
        return;
      }
      const bin = where === 'trash' || where === 'spam';
      // The rows as the list shows them, and the row x and Shift+J/K start from (the focused one, else the open one).
      const shownIds = [...(messagesRegion()?.querySelectorAll<HTMLElement>('li[data-id]:not([data-leaving])') ?? [])].flatMap(
        (li) => li.dataset.id ?? []
      );
      const handOff = () => {
        if (item !== null && row !== undefined) {
          focusNeighbourRow(item);
        }
      };
      // The key acted on the focused row, or (no row focused) on the open message: that is where its flight starts.
      const origin: FlightOrigin = row === undefined ? 'reader' : 'row';
      switch (shortcut) {
        case 'archive': {
          handOff();
          void (bin ? restoreOrDelete(m, 'restore', origin) : moveMessage(m, 'archive', origin));
          break;
        }
        case 'trash': {
          if (where === 'trash') {
            setConfirmDelete(m);
          } else {
            handOff();
            void moveMessage(m, 'trash', origin);
          }
          break;
        }
        case 'star': {
          void toggleStar(m);
          break;
        }
        case 'unread': {
          void (m.id === selectedId ? markUnread(m) : batch('unread', [m.id]));
          break;
        }
        case 'read': {
          // Shift+I (J6-40): Mark as read, Gmail's key (u is Mark as unread).
          if (m.is_read === 0) {
            void batch('read', [m.id]);
          }
          break;
        }
        case 'snooze':
        case 'label':
        case 'move': {
          // b, l and v open the row's menu on the snooze times, the labels or the folders (J6-31, J6-40); not where the action does not exist.
          const can = shortcut === 'snooze' ? !bin && where !== 'sent' : shortcut === 'label' ? !bin && availableLabels.length > 0 : true;
          if (can && shownIds.includes(m.id)) {
            setMenuRequest({ id: m.id, view: shortcut, at: Date.now() });
          }
          break;
        }
        case 'select': {
          setChecked(toggleOne(selection, m.id));
          break;
        }
        case 'selectNext':
        case 'selectPrevious': {
          const grown = extendSelection(selection, shownIds, m.id, shortcut === 'selectNext' ? 1 : -1);
          if (grown.to !== null) {
            setChecked(grown.selected);
            const next = messagesRegion()?.querySelector<HTMLElement>(`li[data-id="${CSS.escape(grown.to)}"] .ml-row`);
            next?.focus({ preventScroll: true });
            next?.scrollIntoView({ block: 'nearest' });
          }
          break;
        }
        case 'reply':
        case 'replyAll':
        case 'forward': {
          if (currentMessage !== null) {
            if (shortcut === 'forward') {
              forward(currentMessage);
            } else {
              replyTo(currentMessage, shortcut === 'replyAll');
            }
          }
          break;
        }
      }
    };
  });

  // The phone drawer covers the page: every key except Escape (below) is for the drawer, not for what is underneath it.
  const drawerOpen = isMobile && sidebarOpen;
  const layerOpen =
    composeOpen ||
    isSettingsOpen ||
    adminOpen ||
    drawerOpen ||
    confirmDelete !== null ||
    confirmEmpty !== null ||
    confirmBulkDelete !== null ||
    keysOpen;
  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (event.key === 'Escape') {
        setSidebarOpen(false);
        // Escape clears the selection (J6-26) when nothing above the list takes it: a dialog, a menu, the drawer.
        const above = target?.closest('[role="dialog"], [role="alertdialog"], [role="menu"], .ui-popover') ?? null;
        if (!layerOpen && !event.defaultPrevented && above === null) {
          setChecked(NO_SELECTION);
          // Focus on the selection's summary (the reading pane) goes with it: it lands on the list's row, never on the page.
          keepFocusInList();
        }
        return;
      }
      const shortcut = shortcutOf(event, target, singleKeys);
      // A dialog or a popup (the row menu, the snooze times, a menu of the selection bar) keeps its keys: a letter there is never a shortcut
      // of the page under it (it would act on the open message, not on the row the menu is about).
      const popup = target?.closest('[role="dialog"], [role="alertdialog"], [role="menu"], .ui-popover') ?? null;
      if (shortcut === null || layerOpen || popup !== null) {
        return;
      }
      event.preventDefault();
      switch (shortcut) {
        case 'search': {
          searchRef.current?.focus();
          break;
        }
        case 'compose': {
          openCompose();
          break;
        }
        case 'next':
        case 'previous': {
          // j and k move focus with the open message while focus is in the list (or nowhere): the two never part.
          const active = document.activeElement;
          const region = messagesRegion();
          const inList = active === null || active === document.body || region?.contains(active) === true;
          // The step starts at the row that has focus (arrows may have moved it off the open row), else at the open message.
          const item = active instanceof HTMLElement ? active.closest<HTMLElement>('li[data-id]') : null;
          const focusedId = item !== null && region?.contains(item) === true ? (item.dataset.id ?? null) : null;
          const nextId = navigateRelative(shortcut === 'next' ? 1 : -1, focusedId ?? undefined);
          // The row is in the list already (only its aria-current comes with the next render): focus it by its id, now.
          if (inList && nextId !== null) {
            const row = messagesRegion()?.querySelector<HTMLElement>(`li[data-id="${CSS.escape(nextId)}"] .ml-row`);
            row?.focus({ preventScroll: true });
            row?.scrollIntoView({ block: 'nearest' });
          }
          break;
        }
        case 'archive':
        case 'trash':
        case 'star':
        case 'unread':
        case 'read':
        case 'snooze':
        case 'label':
        case 'move':
        case 'reply':
        case 'replyAll':
        case 'forward':
        case 'select':
        case 'selectNext':
        case 'selectPrevious':
        case 'help': {
          triage.current?.(shortcut);
          break;
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [layerOpen, navigateRelative, openCompose, singleKeys]);

  // Settings > Keyboard's "Show the list" opens the ? dialog (over Settings; closing it goes back there).
  React.useEffect(() => {
    const open = () => setKeysOpen(true);
    window.addEventListener(SHOW_SHORTCUTS_EVENT, open);
    return () => window.removeEventListener(SHOW_SHORTCUTS_EVENT, open);
  }, []);

  // Focus moves into the drawer when it opens and returns to the button that opens it when it closes (as in SettingsModal).
  const drawerRef = React.useRef<HTMLDivElement | null>(null);
  const menuButtonRef = React.useRef<HTMLButtonElement | null>(null);
  // The phone's menu button is the home of every folder while the drawer is shut: a message flies into it (DESIGN-v3 H1).
  const menuHome = homeRef('menu');
  const setMenuButton = React.useCallback(
    (node: HTMLButtonElement | null) => {
      menuButtonRef.current = node;
      return menuHome(node);
    },
    [menuHome]
  );
  React.useEffect(() => {
    if (!drawerOpen) {
      return;
    }
    const opener = menuButtonRef.current;
    drawerRef.current?.focus({ preventScroll: true });
    return () => {
      opener?.focus({ preventScroll: true });
    };
  }, [drawerOpen]);
  // M14: the drawer slides in from its @starting-style (mailbox.css); it leaves on an inert copy that slides back out (lib/shellMotion).
  const drawerRootRef = React.useCallback((node: HTMLDivElement | null) => {
    if (node === null) {
      return;
    }
    return () => {
      leaveDrawer(node);
    };
  }, []);

  // M9 on a phone: the reader slides in over the list, Back slides it away (lib/shellMotion). The pane that goes plays on a copy taken
  // while it is still on the page (its ref's cleanup); the pane that comes animates as it is attached. Nothing moves on the first render.
  const shownPane = React.useRef<PhonePane | null>(null);
  const phonePaneRef = React.useCallback((node: HTMLDivElement | null) => {
    if (node === null) {
      return;
    }
    const pane: PhonePane = node.dataset.pane === 'reader' ? 'reader' : 'list';
    if (shownPane.current !== null && shownPane.current !== pane) {
      enterPane(node, pane);
    }
    shownPane.current = pane;
    return () => {
      leavePane(node, pane);
    };
  }, []);

  // The phone's Compose button says its name until the list is scrolled down, then it is only its icon; scrolling up brings the name back.
  const [fabShort, setFabShort] = React.useState(false);
  const lastListTop = React.useRef(0);
  const onListScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains('ml-scroll')) {
      return;
    }
    const top = target.scrollTop;
    const delta = top - lastListTop.current;
    lastListTop.current = top;
    if (top <= 24) {
      setFabShort(false);
    } else if (delta > 4) {
      setFabShort(true);
    } else if (delta < -4) {
      setFabShort(false);
    }
  };

  const selectedIndex = selectedId !== null ? visibleMessages.findIndex((m) => m.id === selectedId) : -1;
  const position = selectedIndex > -1 ? tr('app.position', { current: selectedIndex + 1, total: visibleMessages.length }) : '';

  const clearSearch = () => {
    setSearchInput('');
    setScope('folder');
    searchRef.current?.focus();
  };

  const renderSearch = (mobile: boolean) => (
    <form role="search" className="mb-search" onSubmit={(e) => e.preventDefault()}>
      <TextField
        id="mail-search"
        ref={searchRef}
        // A search field: the phone keyboard's return key says Search (enterKeyHint), and Enter puts the keyboard away there so the results
        // under it can be seen (the search runs as you type).
        type="search"
        enterKeyHint="search"
        hideLabel
        label={tr('app.search_mail')}
        autoComplete="off"
        spellCheck={false}
        maxLength={SEARCH_MAX}
        value={searchInput}
        onChange={(e) => {
          setSearchInput(e.target.value);
          if (e.target.value.trim() === '') {
            setScope('folder');
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && mobile) {
            e.currentTarget.blur();
          }
        }}
        placeholder={tr('app.search_mail')}
        leading={<Search size={16} strokeWidth={1.75} aria-hidden="true" />}
        trailing={
          searchInput === '' ? (
            // The `/` keycap only while the key works (single-key shortcuts can be off on this device).
            mobile || !singleKeys ? undefined : (
              <span aria-hidden="true">
                <Kbd>/</Kbd>
              </span>
            )
          ) : (
            <IconButton label={tr('app.clear_search')} size="sm" onClick={clearSearch}>
              <X size={16} strokeWidth={1.75} aria-hidden="true" />
            </IconButton>
          )
        }
      />
    </form>
  );

  // DESIGN-v3 4.1: no header on a desktop. The foot of the rail holds the account (the one way into Settings) and the theme switch; the
  // search is the list sheet's own (its head).
  const railFoot = (
    <>
      <AccountRow
        initials={initials}
        name={settings?.display_name.trim() ?? ''}
        address={settings?.email ?? ''}
        onClick={() => openSettings()}
      />
      <IconButton label={dark ? tr('app.theme_to_light') : tr('app.theme_to_dark')} onClick={onToggleDark}>
        {dark ? <Sun size={18} strokeWidth={1.75} aria-hidden="true" /> : <Moon size={18} strokeWidth={1.75} aria-hidden="true" />}
      </IconButton>
    </>
  );

  // What the list shows above its rows while a search runs, and the actions only Trash and Spam have.
  const searchProps = {
    searchQuery: listSearch,
    onClearSearch: clearSearch,
    scope,
    onScopeChange: setScope,
    resultsText,
    canMarkAllRead,
    onEmptyFolder:
      folder === 'trash' || folder === 'spam'
        ? () => setConfirmEmpty({ folder, count: folderStats[folder]?.total ?? messages.length })
        : undefined
  };

  const listPanel = (
    <MessageList
      t={t}
      messages={visibleMessages}
      selectedId={selectedId}
      onSelect={selectRow}
      onToggleStar={(m) => {
        void toggleStar(m);
      }}
      rowActions={rowActions}
      leaveStyle={leaveStyle}
      isDrafts={folder === 'drafts' && !allMail}
      isSnoozed={folder === 'snoozed' && !allMail}
      title={title}
      folder={folder}
      subtitle={subtitle}
      subtitleCount={subtitleCount}
      filter={filter}
      onFilterChange={setFilter}
      onMarkAllRead={() => {
        void markAllRead();
      }}
      onRefresh={refreshList}
      isLoading={isLoadingList}
      {...searchProps}
      // The search is the list sheet's own, under its title (DESIGN-v3 4.1).
      searchSlot={renderSearch(false)}
      hasMore={hasMore}
      loadingMore={messagesQuery.isFetchingNextPage}
      onLoadMore={() => {
        void loadMore();
      }}
      loadFailed={loadFailed}
      onRetry={refreshList}
      selection={selection}
      onSelectionChange={setChecked}
      selectionBar={selectionBar}
      selectionNote={selectionNote}
      labels={availableLabels}
      menuRequest={menuRequest}
    />
  );

  const readerPanel = (
    <MessageView
      t={t}
      message={currentMessage}
      onNotice={(text) => setToast({ text, error: true })}
      attachments={attachments}
      isLoading={isLoadingMessage}
      labels={availableLabels}
      onReply={(m) => replyTo(m, false)}
      onReplyAll={(m) => replyTo(m, true)}
      onForward={forward}
      onToggleStar={(m) => {
        void toggleStar(m);
      }}
      onArchive={(m) => {
        void moveMessage(m, 'archive', 'reader');
      }}
      onTrash={(m) => {
        void moveMessage(m, 'trash', 'reader');
      }}
      onSpam={(m) => {
        void moveMessage(m, 'spam', 'reader');
      }}
      onRestore={(m) => {
        void restoreOrDelete(m, 'restore', 'reader');
      }}
      onDeleteForever={setConfirmDelete}
      onMarkUnread={(m) => {
        void markUnread(m);
      }}
      onSnooze={(m, until) => {
        void snoozeMessage(m, until, 'reader');
      }}
      onUnsnooze={(m) => {
        void unsnoozeMessage(m, 'reader');
      }}
      onToggleLabel={(m, label) => labelMessage(m, label, 'reader')}
      onPrev={() => navigateRelative(-1)}
      onNext={() => navigateRelative(1)}
      hasPrev={selectedIndex > 0}
      hasNext={selectedIndex > -1 && selectedIndex < visibleMessages.length - 1}
      position={position}
      onBack={isMobile ? () => setMobilePane('list') : undefined}
      listEmpty={visibleMessages.length === 0}
      loadFailed={readerFailed}
      onRetry={() => {
        void refetchDetail();
      }}
      selfAddress={settings?.email}
      compact={isMobile}
    />
  );

  // Account notices and locked mail: above both panes on a desktop, under the header on a phone (the header stays the top of the screen).
  const banners = (
    <>
      <NoticesBanner t={t} onOpenSettings={openSettings} />
      <LockedMailBanner t={t} />
    </>
  );

  return (
    <div className="mb-root" data-layout={isMobile ? 'phone' : 'desktop'}>
      {/* The first stop of Tab (WCAG 2.4.1): straight to the messages, past the header, the folders and the banners. It moves focus itself
          (no #hash in the address: the phone's Back button walks the history). */}
      <a
        href={`#${MESSAGES_ID}`}
        className="nm-skip-link"
        onClick={(e) => {
          const target = messagesTarget();
          if (target !== null) {
            e.preventDefault();
            target.focus();
          }
        }}
      >
        {tr('app.skip_to_messages')}
      </a>
      {/* The second stop on a desktop: past the list to the open message (its toolbar and Reply are the next Tab stops). */}
      {isMobile ? null : (
        <a
          href={`#${READER_ID}`}
          className="nm-skip-link"
          onClick={(e) => {
            const target = document.querySelector<HTMLElement>(`#${READER_ID}`);
            if (target !== null) {
              e.preventDefault();
              target.focus();
            }
          }}
        >
          {tr('app.skip_to_message')}
        </a>
      )}
      <div className="mb-body" data-toast={toast === null ? undefined : ''}>
        {!isMobile ? (
          <Sidebar
            t={t}
            folder={folder}
            onSelectFolder={selectFolder}
            stats={stats}
            labels={availableLabels}
            onCompose={() => openCompose()}
            foot={railFoot}
          />
        ) : null}

        <div className="mb-main">
          {isMobile ? null : banners}
          {isMobile ? (
            <>
              {/* An open message has one bar on a phone, the reader's own (Back, its place in the list, Newer, Older): the app bar goes, so
                  the message starts higher. The page keeps its heading (the folder) for screen readers. */}
              {mobilePane === 'reader' ? (
                <h1 className="ui-visually-hidden">{title}</h1>
              ) : (
                // Selection mode (J6-26) keeps this bar: the selection's own bar floats at the bottom, in thumb reach (DESIGN-v3 4.1).
                <div className="mb-phone-bar">
                  <IconButton
                    ref={setMenuButton}
                    data-nav-toggle="mailboxes"
                    label={tr('app.open_mailboxes')}
                    onClick={() => setSidebarOpen(true)}
                  >
                    <MenuIcon size={20} strokeWidth={1.75} aria-hidden="true" />
                  </IconButton>
                  {/* The folder name is never cut: when the count does not fit beside it (a 320px phone, a long Vietnamese name), the count wraps
                      below. A search shows its count of results there. */}
                  <div className="mb-phone-title">
                    {/* A search titles the bar "Results" (J6-37): the count under it says where it looked. */}
                    <h1>{listSearch === '' ? title : tr('list.results')}</h1>
                    <span className="mb-phone-count">
                      {listSearch === '' ? <RollingText text={subtitle} count={subtitleCount} /> : resultsText}
                    </span>
                  </div>
                  {/* MessageList hides its own header on phones, so its Mark all as read lives here: only while something is unread, and
                      well apart from the avatar (the way into Settings). */}
                  {canMarkAllRead ? (
                    <IconButton
                      label={tr('app.mark_all_read')}
                      className="mb-mark-read"
                      onClick={() => {
                        void markAllRead();
                      }}
                    >
                      <CheckCheck size={18} strokeWidth={1.75} aria-hidden="true" />
                    </IconButton>
                  ) : null}
                  <AccountButton initials={initials} onClick={() => openSettings()} />
                </div>
              )}
              {/* Account notices and locked mail are the top of the list's scroller on a phone (MessageList `notices`): they scroll away
                  with the filters, so the app bar and the search are all that stays (DESIGN-v4m R3; a fixed notice left a 320x568 phone no
                  row at all), and an open message's own bar is the top of the screen. */}

              {/* The one main landmark of the mailbox: the list or the open message (WCAG 1.3.1, 2.4.1). */}
              <main className="mb-phone-panes">
                {mobilePane === 'list' ? (
                  <>
                    <div
                      key="list"
                      ref={phonePaneRef}
                      className="mb-pane"
                      data-pane="list"
                      id={MESSAGES_ID}
                      tabIndex={-1}
                      onScrollCapture={onListScroll}
                    >
                      <MessageList
                        t={t}
                        messages={visibleMessages}
                        selectedId={selectedId}
                        onSelect={selectRow}
                        isDrafts={folder === 'drafts' && !allMail}
                        isSnoozed={folder === 'snoozed' && !allMail}
                        onToggleStar={(m) => {
                          void toggleStar(m);
                        }}
                        onSwipeArchive={
                          !allMail && (SWIPE_ARCHIVE_FOLDERS.has(folder) || folder.startsWith('label:'))
                            ? (m) => {
                                void moveMessage(m, 'archive');
                              }
                            : undefined
                        }
                        onSwipeTrash={
                          !allMail && (SWIPE_TRASH_FOLDERS.has(folder) || folder.startsWith('label:'))
                            ? (m) => {
                                void moveMessage(m, 'trash');
                              }
                            : undefined
                        }
                        // The row menu (a long press): the same actions as a desktop row's.
                        rowActions={rowActions}
                        leaveStyle={leaveStyle}
                        title={title}
                        folder={folder}
                        subtitle={subtitle}
                        filter={filter}
                        onFilterChange={setFilter}
                        onMarkAllRead={() => {
                          void markAllRead();
                        }}
                        onRefresh={refreshList}
                        isLoading={isLoadingList}
                        {...searchProps}
                        // The search stays under the app bar; the notices and the filters scroll away with the rows (DESIGN-v4m R3).
                        searchSlot={renderSearch(true)}
                        notices={banners}
                        compact
                        scrollMemory={listScroll}
                        hasMore={hasMore}
                        loadingMore={messagesQuery.isFetchingNextPage}
                        onLoadMore={() => {
                          void loadMore();
                        }}
                        loadFailed={loadFailed}
                        onRetry={refreshList}
                        selection={selection}
                        onSelectionChange={setChecked}
                        selectionNote={selectionNote}
                        labels={availableLabels}
                        menuRequest={menuRequest}
                      />
                    </div>
                    {/* Extended (icon and name) at the top of the list; only its icon once the list scrolls down, the name stays its
                        accessible name. */}
                    {/* Not while messages are ticked: the bar's actions are the ones that matter then, and it would cover the last rows. */}
                    <div className="mb-fab-wrap" hidden={selectionBar !== undefined}>
                      <Button
                        ref={homeRef('compose')}
                        variant="secondary"
                        shape="pill"
                        size="lg"
                        data-compose-button=""
                        data-short={fabShort ? 'true' : undefined}
                        className="mb-fab"
                        leadingIcon={<PenLine size={20} strokeWidth={1.75} aria-hidden="true" />}
                        onClick={() => openCompose()}
                      >
                        <span className="mb-fab-label">{tr('action.compose')}</span>
                      </Button>
                    </div>
                    {/* The selection's bar (Close, the count, Archive, Move to Trash, More) floats where Compose was, above the safe area. */}
                    <div className="ml-dock" data-phone="true">
                      <span aria-hidden="true" className="ml-dock-anchor" />
                      {selectionBar}
                    </div>
                  </>
                ) : (
                  // Keyed apart: React would otherwise keep the one div for both panes (the list's fragment is flattened), and the push
                  // would have no pane that comes and none that goes.
                  <div key="reader" ref={phonePaneRef} className="mb-pane" data-pane="reader" id={MESSAGES_ID} tabIndex={-1}>
                    {readerPanel}
                  </div>
                )}
              </main>
            </>
          ) : (
            // The one main landmark of the mailbox: the list and the reader (WCAG 1.3.1, 2.4.1). The skip links land in the list and the reader.
            <main className="mb-panes">
              <div className="mb-pane" data-pane="list" id={MESSAGES_ID} tabIndex={-1}>
                {listPanel}
              </div>
              {/* The second skip link lands here: a region named by the open message's subject (J1-19), else by the empty reader's words; while
                  messages are ticked, by the selection's summary, which stands in for the open message (J6-38: the reader's own toolbar would act
                  on one message nobody ticked). The open message stays mounted under it, so Clear brings it back as it was. */}
              <div
                className="mb-pane"
                data-pane="reader"
                data-summary={selectionSummary === null ? undefined : 'true'}
                id={READER_ID}
                tabIndex={-1}
                role="region"
                aria-labelledby={
                  selectionSummary !== null ? SELECTION_SUMMARY_TITLE_ID : currentMessage === null ? undefined : 'msg-subject'
                }
                aria-label={selectionSummary === null && currentMessage === null ? tr('reader.none_selected') : undefined}
              >
                {selectionSummary}
                {readerPanel}
              </div>
            </main>
          )}
        </div>
      </div>

      {isMobile && sidebarOpen ? (
        <div ref={drawerRootRef} className="mb-drawer-root">
          <div role="presentation" className="mb-drawer-scrim" onClick={() => setSidebarOpen(false)} />
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the handler only keeps Tab inside the modal drawer; the panel is not a control */}
          <div
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label={tr('sidebar.mailboxes')}
            tabIndex={-1}
            onKeyDown={(e) => trapTab(e, drawerRef.current)}
            className="mb-drawer"
          >
            <Sidebar
              t={t}
              folder={folder}
              onSelectFolder={(next) => {
                selectFolder(next);
                // The open folder tapped again keeps what is on screen (a reader stays a reader); another folder shows its list.
                if (next !== folder) {
                  setMobilePane('list');
                }
              }}
              stats={stats}
              labels={availableLabels}
              onCompose={() => {
                setSidebarOpen(false);
                openCompose();
              }}
              onCloseMobile={() => setSidebarOpen(false)}
            />
          </div>
          {/* A swipe to the left puts the drawer away (the X, Escape and the scrim still do). */}
          <DrawerSwipe panel={drawerRef} onDismiss={() => setSidebarOpen(false)} />
        </div>
      ) : null}

      <ComposeModal
        isOpen={composeOpen}
        t={t}
        onClose={() => setComposeOpen(false)}
        defaultFrom={settings?.email ?? ''}
        fromName={settings?.display_name ?? ''}
        signature={settings?.signature ?? ''}
        draft={draft}
        // The compose reports only problems here (a draft not saved, a discard that failed, a copy missing from Sent): they stay until
        // dismissed.
        onNotice={(text) => setToast({ text, error: true })}
        // Undo send (J6-02, lib/outbox.ts): the window has closed at once and the message waits the seconds chosen in Settings; meanwhile
        // "Sending..." with Undo (and Ctrl/Cmd+Z) for that long. It comes a moment after the window goes, when the flight is clear (M11,
        // J2-02). Undo opens the compose again as it was (text, recipients, files) and focus goes into its body. J1-16: the toast is the
        // hold's clock: it pauses the wait while it is pointed at, holds focus or the tab is hidden, and its bar shows the time really left.
        onQueued={({ undo, pause, resume, remaining, done }) => {
          window.setTimeout(() => {
            setToast({
              text: tr('compose.sending'),
              undoHint: tr('compose.sending_hint'),
              undo,
              hold: { pause, resume, done },
              duration: remaining(),
              returnFocus: () => document.querySelector<HTMLElement>('.cp-editor')
            });
          }, 200);
        }}
        onReopen={(next) => {
          // A send that failed once the window had gone: the compose comes back with the reason, and "Sending..." goes.
          if (next.sendError !== undefined) {
            setToast((current) => (current?.hold === undefined ? current : null));
          }
          openCompose(next);
        }}
        // The window was closed and its draft is kept (J4-11): said with a way to open it again.
        onDraftKept={(kept) => {
          const saved: ToastState & { actionLabel?: string } = {
            text: tr('compose.draft_kept'),
            undo: () => openCompose(kept),
            actionLabel: tr('compose.open_draft'),
            returnFocus: () => document.querySelector<HTMLElement>('.cp-editor')
          };
          setToast(saved);
        }}
        onSuccess={() => {
          // The message has left (after its Undo time): a visible "Sent" toast says it went (above the phone's Compose button and the
          // reader's bottom bar), and the live region says it (the toast's own announcement replaces this one when it comes a moment later).
          // When nothing waited, it comes after the flight (200 ms) so the two do not compete.
          announce(tr('compose.sent'));
          window.setTimeout(() => setToast({ text: tr('compose.sent') }), 200);
          refreshStats();
          if (folder === 'sent') {
            void refreshMessages();
          }
        }}
      />

      <SettingsModal
        isOpen={isSettingsOpen}
        t={t}
        onClose={() => setIsSettingsOpen(false)}
        onToggleDark={onToggleDark}
        themeChoice={themeChoice}
        onThemeChoice={onThemeChoice}
        initialSection={settingsSection}
        onOpenAdmin={() => {
          setIsSettingsOpen(false);
          setAdminOpen(true);
        }}
      />
      <AdminConsole isOpen={adminOpen} t={t} onClose={() => setAdminOpen(false)} />

      <ShortcutsDialog
        open={keysOpen}
        onClose={() => setKeysOpen(false)}
        onOpenSettings={() => {
          setKeysOpen(false);
          openSettings('keyboard');
        }}
      />

      <ConfirmDialog
        isOpen={confirmDelete !== null}
        t={t}
        title={tr('confirm.delete_forever_title')}
        body={tr('confirm.delete_forever_body')}
        // Which message goes for good (J4-21): its subject under the sentence.
        detail={confirmDelete === null ? undefined : subjectOf(confirmDelete, tr('list.no_subject'))}
        confirmLabel={tr('action.delete_forever')}
        onConfirm={() => {
          if (confirmDelete !== null) {
            void restoreOrDelete(confirmDelete, 'delete');
          }
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* Empty Trash / Empty Spam: the count is named, nothing comes back (no Undo). */}
      <ConfirmDialog
        isOpen={confirmEmpty !== null}
        t={t}
        title={tr('confirm.empty_title', { folder: folderName(confirmEmpty?.folder ?? 'trash') })}
        body={tr('confirm.empty_body', { count: confirmEmpty?.count ?? 0, folder: folderName(confirmEmpty?.folder ?? 'trash') })}
        confirmLabel={tr('list.empty_folder', { folder: folderName(confirmEmpty?.folder ?? 'trash') })}
        onConfirm={() => {
          if (confirmEmpty !== null) {
            void emptyFolder(confirmEmpty.folder);
          }
          setConfirmEmpty(null);
        }}
        onCancel={() => setConfirmEmpty(null)}
      />

      {/* Delete forever of the ticked messages in Trash or Spam: the count is named, nothing comes back (no Undo). */}
      <ConfirmDialog
        isOpen={confirmBulkDelete !== null}
        t={t}
        title={tr('confirm.delete_selected_title', { count: confirmBulkDelete?.length ?? 0 })}
        body={tr('confirm.delete_selected_body')}
        confirmLabel={tr('action.delete_forever')}
        onConfirm={() => {
          if (confirmBulkDelete !== null) {
            void bulkDelete(confirmBulkDelete);
          }
          setConfirmBulkDelete(null);
        }}
        onCancel={() => setConfirmBulkDelete(null)}
      />

      <Toast
        t={t}
        toast={toast}
        onDismiss={() => setToast(null)}
        // A phone's toast stands above what floats at the bottom: the Compose button of the list, the action bar of the reader.
        raised={isMobile}
        desktop={!isMobile}
        fallbackFocus={messagesRegion}
      />
    </div>
  );
}
