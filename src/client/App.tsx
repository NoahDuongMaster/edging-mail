import React from 'react';
import { CheckCheck, Menu as MenuIcon, Moon, PenLine, Search, Sun, User, X } from 'lucide-react';
import { BrandMark } from './components/BrandMark';
import { Sidebar } from './components/Sidebar';
import { MessageList, type MailFilter } from './components/MessageList';
import { MessageView } from './components/MessageView';
import { ComposeModal, type ComposeDraft } from './components/ComposeModal';
import { ConfirmDialog } from './components/ConfirmDialog';
import { AuthGate } from './components/auth/AuthGate';
import { LockedMailBanner } from './components/LockedMailBanner';
import { NoticesBanner } from './components/NoticesBanner';
import { SettingsModal } from './components/SettingsModal';
import { AdminConsole } from './components/admin/AdminConsole';
import { Toast, type ToastState } from './components/Toast';
import { applyTheme, getTokens, type ThemeTokens } from './theme';
import { displayName, folderName, formatSender, labelsOf, nonEmpty, replyRedirect, SEARCH_MAX } from './lib/mail';
import { isUnreadable } from './lib/mailcrypto/texts';
import { ApiError } from './lib/api';
import { useBackStack } from './lib/backStack';
import { useSession } from './lib/auth';
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
import { ownerInitials, useSettings } from './lib/settings';
import { shortcutOf } from './lib/shortcuts';
import { canResnooze, formatSnoozeUntil } from './lib/snooze';
import { Button, EmptyState, IconButton, Kbd, TextField } from './ui';
import type { Attachment, FolderStats, Message } from './types';
import './components/mailbox.css';

const EMPTY_STATS: FolderStats = {};
const EMPTY_MESSAGES: Message[] = [];
const EMPTY_ATTACHMENTS: Attachment[] = [];

// Folders whose rows can be swiped to Archive on mobile (the others are already out of the inbox flow).
const SWIPE_ARCHIVE_FOLDERS = new Set(['inbox', 'starred', 'snoozed']);

// `list[index]` is undefined past either end of the list, which the plain index type does not say.
function messageAt(list: Message[], index: number): Message | undefined {
  return list[index];
}

/** What a failed request tells the user: no connection (fetch throws a TypeError then), the server's reason, or `fallback` (already translated by the caller). */
function failureText(tr: TFunction, error: unknown, fallback: string): string {
  return error instanceof TypeError ? tr('app.no_connection') : error instanceof Error ? error.message : fallback;
}

/** The date of a reply or forward header in the mail itself: the same numeric form `toLocaleString()` gave, now in the UI language. */
const QUOTED_DATE: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'numeric',
  day: 'numeric',
  hour: 'numeric',
  minute: 'numeric',
  second: 'numeric'
};

/** The owner's round avatar in the header, desktop and phone: the one way into Settings (account, appearance, notifications, sign out). On phones the button is 44px around the same 32px face. */
function AccountButton({ initials, onClick }: { initials: string; onClick: () => void }) {
  const tr = useT();
  return (
    <IconButton label={tr('app.account_settings')} className="mb-account" data-account-button="" onClick={onClick}>
      <span aria-hidden="true" className="ui-avatar" data-size="md">
        {/* No initials while the settings load (or failed to): a person icon instead of an empty circle. */}
        {initials === '' ? <User size={16} strokeWidth={1.75} /> : initials}
      </span>
    </IconButton>
  );
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
  const [dark, setDark] = React.useState<boolean>(() => {
    const stored = typeof window !== 'undefined' ? window.localStorage.getItem('edging-mail-theme') : null;
    return stored === 'dark';
  });
  const t = React.useMemo(() => getTokens(dark), [dark]);

  React.useEffect(() => {
    applyTheme(dark);
    document.body.style.background = t.bg;
    document.body.style.color = t.text;
    // The status bar of the installed app follows this choice, not the OS setting the static <meta> tags in index.html react to.
    for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
      meta.content = t.bg;
    }
    window.localStorage.setItem('edging-mail-theme', dark ? 'dark' : 'light');
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
        <EmptyState
          illustration
          title={tr('app.server_unreachable')}
          action={
            <Button
              onClick={() => {
                void session.refetch();
              }}
            >
              {tr('common.retry')}
            </Button>
          }
        />
      </main>
    );
  }
  return (
    <AuthGate t={t} session={session.data}>
      <Mailbox t={t} dark={dark} onToggleDark={() => setDark((v) => !v)} />
    </AuthGate>
  );
}

