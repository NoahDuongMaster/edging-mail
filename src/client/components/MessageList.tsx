import React from 'react';
import { Archive, CheckCheck, FileText, Inbox, Loader2, Paperclip, RefreshCw, Star } from 'lucide-react';
import type { Message } from '../types';
import type { ThemeTokens } from '../theme';
import { getChip, getLabelChip } from '../theme';
import { GROUP_ORDER, displayName, formatRowTime, groupOf, initialsOf, labelsOf, nonEmpty, snippetOf, stringHue } from '../lib/mail';
import { SNOOZE_GROUP_ORDER, snoozeGroupOf } from '../lib/snooze';
import { SnoozeChip } from './SnoozeMenu';

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
}

const FILTERS: { id: MailFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'unread', label: 'Unread' },
  { id: 'attachments', label: 'Attachments' }
];

// The mobile board adds a Starred chip between Unread and Attachments.
const COMPACT_FILTERS: { id: MailFilter; label: string }[] = [FILTERS[0], FILTERS[1], { id: 'starred', label: 'Starred' }, FILTERS[2]];

const SWIPE_REVEAL = 96;
const SWIPE_ARCHIVE_BG = '#0F766E';

/** How a row names the other side: the sender, or in Drafts the recipients ('No recipient' when none is set yet). */
function partyOf(m: Message, isDrafts: boolean) {
  if (!isDrafts) {
    return { label: displayName(m), seed: m.from_address, avatar: initialsOf(m.from_name, m.from_address) };
  }
  const recipients = nonEmpty(m.to_address.trim());
  const first = recipients?.split(/[,;]/, 1)[0].trim();
  return {
    label: recipients === undefined ? 'No recipient' : `To: ${recipients}`,
    seed: first ?? '',
    avatar: first === undefined || first === '' ? <FileText size={16} strokeWidth={1.8} aria-hidden="true" /> : initialsOf(undefined, first)
  };
}

