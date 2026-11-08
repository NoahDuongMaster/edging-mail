import React from 'react';
import {
  Archive,
  Ban,
  ChevronLeft,
  ChevronRight,
  Download,
  Forward,
  Inbox,
  MailOpen,
  MailX,
  Paperclip,
  Reply,
  ReplyAll,
  Star,
  Trash2,
  type LucideIcon
} from 'lucide-react';
import type { Attachment, Message } from '../types';
import type { ThemeTokens } from '../theme';
import { getFileChip, getLabelChip } from '../theme';
import { arrivedUnverified, bodyParagraphs, displayName, fileTypeOf, formatBytes, formatFullDate, labelsOf, subjectOf } from '../lib/mail';
import { useT } from '../lib/i18n';
import { getUnlockedKey } from '../lib/crypto/keyStore';
import { loadEmbeddedImages } from '../lib/mailcrypto/inline';
import { safeFileName } from '../lib/mailcrypto/files';
import { NOTE_KEYS, isUnreadable } from '../lib/mailcrypto/texts';
import { useMailDownloads } from '../lib/mailcrypto/useMailDownloads';
import { Avatar, Banner, Button, Chip, Disclosure, Divider, EmptyState, IconButton, SegmentedControl, Spinner, Tooltip } from '../ui';
import { cx } from '../ui/cx';
import { E2eBadge } from './E2eBadge';
import { UnverifiedChip } from './UnverifiedChip';
import { MailFrame } from './MailFrame';
import { SnoozeChip, SnoozeMenu } from './SnoozeMenu';
import { LabelMenu } from './reader/LabelMenu';
import { barDensity, replyDensity, usePaneMeasure, type BarDensity } from './reader/barDensity';
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
  compact?: boolean;
}

const hasText = (value: string | null | undefined): value is string => value !== null && value !== undefined && value !== '';

/** The Snooze button asks for the look of the other toolbar buttons; they are styled by class (`.rd-bar` in reader.css), so there is nothing to add. */
const NO_STYLE: React.CSSProperties = {};

interface BarButtonProps {
  label: string;
  icon: LucideIcon;
  iconSize: number;
  onClick: () => void;
  disabled?: boolean;
  /** Delete forever: the one red button of the bar. */
  danger?: boolean;
}

/** One button of the toolbar: an icon, named by its label (which is also its tooltip). */
const BarButton: React.FC<BarButtonProps> = ({ label, icon: Icon, iconSize, onClick, disabled = false, danger = false }) => (
  <IconButton label={label} size="sm" className={cx(danger && 'rd-danger')} disabled={disabled} onClick={onClick}>
    <Icon size={iconSize} strokeWidth={1.75} aria-hidden="true" />
  </IconButton>
);

interface DownloadLinkProps {
  href: string;
  /** The name the browser saves the file under. */
  download: string;
  label: string;
  children: React.ReactNode;
}