function Mailbox({ t, dark, onToggleDark }: { t: ThemeTokens; dark: boolean; onToggleDark: () => void }) {
  const tr = useT();
  const [folder, setFolder] = React.useState('inbox');
  const [filter, setFilter] = React.useState<MailFilter>('all');
  const [searchInput, setSearchInput] = React.useState('');
  const search = useDebounced(searchInput, 300);

  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const listSearch = search.trim();
  const statsQuery = useStats();
  const messagesQuery = useMessages({ folder, search: listSearch });
  const detailQuery = useMessageDetail(selectedId);
  const serverLabels = useLabels().data;
  const stats = statsQuery.data ?? EMPTY_STATS;
  const messages = messagesQuery.data ?? EMPTY_MESSAGES;
  const currentMessage = detailQuery.data?.message ?? null;
  const attachments = detailQuery.data?.attachments ?? EMPTY_ATTACHMENTS;
  // Any list request in flight (first load, folder switch, search, Refresh) spins the refresh icon and,
  // while there are no rows to show, the loading placeholder. Loading more has its own button label.
  const isLoadingList = messagesQuery.isFetching && !messagesQuery.isFetchingNextPage;
  const isLoadingMessage = detailQuery.isLoading;
  // The list request failed and there is nothing to show: say so (with Retry) instead of looking like an empty folder.
  const loadFailed = messagesQuery.isError && messages.length === 0;

  const [composeOpen, setComposeOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<ComposeDraft>({});
  const [isSettingsOpen, setIsSettingsOpen] = React.useState(false);
  const [adminOpen, setAdminOpen] = React.useState(false);
  // The mail whose Delete forever waits for the owner's yes (see ConfirmDialog).
  const [confirmDelete, setConfirmDelete] = React.useState<Message | null>(null);
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

  // System Back closes the topmost layer on phones instead of leaving the app. Order: bottom to top.
  useBackStack(
    [
      { open: mobilePane === 'reader', close: () => setMobilePane('list') },
      { open: sidebarOpen, close: () => setSidebarOpen(false) },
      { open: isSettingsOpen, close: () => setIsSettingsOpen(false) },
      { open: adminOpen, close: () => setAdminOpen(false) },
      { open: composeOpen, close: () => setComposeOpen(false) },
      { open: confirmDelete !== null, close: () => setConfirmDelete(null) }
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
    // The Starred chip only exists on the mobile board.
    if (!isMobile && filter === 'starred') {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the filter is state, and it must reset when the viewport leaves the phone layout
      setFilter('all');
    }
  }, [isMobile, filter]);

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

  // A mail that cannot be loaded (deleted meanwhile, or an old notification link) must not leave an empty reader
  // open. Clearing the selection sends a phone back to the list (effect above); nothing else gets selected.
  const detailFailed = detailQuery.isError;
  const detailError = detailQuery.error;
  React.useEffect(() => {
    if (detailFailed && selectedId !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the selection is state, and it must follow the failed load of the selected mail
      setSelectedId(null);
      // The server's own 404 keeps the plain wording; offline (or any other failure) says what happened.
      setToast({
        text:
          detailError instanceof ApiError && detailError.status === 404
            ? tr('app.message_unavailable')
            : failureText(tr, detailError, tr('app.message_unavailable'))
      });
    }
  }, [detailFailed, detailError, selectedId, tr]);

  const refreshStats = React.useCallback(() => {
    void refetchStats();
  }, [refetchStats]);

  const loadMore = async () => {
    const result = await fetchNextPage();
    if (result.isFetchNextPageError) {
      setToast({ text: tr('app.load_more_failed') });
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
        setToast({ text: failureText(tr, result.error, tr('app.refresh_failed')) });
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
  const listKey = `${folder}\n${listSearch}`;
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

  const visibleMessages = React.useMemo(() => {
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
  }, [messages, filter]);

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
  const serverCount = listSearch === '' && filter === 'all' ? folderStats[folder] : undefined;
  const poolCount = serverCount?.total ?? messages.length;
  const unreadCount = serverCount?.unread ?? messages.filter((m) => m.is_read === 0).length;
  // Empty while the folder's first load is out: "0 messages" would be a claim the server has not made yet. Counts of loaded rows
  // get a '+' while more pages exist: they are a floor, not the total.
  const more = serverCount === undefined && hasMore ? '+' : '';
  let subtitle = '';
  if (messagesQuery.data !== undefined) {
    if (unreadCount > 0) {
      subtitle = tr('app.subtitle_unread', { count: unreadCount, more });
    } else if (folder === 'drafts') {
      subtitle = tr('app.subtitle_drafts', { count: poolCount, more });
    } else {
      subtitle = tr('app.subtitle_messages', { count: poolCount, more });
    }
  }

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
        setToast({ text: failureText(tr, error, tr('app.action_failed')) });
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
        setSelectedId((prev) => (prev === message.id ? neighbourId : prev));
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
    if (typeof message.snoozed_until !== 'number' || !canResnooze(message.snoozed_until, Date.now())) {
      return batch('move', [message.id], { folder: 'inbox' });
    }
    const problem = await snoozeBatch(message.id, message.snoozed_until);
    if (problem !== null) {
      setToast({ text: problem });
    }
    return problem === null;
  };

  // The Undo of a toast: put `message` (as it was before the action) back, refetch, and on desktop select it again.
  const undoFor = (message: Message) => () => {
    void putBack(message).then((ok) => {
      void refreshMessages({ keepSelection: true });
      if (ok && !isMobileRef.current) {
        setSelectedId(message.id);
      }
    });
  };

  const moveMessage = async (message: Message, target: 'archive' | 'trash' | 'spam') => {
    const ok = await leaveMessage(message, () => batch('move', [message.id], { folder: target }));
    if (ok !== true) {
      if (ok === false) {
        void refreshMessages();
      }
      return;
    }

    const label = target === 'trash' ? tr('toast.moved_to_trash') : target === 'spam' ? tr('toast.moved_to_spam') : tr('toast.archived');
    setToast({ text: label, undo: undoFor(message) });
  };

  // Trash and Spam only. Move to Inbox can be undone (the mail goes back to the folder it came from); Delete forever cannot, which is
  // why the toolbar asks first (confirmDelete) and the toast has no Undo.
  const restoreOrDelete = async (message: Message, action: 'restore' | 'delete') => {
    const ok = await leaveMessage(message, () => batch(action, [message.id]));
    if (ok !== true) {
      if (ok === false) {
        void refreshMessages();
      }
      return;
    }

    setToast(action === 'restore' ? { text: tr('toast.moved_to_inbox'), undo: undoFor(message) } : { text: tr('toast.deleted_forever') });
  };

  const snoozeMessage = async (message: Message, until: Date) => {
    const ok = await leaveMessage(message, async () => {
      const problem = await snoozeBatch(message.id, until.getTime());
      if (problem !== null) {
        setToast({ text: problem });
      }
      return problem === null;
    });
    if (ok !== true) {
      if (ok === false) {
        void refreshMessages();
      }
      return;
    }

    setToast({ text: tr('toast.snoozed_until', { when: formatSnoozeUntil(until.getTime()) }), undo: undoFor(message) });
  };

  // Brings a snoozed mail back to the Inbox now; Undo snoozes it again for the time it had (or leaves it in the Inbox when that is due).
  const unsnoozeMessage = async (message: Message) => {
    const ok = await leaveMessage(message, () => batch('move', [message.id], { folder: 'inbox' }));
    if (ok !== true) {
      if (ok === false) {
        void refreshMessages();
      }
      return;
    }

    setToast({ text: tr('toast.moved_back_to_inbox'), undo: typeof message.snoozed_until === 'number' ? undoFor(message) : undefined });
  };

  const markAllRead = async () => {
    const ids = visibleMessages.filter((m) => m.is_read === 0).map((m) => m.id);
    // All and Unread show every unread mail of the folder (or search): the server marks the pages that are not loaded too.
    // The Starred and Attachments chips only narrow the loaded rows, so they mark exactly what they show.
    if (filter === 'starred' || filter === 'attachments') {
      if (ids.length > 0) {
        await batch('read', ids);
      }
      return;
    }
    try {
      // A second click while the first request is out would send the same request again.
      if (!markingAllRead) {
        await runMarkAllRead({ folder, search: listSearch, ids });
      }
    } catch (error) {
      console.error('Mark all as read failed', error);
      setToast({ text: failureText(tr, error, tr('app.action_failed')) });
    }
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

  const toggleLabel = async (message: Message, label: string) => {
    const current = labelsOf(message);
    const next = current.includes(label) ? current.filter((l) => l !== label) : [...current, label];
    try {
      await runUpdateLabels({ id: message.id, labels: next });
    } catch (error) {
      console.error('Failed to update labels', error);
      setToast({ text: failureText(tr, error, tr('app.labels_failed')) });
    }
  };

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
      setToast({ text: error instanceof DraftOpenError && error.reason !== 'damaged' ? error.message : tr('app.draft_unavailable') });
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
    const quoted = `${tr('app.reply_quote_header', { date: fmt.dateTime(message.created_at, QUOTED_DATE), name: displayName(message) })}\n> ${(nonEmpty(message.body_text) ?? nonEmpty(message.snippet) ?? '').replaceAll('\n', '\n> ')}`;
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
    if (folder === 'drafts') {
      void openDraft(id);
    } else {
      openMessage(id);
    }
  };

  const navigateRelative = React.useCallback(
    (direction: -1 | 1) => {
      if (selectedId === null || leaving.current.has(selectedId)) {
        // Nothing open, or the open mail is on its way out (archive in flight): there is no place to step from.
        return;
      }
      const index = visibleMessages.findIndex((m) => m.id === selectedId);
      const next = messageAt(visibleMessages, index + direction);
      if (next !== undefined) {
        setSelectedId(next.id);
      }
    },
    [selectedId, visibleMessages]
  );

  // The phone drawer covers the page: every key except Escape (below) is for the drawer, not for what is underneath it.
  const drawerOpen = isMobile && sidebarOpen;
  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSidebarOpen(false);
        return;
      }
      const shortcut = shortcutOf(event, event.target as HTMLElement | null);
      if (shortcut === null || composeOpen || isSettingsOpen || adminOpen || drawerOpen || confirmDelete !== null) {
        return;
      }
      event.preventDefault();
      if (shortcut === 'search') {
        searchRef.current?.focus();
      } else if (shortcut === 'compose') {
        openCompose();
      } else {
        navigateRelative(shortcut === 'next' ? 1 : -1);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [composeOpen, isSettingsOpen, adminOpen, drawerOpen, confirmDelete, navigateRelative, openCompose]);

  // Focus moves into the drawer when it opens and returns to the button that opens it when it closes (as in SettingsModal).
  const drawerRef = React.useRef<HTMLDivElement | null>(null);
  const menuButtonRef = React.useRef<HTMLButtonElement | null>(null);
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

  const selectedIndex = selectedId !== null ? visibleMessages.findIndex((m) => m.id === selectedId) : -1;
  const position = selectedIndex > -1 ? tr('app.position', { current: selectedIndex + 1, total: visibleMessages.length }) : '';

  const renderSearch = (mobile: boolean) => (
    <form role="search" className="mb-search" onSubmit={(e) => e.preventDefault()}>
      <TextField
        id="mail-search"
        ref={searchRef}
        type="text"
        hideLabel
        label={tr('app.search_mail')}
        autoComplete="off"
        spellCheck={false}
        maxLength={SEARCH_MAX}
        value={searchInput}
        onChange={(e) => setSearchInput(e.target.value)}
        placeholder={tr('app.search_mail')}
        leading={<Search size={16} strokeWidth={1.75} aria-hidden="true" />}
        trailing={
          searchInput === '' ? (
            mobile ? undefined : (
              <span aria-hidden="true">
                <Kbd>/</Kbd>
              </span>
            )
          ) : (
            <IconButton
              label={tr('app.clear_search')}
              size="sm"
              onClick={() => {
                setSearchInput('');
                searchRef.current?.focus();
              }}
            >
              <X size={16} strokeWidth={1.75} aria-hidden="true" />
            </IconButton>
          )
        }
      />
    </form>
  );

  // Desktop header: the mark above the sidebar, the search in the middle, the theme and the account on the right.
  const header = (
    <header className="mb-header">
      <div className="mb-header-brand">
        <BrandMark t={t} />
      </div>
      <div className="mb-header-search">{renderSearch(false)}</div>
      <div className="mb-header-actions">
        <IconButton label={dark ? tr('app.theme_to_light') : tr('app.theme_to_dark')} onClick={onToggleDark}>
          {dark ? <Sun size={18} strokeWidth={1.75} aria-hidden="true" /> : <Moon size={18} strokeWidth={1.75} aria-hidden="true" />}
        </IconButton>
        <AccountButton initials={initials} onClick={() => setIsSettingsOpen(true)} />
      </div>
    </header>
  );

  const listPanel = (
    <MessageList
      t={t}
      messages={visibleMessages}
      selectedId={selectedId}
      onSelect={selectRow}
      onToggleStar={(m) => {
        void toggleStar(m);
      }}
      isDrafts={folder === 'drafts'}
      isSnoozed={folder === 'snoozed'}
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
      searchQuery={listSearch}
      hasMore={hasMore}
      loadingMore={messagesQuery.isFetchingNextPage}
      onLoadMore={() => {
        void loadMore();
      }}
      loadFailed={loadFailed}
      onRetry={refreshList}
    />
  );

  const readerPanel = (
    <MessageView
      t={t}
      message={currentMessage}
      onNotice={(text) => setToast({ text })}
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
        void moveMessage(m, 'archive');
      }}
      onTrash={(m) => {
        void moveMessage(m, 'trash');
      }}
      onSpam={(m) => {
        void moveMessage(m, 'spam');
      }}
      onRestore={(m) => {
        void restoreOrDelete(m, 'restore');
      }}
      onDeleteForever={setConfirmDelete}
      onMarkUnread={(m) => {
        void markUnread(m);
      }}
      onSnooze={(m, until) => {
        void snoozeMessage(m, until);
      }}
      onUnsnooze={(m) => {
        void unsnoozeMessage(m);
      }}
      onToggleLabel={(m, label) => {
        void toggleLabel(m, label);
      }}
      onPrev={() => navigateRelative(-1)}
      onNext={() => navigateRelative(1)}
      hasPrev={selectedIndex > 0}
      hasNext={selectedIndex > -1 && selectedIndex < visibleMessages.length - 1}
      position={position}
      onBack={isMobile ? () => setMobilePane('list') : undefined}
      listEmpty={visibleMessages.length === 0}
      compact={isMobile}
    />
  );

  // Account notices and locked mail: above both panes on a desktop, under the header on a phone (the header stays the top of the screen).
  const banners = (
    <>
      <NoticesBanner t={t} onOpenSettings={() => setIsSettingsOpen(true)} />
      <LockedMailBanner t={t} />
    </>
  );

  return (
    <div className="mb-root" data-layout={isMobile ? 'phone' : 'desktop'}>
      {isMobile ? null : header}

      <div className="mb-body">
        {!isMobile ? (
          <Sidebar
            t={t}
            folder={folder}
            onSelectFolder={selectFolder}
            stats={stats}
            labels={availableLabels}
            onCompose={() => openCompose()}
          />
        ) : null}

        <div className="mb-main">
          {isMobile ? null : banners}
          {isMobile ? (
            <>
              <div className="mb-phone-bar">
                <IconButton
                  ref={menuButtonRef}
                  data-nav-toggle="mailboxes"
                  label={tr('app.open_mailboxes')}
                  onClick={() => setSidebarOpen(true)}
                >
                  <MenuIcon size={20} strokeWidth={1.75} aria-hidden="true" />
                </IconButton>
                {/* The folder name is never cut: when the count does not fit beside it (a 320px phone, a long Vietnamese name), the count wraps below. */}
                <div className="mb-phone-title">
                  <h1>{mobilePane === 'reader' ? tr('term.message') : title}</h1>
                  {mobilePane === 'list' ? <span className="mb-phone-count">{subtitle}</span> : null}
                </div>
                {/* MessageList hides its own header on phones, so its Mark all as read lives here (Drafts have nothing unread). */}
                {mobilePane === 'list' && folder !== 'drafts' ? (
                  <IconButton
                    label={tr('app.mark_all_read')}
                    onClick={() => {
                      void markAllRead();
                    }}
                  >
                    <CheckCheck size={18} strokeWidth={1.75} aria-hidden="true" />
                  </IconButton>
                ) : null}
                <AccountButton initials={initials} onClick={() => setIsSettingsOpen(true)} />
              </div>
              {banners}
              {mobilePane === 'list' ? (
                <div className="mb-phone-search" data-closing={folder === 'drafts' ? '' : undefined}>
                  {renderSearch(true)}
                </div>
              ) : null}

              <div className="mb-phone-panes">
                {mobilePane === 'list' ? (
                  <>
                    <div className="mb-pane">
                      <MessageList
                        t={t}
                        messages={visibleMessages}
                        selectedId={selectedId}
                        onSelect={selectRow}
                        isDrafts={folder === 'drafts'}
                        isSnoozed={folder === 'snoozed'}
                        onToggleStar={(m) => {
                          void toggleStar(m);
                        }}
                        onSwipeArchive={
                          SWIPE_ARCHIVE_FOLDERS.has(folder) || folder.startsWith('label:')
                            ? (m) => {
                                void moveMessage(m, 'archive');
                              }
                            : undefined
                        }
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
                        searchQuery={listSearch}
                        compact
                        scrollMemory={listScroll}
                        hasMore={hasMore}
                        loadingMore={messagesQuery.isFetchingNextPage}
                        onLoadMore={() => {
                          void loadMore();
                        }}
                        loadFailed={loadFailed}
                        onRetry={refreshList}
                      />
                    </div>
                    <Button
                      variant="primary"
                      size="lg"
                      data-compose-button=""
                      className="mb-fab"
                      leadingIcon={<PenLine size={20} strokeWidth={1.75} aria-hidden="true" />}
                      onClick={() => openCompose()}
                    >
                      {tr('action.compose')}
                    </Button>
                  </>
                ) : (
                  <div className="mb-pane">{readerPanel}</div>
                )}
              </div>
            </>
          ) : (
            <div className="mb-panes">
              <div className="mb-pane" data-pane="list">
                {listPanel}
              </div>
              <div className="mb-pane" data-pane="reader">
                {readerPanel}
              </div>
            </div>
          )}
        </div>
      </div>

      {isMobile && sidebarOpen ? (
        <div className="mb-drawer-root">
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
        </div>
      ) : null}

      <ComposeModal
        isOpen={composeOpen}
        t={t}
        onClose={() => setComposeOpen(false)}
        defaultFrom={settings?.email ?? ''}
        signature={settings?.signature ?? ''}
        draft={draft}
        onNotice={(text) => setToast({ text })}
        onSuccess={() => {
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
        onOpenAdmin={() => {
          setIsSettingsOpen(false);
          setAdminOpen(true);
        }}
      />
      <AdminConsole isOpen={adminOpen} t={t} onClose={() => setAdminOpen(false)} />

      <ConfirmDialog
        isOpen={confirmDelete !== null}
        t={t}
        title={tr('confirm.delete_forever_title')}
        body={tr('confirm.delete_forever_body')}
        confirmLabel={tr('action.delete_forever')}
        onConfirm={() => {
          if (confirmDelete !== null) {
            void restoreOrDelete(confirmDelete, 'delete');
          }
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      <Toast t={t} toast={toast} onDismiss={() => setToast(null)} raised={isMobile ? mobilePane === 'list' : false} desktop={!isMobile} />
    </div>
  );
}