interface CompactRowProps {
  t: ThemeTokens;
  message: Message;
  sender: string;
  /** Initials, or an icon for a draft without recipient. */
  avatarContent: React.ReactNode;
  subject: string;
  timestamp: number;
  /** Wake time of a snoozed mail: shown in place of the date, because that is what matters in the Snoozed folder. */
  snoozedUntil: number | null;
  preview: string;
  avatar: { bg: string; fg: string };
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
  avatarContent,
  subject,
  timestamp,
  snoozedUntil,
  preview,
  avatar,
  unread,
  starred,
  onSelect,
  onToggleStar,
  onSwipeArchive
}) => {
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
    <li ref={rowRef} style={{ position: 'relative', overflow: 'hidden', background: revealed ? SWIPE_ARCHIVE_BG : 'transparent' }}>
      {revealed ? (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: 0,
            top: 0,
            bottom: 0,
            width: SWIPE_REVEAL,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 4,
            color: '#FFFFFF',
            fontSize: 12,
            lineHeight: '16px',
            fontWeight: 600
          }}
        >
          <Archive size={22} strokeWidth={1.8} />
          Archive
        </span>
      ) : null}
      <div
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
        style={{
          position: 'relative',
          background: t.surface,
          touchAction: onSwipeArchive ? 'pan-y' : undefined,
          transform: dx !== 0 ? `translateX(${dx}px)` : undefined,
          transition: dragging ? 'none' : 'transform 0.16s ease-out',
          boxShadow: revealed ? '8px 0 16px -8px rgba(16,24,40,0.24)' : undefined
        }}
      >
        <button
          type="button"
          onClick={() => onSelect(m.id)}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '12px 16px 12px 8px',
            border: 0,
            borderBottom: `1px solid ${t.divider}`,
            background: 'transparent',
            color: t.text,
            font: 'inherit',
            textAlign: 'left',
            cursor: 'pointer'
          }}
        >
          <span aria-hidden="true" style={{ width: 8, flex: 'none', display: 'flex', paddingTop: 16 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: unread ? t.unreadDot : 'transparent' }} />
          </span>
          <span
            aria-hidden="true"
            style={{
              width: 40,
              height: 40,
              flex: 'none',
              borderRadius: '50%',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: avatar.bg,
              color: avatar.fg,
              fontSize: 14,
              fontWeight: 600
            }}
          >
            {avatarContent}
          </span>
          <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {unread ? (
                <span
                  style={{
                    position: 'absolute',
                    width: 1,
                    height: 1,
                    margin: -1,
                    overflow: 'hidden',
                    clip: 'rect(0, 0, 0, 0)',
                    whiteSpace: 'nowrap'
                  }}
                >
                  Unread.
                </span>
              ) : null}
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: 15,
                  lineHeight: '22px',
                  fontWeight: unread ? 600 : 500
                }}
              >
                {sender}
              </span>
              {m.has_attachments === 1 ? (
                <Paperclip role="img" aria-label="Has attachments" size={14} strokeWidth={2} color={t.text3} style={{ flex: 'none' }} />
              ) : null}
              {snoozedUntil === null ? (
                <span
                  style={{
                    flex: 'none',
                    fontSize: 12,
                    lineHeight: '16px',
                    fontWeight: unread ? 600 : 400,
                    color: unread ? t.text : t.text3
                  }}
                >
                  {formatRowTime(timestamp)}
                </span>
              ) : (
                <span style={{ flex: '0 1 auto', minWidth: 0, display: 'flex' }}>
                  <SnoozeChip t={t} until={snoozedUntil} bare />
                </span>
              )}
            </span>
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontWeight: unread ? 600 : 400
              }}
            >
              {subject}
            </span>
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                paddingRight: 24,
                fontSize: 13,
                lineHeight: '18px',
                color: t.text2
              }}
            >
              {preview}
            </span>
          </span>
        </button>
        {starred ? (
          <button
            type="button"
            className="nm-tap-ext"
            aria-label={`Unstar conversation from ${sender}`}
            aria-pressed={starred}
            onClick={() => onToggleStar(m)}
            style={{
              position: 'absolute',
              right: 4,
              top: 49,
              width: 40,
              height: 36,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: 0,
              background: 'transparent',
              color: t.star,
              cursor: 'pointer'
            }}
          >
            <Star size={16} strokeWidth={1.8} fill={t.star} aria-hidden="true" />
          </button>
        ) : null}
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
  onLoadMore
}) => {
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
          : 'Later'
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
      return items ? [{ label: g, items }] : [];
    });
  }, [messages, isDrafts, isSnoozed]);

  return (
    <section
      aria-labelledby="list-title"
      style={{
        flex: '1 1 400px',
        minWidth: 0,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        background: t.surface,
        border: compact ? 0 : `1px solid ${t.border}`,
        borderRadius: compact ? 0 : 14,
        overflow: 'hidden',
        boxShadow: compact ? 'none' : t.shadow
      }}
    >
      {compact ? null : (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            // Drafts have no filter row below, so the header closes the list head itself.
            padding: isDrafts ? '12px 8px 8px 20px' : '12px 8px 4px 20px',
            borderBottom: isDrafts ? `1px solid ${t.border}` : undefined
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0 }}>
            <h1
              id="list-title"
              style={{ margin: 0, fontSize: 20, lineHeight: '28px', fontWeight: 600, letterSpacing: '-0.01em', whiteSpace: 'nowrap' }}
            >
              {title}
            </h1>
            <span style={{ fontSize: 13, color: t.text2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {subtitle}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 2 }}>
            {/* Drafts are never unread, so there is nothing to mark. */}
            {isDrafts ? null : (
              <button
                type="button"
                aria-label="Mark all as read"
                title="Mark all as read"
                onClick={onMarkAllRead}
                style={{
                  width: 40,
                  height: 40,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: 0,
                  borderRadius: 10,
                  background: 'transparent',
                  color: t.text2,
                  cursor: 'pointer'
                }}
              >
                <CheckCheck size={20} strokeWidth={1.8} aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              aria-label="Refresh"
              title="Refresh"
              onClick={onRefresh}
              style={{
                width: 40,
                height: 40,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 0,
                borderRadius: 10,
                background: 'transparent',
                color: t.text2,
                cursor: 'pointer'
              }}
            >
              <RefreshCw size={20} strokeWidth={1.8} className={isLoading ? 'nm-spin' : undefined} aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      {/* Drafts are always read, unstarred and without attachments, so none of the filters could match anything there. */}
      {isDrafts ? null : (
        <div
          className={compact ? 'nm-hide-scrollbar' : undefined}
          style={
            compact
              ? { display: 'flex', gap: 2, overflowX: 'auto', padding: '4px 12px 4px' }
              : { display: 'flex', gap: 8, flexWrap: 'wrap', padding: '8px 16px 12px 20px', borderBottom: `1px solid ${t.border}` }
          }
        >
          {(compact ? COMPACT_FILTERS : FILTERS).map((f) => {
            const on = filter === f.id;
            if (compact) {
              // 44px touch target around a 34px pill, as on the mobile board.
              return (
                <button
                  key={f.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => onFilterChange(f.id)}
                  style={{
                    flex: 'none',
                    height: 44,
                    padding: '0 2px',
                    border: 0,
                    background: 'transparent',
                    font: 'inherit',
                    cursor: 'pointer'
                  }}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      height: 34,
                      padding: '0 14px',
                      border: `1px solid ${on ? t.text : t.borderStrong}`,
                      borderRadius: 999,
                      background: on ? t.text : 'transparent',
                      color: on ? t.surface : t.text2,
                      fontSize: 13,
                      fontWeight: 500
                    }}
                  >
                    {f.label}
                  </span>
                </button>
              );
            }
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={on}
                onClick={() => onFilterChange(f.id)}
                style={{
                  height: 32,
                  padding: '0 14px',
                  border: `1px solid ${on ? t.text : t.borderStrong}`,
                  borderRadius: 999,
                  background: on ? t.text : 'transparent',
                  color: on ? t.surface : t.text2,
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                {f.label}
              </button>
            );
          })}
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
        className={compact ? 'nm-hide-scrollbar' : undefined}
        style={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          padding: compact ? '0' : '4px 8px 12px',
          borderTop: compact ? `1px solid ${t.divider}` : undefined
        }}
      >
        {isLoading && groups.length === 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '72px 24px', color: t.text2 }}>
            <Loader2 size={18} className="nm-spin" aria-hidden="true" />
            <span>Loading conversations…</span>
          </div>
        ) : null}

        {groups.map((g) => (
          <div key={g.label}>
            <h2
              style={{
                margin: 0,
                padding: compact ? '14px 16px 6px' : '14px 12px 6px 28px',
                fontSize: 12,
                lineHeight: '16px',
                fontWeight: 600,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: t.text2
              }}
            >
              {g.label}
            </h2>
            <ul
              role="list"
              style={{
                listStyle: 'none',
                margin: 0,
                // Clearance for the floating Compose button under the last group (120px on the board); the Load more button carries it when shown.
                padding: compact && g === groups.at(-1) && !hasMore ? '0 0 120px' : 0,
                display: 'flex',
                flexDirection: 'column',
                gap: compact ? 0 : 2
              }}
            >
              {g.items.map((m) => {
                const selected = m.id === selectedId;
                const unread = m.is_read === 0;
                const starred = m.is_starred === 1;
                const party = partyOf(m, isDrafts);
                const avatar = getChip(stringHue(party.seed), t);
                const labels = labelsOf(m);
                const preview = snippetOf(m, 120);
                const sender = party.label;
                const timestamp = isDrafts ? m.updated_at : m.created_at;
                const subject = m.subject || (isDrafts ? '(no subject)' : '(No subject)');
                const snoozedUntil = m.folder === 'snoozed' && typeof m.snoozed_until === 'number' ? m.snoozed_until : null;

                if (compact) {
                  return (
                    <CompactRow
                      key={m.id}
                      t={t}
                      message={m}
                      sender={sender}
                      avatarContent={party.avatar}
                      subject={subject}
                      timestamp={timestamp}
                      snoozedUntil={snoozedUntil}
                      preview={preview}
                      avatar={avatar}
                      unread={unread}
                      starred={starred}
                      onSelect={onSelect}
                      onToggleStar={onToggleStar}
                      onSwipeArchive={onSwipeArchive}
                    />
                  );
                }

                return (
                  <li key={m.id} style={{ position: 'relative' }}>
                    <button
                      type="button"
                      onClick={() => onSelect(m.id)}
                      aria-current={selected ? 'true' : undefined}
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 8,
                        padding: '12px 12px 12px 8px',
                        border: 0,
                        borderBottom: 0,
                        borderRadius: 10,
                        background: selected ? t.selBg : 'transparent',
                        color: t.text,
                        textAlign: 'left',
                        cursor: 'pointer'
                      }}
                    >
                      <span aria-hidden="true" style={{ width: 8, flex: 'none', display: 'flex', paddingTop: 14 }}>
                        <span
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            background: unread ? t.unreadDot : 'transparent'
                          }}
                        />
                      </span>
                      <span
                        aria-hidden="true"
                        style={{
                          width: 36,
                          height: 36,
                          flex: 'none',
                          marginRight: 4,
                          borderRadius: '50%',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: avatar.bg,
                          color: avatar.fg,
                          fontSize: 13,
                          fontWeight: 600
                        }}
                      >
                        {party.avatar}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
                        {unread ? (
                          <span
                            style={{
                              position: 'absolute',
                              width: 1,
                              height: 1,
                              margin: -1,
                              overflow: 'hidden',
                              clip: 'rect(0, 0, 0, 0)',
                              whiteSpace: 'nowrap'
                            }}
                          >
                            Unread.
                          </span>
                        ) : null}
                        <span style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                          <span
                            style={{
                              flex: 1,
                              minWidth: 0,
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              fontWeight: unread ? 600 : 500
                            }}
                          >
                            {sender}
                          </span>
                          <span
                            style={{
                              flex: 'none',
                              fontSize: 12,
                              lineHeight: '16px',
                              color: unread ? t.text : t.text3,
                              fontWeight: unread ? 600 : 400,
                              fontVariantNumeric: 'tabular-nums'
                            }}
                          >
                            {formatRowTime(timestamp)}
                          </span>
                        </span>
                        <span
                          style={{
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            paddingRight: 32,
                            fontWeight: unread ? 600 : 400
                          }}
                        >
                          {subject}
                        </span>
                        {preview ? (
                          <span
                            style={{
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              paddingRight: 8,
                              fontSize: 13,
                              lineHeight: '18px',
                              color: t.text2
                            }}
                          >
                            {preview}
                          </span>
                        ) : null}
                        {labels.length > 0 || m.has_attachments === 1 || snoozedUntil !== null ? (
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, minWidth: 0, overflow: 'hidden' }}>
                            {snoozedUntil === null ? null : <SnoozeChip t={t} until={snoozedUntil} selected={selected} />}
                            {labels.map((label) => {
                              const chip = getLabelChip(label, t);
                              return (
                                <span
                                  key={label}
                                  style={{
                                    flex: '0 1 auto',
                                    minWidth: 0,
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 6,
                                    height: 22,
                                    padding: '0 8px',
                                    borderRadius: 6,
                                    background: chip.bg,
                                    color: chip.fg,
                                    fontSize: 12,
                                    lineHeight: '16px',
                                    fontWeight: 500
                                  }}
                                >
                                  <span
                                    aria-hidden="true"
                                    style={{ flex: 'none', width: 6, height: 6, borderRadius: 2, background: chip.dot }}
                                  />
                                  <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {label}
                                  </span>
                                </span>
                              );
                            })}
                            {m.has_attachments === 1 ? (
                              <span
                                style={{
                                  minWidth: 0,
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  height: 22,
                                  padding: '0 8px',
                                  borderRadius: 6,
                                  border: `1px solid ${t.border}`,
                                  color: t.text2,
                                  fontSize: 12,
                                  lineHeight: '16px'
                                }}
                              >
                                <Paperclip size={12} strokeWidth={2} aria-hidden="true" style={{ flex: 'none' }} />
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>Attachment</span>
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    {isDrafts ? null : (
                      <button
                        type="button"
                        aria-label={starred ? `Unstar conversation from ${sender}` : `Star conversation from ${sender}`}
                        aria-pressed={starred}
                        onClick={() => onToggleStar(m)}
                        style={{
                          position: 'absolute',
                          right: 8,
                          top: 26,
                          width: 32,
                          height: 32,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: 0,
                          borderRadius: 8,
                          background: 'transparent',
                          color: starred ? t.star : t.text3,
                          cursor: 'pointer'
                        }}
                      >
                        <Star size={16} strokeWidth={1.8} fill={starred ? t.star : 'none'} aria-hidden="true" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {!isLoading && groups.length === 0 ? (
          <div
            style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: '72px 24px', textAlign: 'center' }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 56,
                height: 56,
                borderRadius: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: t.raised,
                border: `1px solid ${t.border}`,
                color: t.text2
              }}
            >
              <Inbox size={24} strokeWidth={1.8} />
            </span>
            <p style={{ margin: '8px 0 0', fontSize: 15, fontWeight: 600, overflowWrap: 'anywhere' }}>
              {filter === 'all'
                ? searchQuery !== undefined && searchQuery !== ''
                  ? `No results for “${searchQuery}”`
                  : `No conversations in ${title}`
                : 'Nothing matches this filter'}
            </p>
            <p style={{ margin: 0, maxWidth: 280, color: t.text2 }}>
              {filter === 'all'
                ? searchQuery !== undefined && searchQuery !== ''
                  ? 'Try a different search.'
                  : isDrafts
                    ? 'Drafts you start are saved here.'
                    : isSnoozed
                      ? 'Snoozed messages come back to your inbox at the time you pick.'
                      : 'Messages you receive will appear in this list.'
                : 'Switch back to All to see every conversation.'}
            </p>
          </div>
        ) : null}

        {hasMore ? (
          <div style={{ padding: compact ? '12px 16px 120px' : '8px 0 0' }}>
            <button
              type="button"
              // aria-disabled, not disabled: the button keeps keyboard focus while it loads.
              aria-disabled={loadingMore || undefined}
              onClick={() => {
                if (!loadingMore) {
                  onLoadMore?.();
                }
              }}
              style={{
                width: '100%',
                height: 44,
                border: `1px solid ${t.borderStrong}`,
                borderRadius: 10,
                background: 'transparent',
                color: t.text2,
                font: 'inherit',
                fontSize: 14,
                fontWeight: 500,
                cursor: loadingMore ? 'default' : 'pointer'
              }}
            >
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
};
