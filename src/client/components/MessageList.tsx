import React from 'react';
import { Archive, CheckCheck, Paperclip, RefreshCw, Star } from 'lucide-react';
import type { Message } from '../types';
import type { ThemeTokens } from '../theme';
import { getLabelChip } from '../theme';
import { GROUP_ORDER, displayName, formatRowTime, groupOf, labelsOf, nonEmpty, snippetOf, subjectOf } from '../lib/mail';
import { SNOOZE_GROUP_ORDER, snoozeGroupOf } from '../lib/snooze';
import { useT, type TFunction } from '../lib/i18n';
import { Button, Chip, EmptyState, IconButton, ListSkeleton, SegmentedControl, VisuallyHidden } from '../ui';
import { SnoozeChip } from './SnoozeMenu';
import './messagelist.css';

export type MailFilter = 'all' | 'unread' | 'starred' | 'attachments';

interface MessageListProps {
  t: ThemeTokens;
  messages: Message[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onToggleStar: (message: Message) => void;
  /** Mobile only: when set, rows can be swiped left to archive. */
  onSwipeArchive?: (message: Message) => void;
  title: string;
  /** The folder behind `messages` ('inbox', 'spam', 'label:Work' ...); only picks the empty-state hint. */
  folder: string;
  subtitle: string;
  filter: MailFilter;
  onFilterChange: (filter: MailFilter) => void;
  onMarkAllRead: () => void;
  onRefresh: () => void;
  isLoading: boolean;
  /** Search text behind `messages` (trimmed); only changes the empty-state copy. */
  searchQuery?: string;
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
}

/** The filters in the UI language; the mobile board adds Starred between Unread and Attachments. */
function filterOptions(compact: boolean, tr: TFunction): { value: MailFilter; label: string }[] {
  const all = { value: 'all' as const, label: tr('list.filter_all') };
  const unread = { value: 'unread' as const, label: tr('list.filter_unread') };
  const attachments = { value: 'attachments' as const, label: tr('term.attachments') };
  return compact ? [all, unread, { value: 'starred' as const, label: tr('folder.starred') }, attachments] : [all, unread, attachments];
}

/** How far (px) a row has to be dragged left before letting go archives it; also the width of the Archive label behind the row. */
const SWIPE_REVEAL = 96;

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

interface RowButtonProps {
  t: ThemeTokens;
  message: Message;
  sender: string;
  subject: string;
  timestamp: number;
  /** Wake time of a snoozed mail: shown in place of the date on the phone board, because that is what matters in the Snoozed folder. */
  snoozedUntil: number | null;
  preview: string;
  labels: string[];
  unread: boolean;
  selected: boolean;
  /** The phone board: no label chips, and a snoozed row shows its wake time where the date is. */
  compact: boolean;
  onSelect: (id: string) => void;
}

/**
 * The button of one row: the unread dot, the sender and date, the subject, then the preview with the chips (labels, snooze time) on the
 * same line. The star is a separate button beside it (a button cannot hold a button), see StarButton.
 */
const RowButton: React.FC<RowButtonProps> = ({
  t,
  message: m,
  sender,
  subject,
  timestamp,
  snoozedUntil,
  preview,
  labels,
  unread,
  selected,
  compact,
  onSelect
}) => {
  const tr = useT();
  const chips = !compact && (labels.length > 0 || snoozedUntil !== null);
  return (
    <button
      type="button"
      className="ml-row"
      data-unread={unread ? 'true' : undefined}
      aria-current={selected ? 'true' : undefined}
      onClick={() => onSelect(m.id)}
    >
      <span aria-hidden="true" className="ml-dot" />
      <span className="ml-main">
        {unread ? <VisuallyHidden>{tr('list.unread_sr')}</VisuallyHidden> : null}
        <span className="ml-line">
          <span className="ml-sender">{sender}</span>
          {m.has_attachments === 1 ? (
            <Paperclip role="img" aria-label={tr('list.has_attachments')} size={14} strokeWidth={1.75} className="ml-clip" />
          ) : null}
          {compact && snoozedUntil !== null ? (
            <span className="ml-time-slot">
              <SnoozeChip t={t} until={snoozedUntil} bare />
            </span>
          ) : (
            <span className="ml-time">{formatRowTime(timestamp)}</span>
          )}
        </span>
        <span className="ml-subject">{subject}</span>
        {preview !== '' || chips ? (
          <span className="ml-line3">
            {preview === '' ? null : <span className="ml-preview">{preview}</span>}
            {chips ? (
              <span className="ml-chips">
                {snoozedUntil === null ? null : <SnoozeChip t={t} until={snoozedUntil} selected={selected} />}
                {labels.map((label) => (
                  <Chip key={label} colors={getLabelChip(label, t)}>
                    {label}
                  </Chip>
                ))}
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

/** The star of a row, on its subject line. Quiet (an outline) until the mail is starred. */
const StarButton: React.FC<StarButtonProps> = ({ message: m, sender, starred, onToggleStar }) => {
  const tr = useT();
  return (
    <button
      type="button"
      className="ml-star"
      aria-label={tr('list.star_from', { sender })}
      aria-pressed={starred}
      onClick={() => onToggleStar(m)}
    >
      <Star size={16} strokeWidth={1.75} fill={starred ? 'currentColor' : 'none'} aria-hidden="true" />
    </button>
  );
};

interface CompactRowProps {
  t: ThemeTokens;
  message: Message;
  sender: string;
  subject: string;
  timestamp: number;
  /** Wake time of a snoozed mail: shown in place of the date, because that is what matters in the Snoozed folder. */
  snoozedUntil: number | null;
  preview: string;
  unread: boolean;
  starred: boolean;
  onSelect: (id: string) => void;
  onToggleStar: (message: Message) => void;
  onSwipeArchive?: (message: Message) => void;
}

/** Mobile list row from the mobile board; touch users can swipe it left to archive. */
const CompactRow: React.FC<CompactRowProps> = ({
  t,
  message: m,
  sender,
  subject,
  timestamp,
  snoozedUntil,
  preview,
  unread,
  starred,
  onSelect,
  onToggleStar,
  onSwipeArchive
}) => {
  const tr = useT();
  const [dx, setDx] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);
  const rowRef = React.useRef<HTMLLIElement | null>(null);
  // Handlers read this ref, not state: a quick flick can fire pointerup before React re-renders.
  const gesture = React.useRef({ startX: 0, startY: 0, tracking: false, active: false, dx: 0 });
  const swiped = React.useRef(false);

  const reset = () => {
    gesture.current.tracking = false;
    gesture.current.active = false;
    gesture.current.dx = 0;
    setDragging(false);
    setDx(0);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    // Mouse users have the reader's Archive button; the gesture is touch/pen only.
    if (!onSwipeArchive || e.pointerType === 'mouse') {
      return;
    }
    gesture.current = { startX: e.clientX, startY: e.clientY, tracking: true, active: false, dx: 0 };
    swiped.current = false;
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
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
      setDragging(true);
    }
    g.dx = Math.max(-SWIPE_REVEAL * 1.6, Math.min(0, moveX));
    setDx(g.dx);
  };

  const onPointerUp = () => {
    const g = gesture.current;
    if (!g.active) {
      g.tracking = false;
      return;
    }
    if (g.dx <= -SWIPE_REVEAL) {
      g.tracking = false;
      g.active = false;
      setDragging(false);
      setDx(-(rowRef.current?.offsetWidth ?? 390));
      window.setTimeout(() => onSwipeArchive?.(m), 160);
    } else {
      reset();
    }
  };

  const revealed = dx < 0;

  return (
    <li
      ref={rowRef}
      className="ml-item ml-swipe"
      data-revealed={revealed ? 'true' : undefined}
      // Only a starred row has a star (the phone has no room for an empty one); the subject makes room for it.
      data-star={starred ? 'true' : undefined}
    >
      {revealed ? (
        <span aria-hidden="true" className="ml-swipe-reveal" style={{ width: SWIPE_REVEAL }}>
          <Archive size={22} strokeWidth={1.75} />
          {tr('action.archive')}
        </span>
      ) : null}
      <div
        className="ml-swipe-pane"
        data-swipeable={onSwipeArchive ? 'true' : undefined}
        data-dragging={dragging ? 'true' : undefined}
        data-revealed={revealed ? 'true' : undefined}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={reset}
        onClickCapture={(e) => {
          // A swipe that ends on the row must not also open the message.
          if (swiped.current) {
            e.preventDefault();
            e.stopPropagation();
            swiped.current = false;
          }
        }}
        style={dx === 0 ? undefined : { transform: `translateX(${dx}px)` }}
      >
        <RowButton
          t={t}
          message={m}
          sender={sender}
          subject={subject}
          timestamp={timestamp}
          snoozedUntil={snoozedUntil}
          preview={preview}
          labels={[]}
          unread={unread}
          selected={false}
          compact
          onSelect={onSelect}
        />
        {starred ? <StarButton message={m} sender={sender} starred={starred} onToggleStar={onToggleStar} /> : null}
      </div>
    </li>
  );
};

export const MessageList: React.FC<MessageListProps> = ({
  t,
  messages,
  selectedId,
  onSelect,
  onToggleStar,
  onSwipeArchive,
  title,
  folder,
  subtitle,
  filter,
  onFilterChange,
  onMarkAllRead,
  onRefresh,
  isLoading,
  searchQuery,
  isDrafts = false,
  isSnoozed = false,
  compact = false,
  scrollMemory,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  loadFailed = false,
  onRetry
}) => {
  const tr = useT();
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
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

  const searching = searchQuery !== undefined && searchQuery !== '';
  // An empty Inbox with no search, filter or failed load is the "all caught up" screen, which Edgar owns; so is a list that could not load.
  const caughtUp = folder === 'inbox' && filter === 'all' && !loadFailed && !searching;

  return (
    <section aria-label={title} className="ml-root" data-compact={compact ? 'true' : undefined}>
      {compact ? null : (
        <div className="ml-head">
          <div className="ml-heading">
            <h1 id="list-title" className="ml-title">
              {title}
            </h1>
            <span className="ml-subtitle">{subtitle}</span>
          </div>
          <div className="ml-actions">
            {/* Drafts are never unread, so there is nothing to mark. */}
            {isDrafts ? null : (
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

      {/* Drafts are always read, unstarred and without attachments, so none of the filters could match anything there. The filters stay
          toggle buttons (aria-pressed), each a Tab stop, as they were. */}
      {isDrafts ? null : (
        <div className="ml-filters">
          <SegmentedControl
            label={tr('list.filter_label')}
            mode="toggle"
            wrap
            options={filterOptions(compact, tr)}
            value={filter}
            onChange={onFilterChange}
          />
        </div>
      )}

      <div
        ref={scrollerRef}
        onScroll={
          scrollMemory
            ? (e) => {
                // eslint-disable-next-line no-param-reassign, react-hooks/immutability -- scrollMemory is a ref object owned by the parent; writing .current is its purpose
                scrollMemory.current = e.currentTarget.scrollTop;
              }
            : undefined
        }
        className={compact ? 'ml-scroll nm-hide-scrollbar' : 'ml-scroll'}
        data-compact={compact ? 'true' : undefined}
      >
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
                const preview = snippetOf(m, 120);
                const sender = partyLabel(m, isDrafts, tr);
                const timestamp = isDrafts ? m.updated_at : m.created_at;
                const subject = subjectOf(m, tr('list.no_subject'));
                const snoozedUntil = m.folder === 'snoozed' && typeof m.snoozed_until === 'number' ? m.snoozed_until : null;

                if (compact) {
                  return (
                    <CompactRow
                      key={m.id}
                      t={t}
                      message={m}
                      sender={sender}
                      subject={subject}
                      timestamp={timestamp}
                      snoozedUntil={snoozedUntil}
                      preview={preview}
                      unread={unread}
                      starred={starred}
                      onSelect={onSelect}
                      onToggleStar={onToggleStar}
                      onSwipeArchive={onSwipeArchive}
                    />
                  );
                }

                return (
                  <li key={m.id} className="ml-item" data-star={isDrafts ? undefined : 'true'}>
                    <RowButton
                      t={t}
                      message={m}
                      sender={sender}
                      subject={subject}
                      timestamp={timestamp}
                      snoozedUntil={snoozedUntil}
                      preview={preview}
                      labels={labels}
                      unread={unread}
                      selected={selected}
                      compact={false}
                      onSelect={onSelect}
                    />
                    {isDrafts ? null : <StarButton message={m} sender={sender} starred={starred} onToggleStar={onToggleStar} />}
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
            title={
              loadFailed
                ? tr('list.load_failed')
                : filter === 'all'
                  ? searching
                    ? tr('list.no_results', { query: searchQuery })
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
                    ? tr('list.try_other_search')
                    : isDrafts
                      ? tr('list.hint_drafts')
                      : isSnoozed
                        ? tr('list.hint_snoozed')
                        : emptyHint(folder, tr)
                  : searching
                    ? tr('list.hint_clear_filter')
                    : tr('list.hint_switch_all')
            }
            action={loadFailed ? <Button onClick={onRetry}>{tr('common.retry')}</Button> : undefined}
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
    </section>
  );
};