/** The download control of a plain attachment: a link (so the browser saves the file itself) that looks and names itself like an IconButton. */
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
        className="ui-btn ui-icon-btn"
        data-variant="ghost"
        data-size="sm"
        onPointerEnter={(event) => setTip(event.pointerType === 'mouse')}
        onPointerLeave={() => setTip(false)}
        onPointerDown={() => setTip(false)}
        onFocus={(event) => setTip(event.currentTarget.matches(':focus-visible'))}
        onBlur={() => setTip(false)}
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
  compact = false
}) => {
  const tr = useT();
  const downloads = useMailDownloads(message, onNotice);
  const [showHtml, setShowHtml] = React.useState(true);
  const [recipientsOpen, setRecipientsOpen] = React.useState(false);
  const [paneRef, pane] = usePaneMeasure();
  // The reply row is measured on its own: its width is the column's, scrollbar and page margins included.
  const [replyRef, replyRow] = usePaneMeasure();
  // The sender's address and the recipients are one line each, cut with an ellipsis where they do not fit.
  const [addrRef, addrCut] = useCutLine(message?.from_address ?? '');
  const [rcptRef, rcptCut] = useCutLine(`${message?.to_address ?? ''}\n${message?.cc ?? ''}`);

  React.useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the HTML/plain toggle and the recipients must reset whenever another message is shown
    setShowHtml(true);
    setRecipientsOpen(false);
  }, [message?.id]);

  if (isLoading) {
    return (
      <article ref={paneRef} aria-busy="true" className="rd-root" data-state="loading">
        <div className="rd-loading" role="status">
          <Spinner decorative />
          <span>{tr('reader.loading_message')}</span>
        </div>
      </article>
    );
  }

  if (!message) {
    return (
      <article ref={paneRef} className="rd-root" data-state="empty">
        {listEmpty ? (
          <EmptyState className="rd-idle" title={tr('reader.none_selected')} />
        ) : (
          <EmptyState illustration title={tr('reader.none_selected')} description={tr('reader.none_selected_hint')} />
        )}
      </article>
    );
  }

  const messageLabels = labelsOf(message);
  const paragraphs = bodyParagraphs(message, !showHtml);
  const starred = message.is_starred === 1;
  const sender = displayName(message);
  const inTrash = message.folder === 'trash';
  const inSpam = message.folder === 'spam';
  const inBin = inTrash || inSpam;
  // Drafts, sent mail, Trash and Spam are not in the inbox flow, so there is nothing to snooze. In Trash and Spam the bar also gains
  // Move to Inbox and Delete forever: dropping Snooze keeps it at the 8 buttons the density arithmetic (reader/barDensity.ts) and a 320px phone allow.
  const canSnooze = message.folder !== 'drafts' && message.folder !== 'sent' && !inBin;
  const snoozed = message.folder === 'snoozed';
  const snoozeUntil = snoozed && typeof message.snoozed_until === 'number' ? message.snoozed_until : null;
  const density: BarDensity = compact ? 'phone' : barDensity(pane.width, pane.coarse);
  const showCount = !compact && density !== 'tight';
  const iconSize = compact ? 20 : 16;
  const sealed = message.is_e2e === 1 && message.mail_state === 'ready';
  const unverified = arrivedUnverified(message);
  const recipients = hasText(message.cc)
    ? tr('reader.to_cc_line', { to: message.to_address, cc: message.cc })
    : tr('reader.to_line', { to: message.to_address });
  // The recipients open in place (a Disclosure) only when there is something to show: the line, or the sender's address, is cut. Until the
  // lines are measured (the first render, the server), a line of more than one recipient is taken as cut.
  const manyRecipients = hasText(message.cc) || message.to_address.includes(',');
  const offerAll = recipientsOpen || addrCut === true || (rcptCut ?? manyRecipients);
  const recipientsLine = (
    <span ref={rcptRef} className="rd-rcpt-text">
      {recipients}
    </span>
  );
  // On a desktop the row of Reply, Reply all and Forward takes smaller buttons, then drops their icons, before it would wrap.
  const reply = compact ? 'full' : replyDensity(replyRow.width);
  const replyActions = [
    { label: tr('action.reply'), icon: Reply, action: () => onReply(message) },
    { label: tr('action.reply_all'), icon: ReplyAll, action: () => onReplyAll(message) },
    // A message the browser could not open has no content to forward.
    ...(isUnreadable(message.mail_state) ? [] : [{ label: tr('action.forward'), icon: Forward, action: () => onForward(message) }])
  ];

  return (
    <article ref={paneRef} aria-labelledby="msg-subject" className="rd-root">
      {/* Seven 44px buttons fit one row on 360px and 390px phones with the tight gaps and side padding of reader.css; on a 320px phone index.css
          drops the padding and the buttons share the row (nm-bar), so the phone toolbar never wraps. On desktop the pane's width picks the
          density (reader/barDensity.ts): wrap stays only as a safety net, the arithmetic keeps it to one row. */}
      <div className={cx('rd-bar', compact ? 'nm-bar' : 'nm-bar-d')} data-density={density} data-compact={compact}>
        {onBack ? <BarButton label={tr('reader.back_to_list')} icon={ChevronLeft} iconSize={iconSize} onClick={onBack} /> : null}
        <BarButton label={tr('action.archive')} icon={Archive} iconSize={iconSize} onClick={() => onArchive(message)} />
        {inSpam ? null : <BarButton label={tr('action.move_to_spam')} icon={Ban} iconSize={iconSize} onClick={() => onSpam(message)} />}
        {inTrash ? null : (
          <BarButton label={tr('action.move_to_trash')} icon={Trash2} iconSize={iconSize} onClick={() => onTrash(message)} />
        )}
        {inBin ? (
          <>
            <BarButton label={tr('action.move_to_inbox')} icon={Inbox} iconSize={iconSize} onClick={() => onRestore(message)} />
            <BarButton
              label={tr('action.delete_forever')}
              icon={MailX}
              iconSize={iconSize}
              onClick={() => onDeleteForever(message)}
              danger
            />
          </>
        ) : null}
        <Divider orientation="vertical" className={cx('rd-sep', compact && 'nm-bar-sep')} />
        <BarButton label={tr('action.mark_unread')} icon={MailOpen} iconSize={iconSize} onClick={() => onMarkUnread(message)} />
        {canSnooze ? (
          <SnoozeMenu
            // A new mail starts with the menu closed.
            key={message.id}
            t={t}
            buttonStyle={NO_STYLE}
            iconSize={iconSize}
            snoozed={snoozed}
            onSnooze={(until) => onSnooze(message, until)}
            onUnsnooze={() => onUnsnooze(message)}
          />
        ) : null}
        <LabelMenu
          // A new mail starts with the menu closed.
          key={`${message.id}:labels`}
          t={t}
          message={message}
          labels={labels}
          onToggleLabel={onToggleLabel}
          iconSize={iconSize}
        />

        {showCount ? <span className="rd-count">{position}</span> : <span className="rd-spacer" />}
        {compact ? null : (
          <>
            <BarButton label={tr('reader.newer_message')} icon={ChevronLeft} iconSize={iconSize} onClick={onPrev} disabled={!hasPrev} />
            <BarButton label={tr('reader.older_message')} icon={ChevronRight} iconSize={iconSize} onClick={onNext} disabled={!hasNext} />
          </>
        )}
      </div>

      <div className="rd-scroll">
        <div className="rd-page" data-compact={compact}>
          <header className="rd-head">
            <h2 id="msg-subject" className="rd-subject">
              {subjectOf(message, tr('reader.no_subject'))}
            </h2>
            {messageLabels.length > 0 || snoozeUntil !== null ? (
              <div className="rd-tags">
                {snoozeUntil === null ? null : <SnoozeChip t={t} until={snoozeUntil} />}
                {messageLabels.map((label) => (
                  <Chip key={label} colors={getLabelChip(label, t)}>
                    {label}
                  </Chip>
                ))}
              </div>
            ) : null}

            <div className="rd-sender">
              <Avatar name={sender} />
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
                  </span>
                  <span className="rd-date">{formatFullDate(message.created_at)}</span>
                </div>
                {offerAll ? (
                  <Disclosure className="rd-rcpt" open={recipientsOpen} onOpenChange={setRecipientsOpen}>
                    {recipientsLine}
                  </Disclosure>
                ) : (
                  <p className="rd-rcpt">{recipientsLine}</p>
                )}
              </div>
              <div className="rd-tools">
                <IconButton label={tr('action.star')} size="sm" pressed={starred} className="rd-star" onClick={() => onToggleStar(message)}>
                  <Star size={16} strokeWidth={1.75} aria-hidden="true" />
                </IconButton>
                <IconButton label={tr('action.reply')} size="sm" onClick={() => onReply(message)}>
                  <Reply size={16} strokeWidth={1.75} aria-hidden="true" />
                </IconButton>
              </div>
            </div>

            {sealed || unverified ? (
              <div className="rd-prov">
                {sealed ? <E2eBadge t={t} /> : null}
                {unverified ? <UnverifiedChip t={t} /> : null}
              </div>
            ) : null}
          </header>

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
            <div className="rd-text">
              {paragraphs.map((p, i) => (
                // eslint-disable-next-line react/no-array-index-key -- paragraphs are plain strings that can repeat and are never reordered
                <p key={i}>{p}</p>
              ))}
            </div>
          )}

          {attachments.length > 0 ? (
            <section aria-label={tr('term.attachments')} className="rd-files">
              <h3 className="rd-files-title">
                <Paperclip size={14} strokeWidth={1.75} aria-hidden="true" />
                {tr('reader.attachments_summary', {
                  count: attachments.length,
                  size: formatBytes(attachments.reduce((sum, a) => sum + a.size, 0))
                })}
              </h3>
              <ul role="list" className="rd-file-list">
                {attachments.map((att) => {
                  // PX-7: the name the sender gave is shown the way it is saved (no direction controls: "photo\u202Egpj.exe" would read
                  // "photoexe.jpg"), and the type chip is read from that same name.
                  const name = safeFileName(att.filename, tr('list.attachment'));
                  const type = fileTypeOf(name);
                  const chip = getFileChip(type, t);
                  const fetching = downloads.busy === att.id;
                  const downloadLabel = tr('reader.download_file', { name });
                  return (
                    <li key={att.id} className="rd-file">
                      <span aria-hidden="true" className="rd-type" style={{ background: chip.bg, color: chip.fg }}>
                        {type}
                      </span>
                      <span className="rd-file-main">
                        <span className="rd-file-name">{name}</span>
                        <span className="rd-file-size">{formatBytes(att.size)}</span>
                      </span>
                      {message.enc_fmt === 1 ? (
                        // An encrypted file is fetched and opened here, then saved; a plain link would save the encrypted bytes.
                        <IconButton
                          label={downloadLabel}
                          size="sm"
                          aria-busy={fetching}
                          disabled={downloads.busy !== null}
                          onClick={() => downloads.saveAttachment(att)}
                        >
                          {fetching ? <Spinner size={16} decorative /> : <Download size={16} strokeWidth={1.75} aria-hidden="true" />}
                        </IconButton>
                      ) : (
                        <DownloadLink href={`/api/attachments/${att.id}`} download={safeFileName(att.filename, '')} label={downloadLabel}>
                          <Download size={16} strokeWidth={1.75} aria-hidden="true" />
                        </DownloadLink>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <div ref={replyRef} className="rd-reply" data-compact={compact}>
            {replyActions.map((item) => {
              const Icon = item.icon;
              return (
                <Button
                  key={item.label}
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
      </div>
    </article>
  );
};
