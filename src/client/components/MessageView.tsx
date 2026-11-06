import React from 'react';
import {
  Archive,
  Ban,
  ChevronLeft,
  ChevronRight,
  Download,
  Forward,
  Loader2,
  MailOpen,
  Paperclip,
  Plus,
  Reply,
  ReplyAll,
  Star,
  Tag,
  Trash2
} from 'lucide-react';
import type { Attachment, Message } from '../types';
import type { ThemeTokens } from '../theme';
import { FILE_HUES, getChip, getLabelChip } from '../theme';
import {
  LABEL_NAME_MAX,
  LABEL_NAME_PATTERN,
  MAX_LABELS_PER_MESSAGE,
  bodyParagraphs,
  displayName,
  fileTypeOf,
  formatBytes,
  formatFullDate,
  initialsOf,
  labelsOf,
  stringHue
} from '../lib/mail';
import { MailFrame } from './MailFrame';
import { SnoozeChip, SnoozeMenu } from './SnoozeMenu';

interface MessageViewProps {
  t: ThemeTokens;
  message: Message | null;
  attachments: Attachment[];
  isLoading: boolean;
  labels: string[];
  onReply: (message: Message) => void;
  onReplyAll: (message: Message) => void;
  onForward: (message: Message) => void;
  onToggleStar: (message: Message) => void;
  onArchive: (message: Message) => void;
  onTrash: (message: Message) => void;
  onSpam: (message: Message) => void;
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
  compact?: boolean;
}

const hasText = (value: string | null | undefined): value is string => value !== null && value !== undefined && value !== '';

type BarDensity = 'phone' | 'full' | 'snug' | 'tight';

// How the desktop reader toolbar fits its pane, from the pane's inner width. Worst case, all in px: 8 buttons of 40 (Snooze included),
// the 1 px divider, and the counter "100 of 100" (a list holds 100 mails: 71 of text + 2 x 8 padding = 87).
//   full:  side padding 12, gaps 2, divider margin 6  -> 24 + 320 + 20 + 13 + 87 = 464; the label menu (240) sits left-aligned on its
//          button at x = 237 and must fit as well (477), so 480
//   snug:  side padding 8, no gaps or margins          -> 16 + 320 + 1 + 87 = 424
//   tight: side padding 4, no counter                  -> 8 + 320 + 1 = 329 (the pane is 339 inside at the narrowest desktop window, 901)
const FULL_BAR_MIN = 480;
const SNUG_BAR_MIN = 424;

function barDensity(paneWidth: number | null): BarDensity {
  if (paneWidth === null || paneWidth >= FULL_BAR_MIN) {
    return 'full';
  }
  return paneWidth >= SNUG_BAR_MIN ? 'snug' : 'tight';
}

const BAR_LOOK: Record<BarDensity, { gap: number; padding: string; divider: string }> = {
  phone: { gap: 0, padding: '8px 8px', divider: '0 4px' },
  full: { gap: 2, padding: '8px 12px', divider: '0 6px' },
  snug: { gap: 0, padding: '8px 8px', divider: '0' },
  tight: { gap: 0, padding: '8px 4px', divider: '0' }
};

/** Ref for the element to measure: its inner width in px (null until it has one), kept current while it resizes. */
function usePaneWidth(): [(element: HTMLElement | null) => (() => void) | undefined, number | null] {
  const [width, setWidth] = React.useState<number | null>(null);
  const ref = React.useCallback((element: HTMLElement | null) => {
    if (element === null) {
      return;
    }
    const measure = () => setWidth(element.clientWidth > 0 ? element.clientWidth : null);
    // Measured as soon as it is attached, before the first paint: the bar never shows a frame in the wrong density.
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

const iconBtn = (t: ThemeTokens): React.CSSProperties => ({
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
});

/** Why `label` cannot be created (checked again by the server), or null when it can. */
function labelProblem(label: string, existing: string[], full: boolean): string | null {
  if (!LABEL_NAME_PATTERN.test(label)) {
    return 'Use letters, numbers, spaces, - and _ only.';
  }
  if (existing.some((name) => name.toLowerCase() === label.toLowerCase())) {
    return 'That label already exists.';
  }
  return full ? `A message can have ${MAX_LABELS_PER_MESSAGE} labels at most.` : null;
}

interface NewLabelRowProps {
  t: ThemeTokens;
  /** Every label already listed in the menu. */
  existing: string[];
  /** The open message already has the most labels it may have. */
  full: boolean;
  onCreate: (name: string) => void;
}

/** Last row of the label menu: type a name, press Enter (or the button) to create it and put it on the open message. */
const NewLabelRow: React.FC<NewLabelRowProps> = ({ t, existing, full, onCreate }) => {
  const [name, setName] = React.useState('');
  const [hint, setHint] = React.useState<string | null>(null);
  const blank = name.trim() === '';
  const hasList = existing.length > 0;
  // maxLength cuts a longer paste; this says so instead of leaving the field short without a word.
  const atLimit = name.length >= LABEL_NAME_MAX;
  const describedBy = hint === null ? (atLimit ? 'new-label-limit' : undefined) : 'new-label-hint';

  const submit = (event: React.SyntheticEvent) => {
    event.preventDefault();
    const label = name.trim();
    if (label === '') {
      return;
    }
    const problem = labelProblem(label, existing, full);
    setHint(problem);
    if (problem === null) {
      onCreate(label);
      setName('');
    }
  };

  return (
    <form onSubmit={submit} style={hasList ? { marginTop: 6, paddingTop: 6, borderTop: `1px solid ${t.border}` } : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input
          type="text"
          className="nm-tap-h"
          aria-label="New label"
          aria-invalid={hint !== null}
          aria-describedby={describedBy}
          placeholder="New label"
          autoComplete="off"
          maxLength={LABEL_NAME_MAX}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setHint(null);
          }}
          style={{
            flex: 1,
            minWidth: 0,
            height: 34,
            padding: '0 10px',
            border: `1px solid ${t.borderStrong}`,
            borderRadius: 8,
            background: t.surface,
            color: t.text,
            font: 'inherit',
            fontSize: 16
          }}
        />
        <button
          type="submit"
          aria-label="Create label"
          title="Create label"
          className="nm-tap"
          disabled={blank}
          style={{
            flex: 'none',
            width: 34,
            height: 34,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 0,
            borderRadius: 8,
            background: t.accent,
            color: '#FFFFFF',
            opacity: blank ? 0.4 : 1,
            cursor: blank ? 'default' : 'pointer'
          }}
        >
          <Plus size={18} strokeWidth={1.8} aria-hidden="true" />
        </button>
      </div>
      {hint === null ? (
        atLimit ? (
          <p id="new-label-limit" style={{ margin: '6px 2px 2px', fontSize: 12, lineHeight: '16px', color: t.text2 }}>
            {`Up to ${LABEL_NAME_MAX} characters`}
          </p>
        ) : null
      ) : (
        <p
          id="new-label-hint"
          role="alert"
          style={{ margin: '6px 2px 2px', fontSize: 12, lineHeight: '16px', color: t.dark ? '#F97066' : '#B42318' }}
        >
          {hint}
        </p>
      )}
    </form>
  );
};

export const MessageView: React.FC<MessageViewProps> = ({
  t,
  message,
  attachments,
  isLoading,
  labels,
  onReply,
  onReplyAll,
  onForward,
  onToggleStar,
  onArchive,
  onTrash,
  onSpam,
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
  compact = false
}) => {
  const [labelMenuOpen, setLabelMenuOpen] = React.useState(false);
  const labelMenuRef = React.useRef<HTMLDivElement | null>(null);
  const [showHtml, setShowHtml] = React.useState(true);
  const [paneRef, paneWidth] = usePaneWidth();

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the menu and HTML/plain toggle must reset whenever another message is shown
    setLabelMenuOpen(false);
    setShowHtml(true);
  }, [message?.id]);

  // Touch screens have no hover/blur, so a tap anywhere outside (or Escape) must close the label menu.
  React.useEffect(() => {
    if (!labelMenuOpen) {
      return;
    }
    const onPointerDown = (e: PointerEvent) => {
      if (labelMenuRef.current?.contains(e.target as Node) !== true) {
        setLabelMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLabelMenuOpen(false);
      }
    };
    // The body iframe is sandboxed (opaque origin), so its clicks never reach this document;
    // the window losing focus to the iframe is the only signal.
    const onWindowBlur = () => {
      if (document.activeElement instanceof HTMLIFrameElement) {
        setLabelMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onWindowBlur);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [labelMenuOpen]);

  const shell: React.CSSProperties = {
    flex: '999 1 480px',
    minWidth: 0,
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    background: t.surface,
    border: `1px solid ${t.border}`,
    borderRadius: 14,
    overflow: 'hidden',
    boxShadow: t.shadow
  };

  if (isLoading) {
    return (
      <article ref={paneRef} aria-busy="true" style={{ ...shell, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: t.text2 }}>
          <Loader2 size={18} className="nm-spin" aria-hidden="true" />
          <span>Loading message…</span>
        </div>
      </article>
    );
  }

  if (!message) {
    return (
      <article ref={paneRef} style={{ ...shell, alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, padding: 40, textAlign: 'center' }}>
          <img src="/edgar.svg" alt="" width={132} height={128} style={{ display: 'block', maxWidth: '100%', height: 'auto' }} />
          <p style={{ margin: '8px 0 0', fontSize: 15, fontWeight: 600 }}>No message selected</p>
          <p style={{ margin: 0, maxWidth: 280, color: t.text2, textWrap: 'balance' }}>Choose a message from the list to read it here.</p>
        </div>
      </article>
    );
  }

  const avatar = getChip(stringHue(message.from_address), t);
  const messageLabels = labelsOf(message);
  const paragraphs = bodyParagraphs(message, !showHtml);
  const starred = message.is_starred === 1;
  const sender = displayName(message);
  // Drafts and sent mail are not in the inbox flow, so there is nothing to snooze.
  const canSnooze = message.folder !== 'drafts' && message.folder !== 'sent';
  const snoozed = message.folder === 'snoozed';
  const snoozeUntil = snoozed && typeof message.snoozed_until === 'number' ? message.snoozed_until : null;
  // On a phone the toolbar buttons fill the width index.css gives them (the snooze and label buttons sit in a wrapper of that width).
  const barBtn: React.CSSProperties = compact ? { ...iconBtn(t), width: '100%' } : iconBtn(t);
  const density = compact ? 'phone' : barDensity(paneWidth);
  const look = BAR_LOOK[density];

  return (
    <article ref={paneRef} aria-labelledby="msg-subject" style={shell}>
      <div
        className={compact ? 'nm-bar' : 'nm-bar-d'}
        style={{
          display: 'flex',
          alignItems: 'center',
          // Seven 44px buttons fit one row on 360px and 390px phones with these tight gaps and side padding; on a 320px phone
          // index.css drops the padding and the buttons share the row (nm-bar), so the phone toolbar never wraps. On desktop the
          // pane's width picks the density (barDensity): wrap stays only as a safety net, the arithmetic keeps it to one row.
          gap: look.gap,
          flexWrap: compact ? 'nowrap' : 'wrap',
          padding: look.padding,
          borderBottom: `1px solid ${t.border}`
        }}
      >
        {onBack ? (
          <button type="button" aria-label="Back to list" title="Back" className="nm-tap" onClick={onBack} style={barBtn}>
            <ChevronLeft size={20} strokeWidth={1.8} aria-hidden="true" />
          </button>
        ) : null}
        <button type="button" aria-label="Archive" title="Archive" className="nm-tap" onClick={() => onArchive(message)} style={barBtn}>
          <Archive size={20} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button
          type="button"
          aria-label="Report spam"
          title="Report spam"
          className="nm-tap"
          onClick={() => onSpam(message)}
          style={barBtn}
        >
          <Ban size={20} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Delete" title="Delete" className="nm-tap" onClick={() => onTrash(message)} style={barBtn}>
          <Trash2 size={20} strokeWidth={1.8} aria-hidden="true" />
        </button>
        <span
          aria-hidden="true"
          className={compact ? 'nm-bar-sep' : undefined}
          style={{ width: 1, height: 20, margin: look.divider, background: t.border }}
        />
        <button
          type="button"
          aria-label="Mark as unread"
          title="Mark as unread"
          className="nm-tap"
          onClick={() => onMarkUnread(message)}
          style={barBtn}
        >
          <MailOpen size={20} strokeWidth={1.8} aria-hidden="true" />
        </button>
        {canSnooze ? (
          <SnoozeMenu
            // A new mail starts with the menu closed.
            key={message.id}
            t={t}
            buttonStyle={barBtn}
            snoozed={snoozed}
            onSnooze={(until) => onSnooze(message, until)}
            onUnsnooze={() => onUnsnooze(message)}
          />
        ) : null}
        <div ref={labelMenuRef} style={{ position: 'relative' }}>
          <button
            type="button"
            aria-label="Add label"
            title="Add label"
            className="nm-tap"
            aria-expanded={labelMenuOpen}
            onClick={() => setLabelMenuOpen((v) => !v)}
            style={labelMenuOpen ? { ...barBtn, background: t.hover } : barBtn}
          >
            <Tag size={20} strokeWidth={1.8} aria-hidden="true" />
          </button>
          {labelMenuOpen ? (
            <div
              role="menu"
              className="nm-fade-in"
              style={{
                position: 'absolute',
                // The toolbar sits at the right on phones, and on a narrow desktop pane the left-aligned 240px card would run past the
                // pane's edge (its overflow is clipped): anchor to the button's right edge there.
                ...(density === 'full' ? { left: 0 } : { right: 0 }),
                top: 44,
                zIndex: 20,
                width: 240,
                maxWidth: 'calc(100vw - 32px)',
                // The card clips its content: a long list scrolls inside the menu, the new-label row stays in view.
                maxHeight: 'min(380px, calc(100dvh - 160px))',
                display: 'flex',
                flexDirection: 'column',
                padding: 6,
                borderRadius: 12,
                border: `1px solid ${t.border}`,
                background: t.surface,
                boxShadow: '0 12px 32px rgba(16,24,40,0.16)'
              }}
            >
              <div style={{ minHeight: 0, overflowY: 'auto' }}>
                {labels.map((label) => {
                  const on = messageLabels.includes(label);
                  const chip = getLabelChip(label, t);
                  return (
                    <button
                      key={label}
                      type="button"
                      role="menuitemcheckbox"
                      className="nm-tap-h"
                      aria-checked={on}
                      onClick={() => onToggleLabel(message, label)}
                      style={{
                        width: '100%',
                        height: 34,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '0 8px',
                        border: 0,
                        borderRadius: 8,
                        background: 'transparent',
                        color: t.text,
                        fontSize: 13,
                        textAlign: 'left',
                        cursor: 'pointer'
                      }}
                    >
                      <span aria-hidden="true" style={{ flex: 'none', width: 8, height: 8, borderRadius: 2, background: chip.dot }} />
                      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {label}
                      </span>
                      {on ? <span style={{ flex: 'none', color: t.link, fontSize: 12, fontWeight: 600 }}>Added</span> : null}
                    </button>
                  );
                })}
              </div>
              <NewLabelRow
                t={t}
                existing={labels}
                full={messageLabels.length >= MAX_LABELS_PER_MESSAGE}
                onCreate={(name) => onToggleLabel(message, name)}
              />
            </div>
          ) : null}
        </div>

        <span style={{ flex: 1 }} />
        {compact ? null : (
          <>
            {density === 'tight' ? null : (
              <span style={{ padding: '0 8px', fontSize: 13, color: t.text2, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                {position}
              </span>
            )}
            <button
              type="button"
              aria-label="Newer message"
              title="Newer"
              disabled={!hasPrev}
              onClick={onPrev}
              style={{ ...iconBtn(t), opacity: hasPrev ? 1 : 0.4, cursor: hasPrev ? 'pointer' : 'default' }}
            >
              <ChevronLeft size={20} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Older message"
              title="Older"
              disabled={!hasNext}
              onClick={onNext}
              style={{ ...iconBtn(t), opacity: hasNext ? 1 : 0.4, cursor: hasNext ? 'pointer' : 'default' }}
            >
              <ChevronRight size={20} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        <div style={{ maxWidth: 760, margin: '0 auto', padding: compact ? '20px 20px 32px' : '28px 32px 40px' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 24 }}>
            <h2
              id="msg-subject"
              style={{
                margin: 0,
                fontSize: compact ? 21 : 24,
                lineHeight: compact ? '28px' : '32px',
                fontWeight: 600,
                letterSpacing: '-0.015em',
                color: t.text,
                overflowWrap: 'anywhere',
                textWrap: 'balance'
              }}
            >
              {message.subject || '(No subject)'}
            </h2>
            {messageLabels.length > 0 || snoozeUntil !== null ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                {snoozeUntil === null ? null : <SnoozeChip t={t} until={snoozeUntil} />}
                {messageLabels.map((label) => {
                  const chip = getLabelChip(label, t);
                  return (
                    <span
                      key={label}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        height: 24,
                        padding: '0 10px',
                        borderRadius: 6,
                        background: chip.bg,
                        color: chip.fg,
                        fontSize: 12,
                        lineHeight: '16px',
                        fontWeight: 500
                      }}
                    >
                      <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 2, background: chip.dot }} />
                      {label}
                    </span>
                  );
                })}
              </div>
            ) : null}
          </div>

          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
            <span
              aria-hidden="true"
              style={{
                width: 44,
                height: 44,
                flex: 'none',
                borderRadius: '50%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: avatar.bg,
                color: avatar.fg,
                fontSize: 15,
                fontWeight: 600
              }}
            >
              {initialsOf(message.from_name, message.from_address)}
            </span>
            <div style={{ flex: '1 1 180px', minWidth: 160, display: 'flex', flexDirection: 'column', gap: 2 }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 15, lineHeight: '22px', fontWeight: 600, overflowWrap: 'anywhere' }}>{sender}</span>
                {/* A sender without a display name is already shown as the address. */}
                {sender === message.from_address ? null : (
                  <span style={{ fontSize: 13, color: t.text2, overflow: 'hidden', textOverflow: 'ellipsis' }}>{message.from_address}</span>
                )}
              </div>
              <span style={{ fontSize: 13, color: t.text2, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                to {message.to_address}
                {hasText(message.cc) ? `, cc ${message.cc}` : ''}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                flex: 'none',
                marginLeft: 'auto',
                flexWrap: 'wrap',
                justifyContent: 'flex-end'
              }}
            >
              <span style={{ marginRight: 6, fontSize: 13, color: t.text2, whiteSpace: 'nowrap' }}>
                {formatFullDate(message.created_at)}
              </span>
              <button
                type="button"
                aria-label="Star"
                aria-pressed={starred}
                className="nm-tap"
                onClick={() => onToggleStar(message)}
                style={{ ...iconBtn(t), color: starred ? t.star : t.text2 }}
              >
                <Star size={20} strokeWidth={1.8} fill={starred ? t.star : 'none'} aria-hidden="true" />
              </button>
              <button type="button" aria-label="Reply" title="Reply" className="nm-tap" onClick={() => onReply(message)} style={iconBtn(t)}>
                <Reply size={20} strokeWidth={1.8} aria-hidden="true" />
              </button>
            </div>
          </div>

          {hasText(message.body_html) && hasText(message.body_text) ? (
            <div
              style={{
                display: 'inline-flex',
                marginBottom: 16,
                padding: 2,
                borderRadius: 9,
                border: `1px solid ${t.border}`,
                background: t.raised
              }}
            >
              {[
                { id: true, label: 'HTML' },
                { id: false, label: 'Plain text' }
              ].map((mode) => (
                <button
                  key={mode.label}
                  type="button"
                  className="nm-tap-h"
                  onClick={() => setShowHtml(mode.id)}
                  style={{
                    height: 26,
                    padding: '0 10px',
                    border: 0,
                    borderRadius: 7,
                    background: showHtml === mode.id ? t.surface : 'transparent',
                    color: showHtml === mode.id ? t.text : t.text2,
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: 'pointer',
                    boxShadow: showHtml === mode.id ? '0 1px 2px rgba(16,24,40,0.08)' : 'none'
                  }}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          ) : null}

          {hasText(message.body_html) && showHtml ? (
            <MailFrame key={message.id} html={message.body_html} t={t} />
          ) : (
            <div style={{ maxWidth: '68ch', fontSize: 15, lineHeight: '24px', color: t.text }}>
              {paragraphs.map((p, i) => (
                // eslint-disable-next-line react/no-array-index-key -- paragraphs are plain strings that can repeat and are never reordered
                <p key={i} style={{ margin: '0 0 16px', whiteSpace: 'pre-line', textWrap: 'pretty' }}>
                  {p}
                </p>
              ))}
            </div>
          )}

          {attachments.length > 0 ? (
            <section aria-label="Attachments" style={{ marginTop: 24, paddingTop: 20, borderTop: `1px solid ${t.border}` }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
                <h3 style={{ margin: 0, fontSize: 13, lineHeight: '20px', fontWeight: 600, color: t.text2 }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Paperclip size={14} strokeWidth={2} aria-hidden="true" />
                    {attachments.length} {attachments.length === 1 ? 'attachment' : 'attachments'} ·{' '}
                    {formatBytes(attachments.reduce((sum, a) => sum + a.size, 0))}
                  </span>
                </h3>
              </div>
              <ul
                role="list"
                style={{
                  listStyle: 'none',
                  margin: 0,
                  padding: 0,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(min(240px, 100%), 1fr))',
                  gap: 12
                }}
              >
                {attachments.map((att) => {
                  const type = fileTypeOf(att.filename);
                  const chip = getChip(FILE_HUES[type] || '#475569', t);
                  return (
                    <li
                      key={att.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 8px 10px 12px',
                        border: `1px solid ${t.border}`,
                        borderRadius: 12,
                        background: t.raised
                      }}
                    >
                      <span
                        aria-hidden="true"
                        style={{
                          width: 40,
                          height: 40,
                          flex: 'none',
                          borderRadius: 8,
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          background: chip.bg,
                          color: chip.fg,
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: '0.04em'
                        }}
                      >
                        {type}
                      </span>
                      <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 500 }}>
                          {att.filename}
                        </span>
                        <span style={{ fontSize: 12, lineHeight: '16px', color: t.text3 }}>{formatBytes(att.size)}</span>
                      </span>
                      <a
                        href={`/api/attachments/${att.id}`}
                        download={att.filename}
                        aria-label={`Download ${att.filename}`}
                        title="Download"
                        className="nm-tap"
                        style={{
                          width: 36,
                          height: 36,
                          flex: 'none',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          border: 0,
                          borderRadius: 8,
                          color: t.text2,
                          textDecoration: 'none'
                        }}
                      >
                        <Download size={18} strokeWidth={1.8} aria-hidden="true" />
                      </a>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 28 }}>
            {[
              { label: 'Reply', icon: Reply, action: () => onReply(message) },
              { label: 'Reply all', icon: ReplyAll, action: () => onReplyAll(message) },
              { label: 'Forward', icon: Forward, action: () => onForward(message) }
            ].map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.label}
                  type="button"
                  className="nm-tap-h"
                  onClick={item.action}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    // Phone: the three share one row at equal widths. Each keeps its whole label as its minimum width, so where the
                    // row cannot hold all three (under ~360px) it wraps and the last one fills its own row instead of standing narrow.
                    ...(compact ? { flex: '1 1 0', justifyContent: 'center', whiteSpace: 'nowrap' } : {}),
                    gap: 8,
                    height: 40,
                    padding: compact ? '0 6px' : '0 16px',
                    border: `1px solid ${t.borderStrong}`,
                    borderRadius: 10,
                    background: t.surface,
                    color: t.text,
                    fontSize: 14,
                    fontWeight: 500,
                    cursor: 'pointer'
                  }}
                >
                  <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </article>
  );
};
