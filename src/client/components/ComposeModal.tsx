import React from 'react';
import { flushSync } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeft,
  Bold,
  CheckCircle2,
  Image as ImageIcon,
  Italic,
  Link2,
  List,
  ListOrdered,
  Loader2,
  Paperclip,
  Quote,
  Send,
  Signature,
  Trash2,
  Underline,
  X
} from 'lucide-react';
import type { ThemeTokens } from '../theme';
import { getChip } from '../theme';
import { fileTypeOf, formatBytes, initialsOf, nonEmpty, stringHue } from '../lib/mail';
import { DraftSaver, newDraftId, sanitizeDraftHtml, type DraftSnapshot, type DraftStatus } from '../lib/drafts';
import { queryKeys, useSendMessage } from '../lib/queries';
import { restoreSignatureDelimiter, signatureBlock } from '../lib/settings';

export interface ComposeDraft {
  /** Set when a draft from the Drafts folder is reopened: autosave goes on updating that same draft. */
  draftId?: string;
  from?: string;
  to?: string;
  cc?: string;
  bcc?: string;
  subject?: string;
  /** Plain text taken as it is (a reopened draft); nothing is added to it. */
  body?: string;
  /** Saved HTML of a reopened draft; wins over `body`. */
  html?: string;
  /** Quoted mail of a reply or forward; the signature goes above it and the caret on top. */
  quote?: string;
  /** Message-ID of the mail being answered (replies only; a forward is a new thread). */
  inReplyTo?: string;
  references?: string[];
}

interface ComposeModalProps {
  isOpen: boolean;
  t: ThemeTokens;
  onClose: () => void;
  defaultFrom: string;
  /** Saved plain-text signature; '' when none. */
  signature: string;
  draft: ComposeDraft;
  onSuccess: (note?: string) => void;
  /** A short message for after the compose is gone (a draft that could not be saved or discarded). */
  onNotice?: (text: string) => void;
}

interface PendingFile {
  filename: string;
  content_type: string;
  content_base64: string;
  size: number;
  uploading?: boolean;
}

const splitRecipients = (value: string): string[] =>
  value
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean);

const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br />');

const missingFromText = 'Add a sender address in Settings.';

const draftStatusText: Record<DraftStatus, string> = {
  idle: '',
  saving: 'Saving…',
  saved: 'Draft saved',
  error: 'Could not save draft'
};

const unique = (list: string[]) => [...new Set(list)];

const squash = (value: string) => value.replaceAll(/\s+/g, ' ').trim();

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

const useMedia = (query: string) =>
  React.useSyncExternalStore(
    (notify) => {
      const mql = window.matchMedia(query);
      mql.addEventListener('change', notify);
      return () => mql.removeEventListener('change', notify);
    },
    () => window.matchMedia(query).matches
  );

// The editor as plain text.
const plainTextOf = (editor: HTMLElement | null) => {
  // eslint-disable-next-line unicorn/prefer-dom-node-text-content -- innerText keeps the line breaks of <div>/<br>; textContent would flatten the plain-text part
  const text = editor?.innerText ?? '';
  return restoreSignatureDelimiter(text);
};

/** What the user wrote: the text without the auto-inserted signature block. */
const writtenText = (text: string, signature: string) => {
  const block = squash(signatureBlock(signature));
  return block === '' ? squash(text) : squash(squash(text).replaceAll(block, ''));
};

/** Fingerprint of everything a draft keeps, to tell a changed form from the one that was opened. */
const contentKey = (from: string, to: string[], cc: string[], bcc: string[], subject: string, html: string) =>
  JSON.stringify([from.trim(), to, cc, bcc, subject.trim(), html]);

// A body that ends with a newline leaves an empty line (`> `) at the end of its quote; trailing blank lines are not quoted.
const trimQuote = (quote: string) => {
  const lines = quote.split('\n');
  while (lines.length > 1 && /^[\s>]*$/.test(lines.at(-1) ?? '')) {
    lines.pop();
  }
  return lines.join('\n');
};

const focusAtStart = (editor: HTMLElement) => {
  editor.focus();
  const range = document.createRange();
  range.setStart(editor, 0);
  range.collapse(true);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
};

const read = (file: File) =>
  new Promise<PendingFile>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve({
        filename: file.name,
        content_type: file.type || 'application/octet-stream',
        content_base64: result.split(',', 2)[1] || '',
        size: file.size
      });
    });
    reader.addEventListener('error', () => reject(reader.error ?? new Error('Could not read file')));
    reader.readAsDataURL(file);
  });

const RecipientChip: React.FC<{ t: ThemeTokens; address: string; onRemove: () => void }> = ({ t, address, onRemove }) => {
  const chip = getChip(stringHue(address), t);
  const name = address.split('@', 1)[0];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        maxWidth: '100%',
        minWidth: 0,
        height: 32,
        padding: '0 2px 0 4px',
        borderRadius: 999,
        background: t.raised,
        border: `1px solid ${t.border}`,
        fontSize: 13,
        fontWeight: 500
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 24,
          height: 24,
          flex: 'none',
          borderRadius: '50%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: chip.bg,
          color: chip.fg,
          fontSize: 10,
          fontWeight: 600
        }}
      >
        {initialsOf(name, address)}
      </span>
      <span title={address} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {address}
      </span>
      <button
        type="button"
        aria-label={`Remove ${address}`}
        className="nm-tap-ext"
        onClick={onRemove}
        style={{
          flex: 'none',
          width: 26,
          height: 26,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 0,
          borderRadius: '50%',
          background: 'transparent',
          color: t.text2,
          cursor: 'pointer'
        }}
      >
        <X size={14} strokeWidth={2} aria-hidden="true" />
      </button>
    </span>
  );
};

export const ComposeModal: React.FC<ComposeModalProps> = ({ isOpen, t, onClose, defaultFrom, signature, draft, onSuccess, onNotice }) => {
  const [from, setFrom] = React.useState(defaultFrom);
  const [toList, setToList] = React.useState<string[]>([]);
  const [ccList, setCcList] = React.useState<string[]>([]);
  const [bccList, setBccList] = React.useState<string[]>([]);
  const [toInput, setToInput] = React.useState('');
  const [ccInput, setCcInput] = React.useState('');
  const [bccInput, setBccInput] = React.useState('');
  const [showCc, setShowCc] = React.useState(false);
  const [showBcc, setShowBcc] = React.useState(false);
  const [subject, setSubject] = React.useState('');
  const [files, setFiles] = React.useState<PendingFile[]>([]);
  const [isSending, setIsSending] = React.useState(false);
  const [status, setStatus] = React.useState<{ text: string; type: 'error' | 'success' } | null>(null);
  const [draftStatus, setDraftStatus] = React.useState<DraftStatus>('idle');

  // An error message (a validation hint or a failed send) goes away as soon as the user changes recipients or subject (the
  // body clears it in its onInput). Adjusting state while rendering, as the form values are what it follows.
  const formKey = JSON.stringify([from, toList, ccList, bccList, toInput, ccInput, bccInput, subject]);
  const [seenFormKey, setSeenFormKey] = React.useState(formKey);
  if (formKey !== seenFormKey) {
    setSeenFormKey(formKey);
    if (status?.type === 'error') {
      setStatus(null);
    }
  }

  const editorRef = React.useRef<HTMLDivElement | null>(null);
  const toInputRef = React.useRef<HTMLInputElement | null>(null);
  const ccInputRef = React.useRef<HTMLInputElement | null>(null);
  const bccInputRef = React.useRef<HTMLInputElement | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const { mutateAsync: sendMessage } = useSendMessage();
  const queryClient = useQueryClient();
  // Same breakpoint as .nm-hide-sm: below it the header has no room for the status text, so it moves under the header.
  const narrow = useMedia('(max-width: 640px)');
  // The header's right slot is (width - 56px - title) / 2 wide, minus the draft status and the close button: 54px at 641px and
  // 174px at 880px for 'New message', while 'Add at least one recipient.' needs 180px. Up to 900px the status gets its own line.
  const statusBelow = useMedia('(max-width: 900px)');

  // Drafts: one saver per time the compose opens. It outlives renders (and the close of the modal, while its last save
  // finishes), so it reads the form and calls back through `latest`.
  const saverRef = React.useRef<DraftSaver | null>(null);
  // contentKey of the form as it was opened; a form still equal to it has nothing to save.
  const baselineRef = React.useRef('');
  const closingRef = React.useRef(false);
  // The body as of the last edit. A compose closed from outside (system Back) loses its editor before the last save reads it.
  const bodyRef = React.useRef({ html: '', text: '' });
  const readBody = React.useCallback(() => {
    const editor = editorRef.current;
    if (editor) {
      bodyRef.current = { html: editor.innerHTML, text: plainTextOf(editor) };
    }
    return bodyRef.current;
  }, []);

  const collect = () => ({
    to: unique([...toList, ...splitRecipients(toInput)]),
    cc: unique([...ccList, ...splitRecipients(ccInput)]),
    bcc: unique([...bccList, ...splitRecipients(bccInput)]),
    ...readBody()
  });

  const readDraft = (): DraftSnapshot => {
    const { to, cc, bcc, html, text } = collect();
    const subjectText = subject.trim();
    return {
      fields: {
        from: from.trim(),
        to,
        cc,
        bcc,
        subject: subjectText,
        text,
        html,
        ...(draft.inReplyTo === undefined ? null : { in_reply_to: draft.inReplyTo })
      },
      empty: to.length === 0 && cc.length === 0 && bcc.length === 0 && subjectText === '' && writtenText(text, signature) === '',
      key: contentKey(from, to, cc, bcc, subjectText, html),
      baseline: baselineRef.current
    };
  };

  const latest = React.useRef({ readDraft, onNotice, queryClient });
  React.useLayoutEffect(() => {
    latest.current = { readDraft, onNotice, queryClient };
  });

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    const saver = new DraftSaver({
      id: draft.draftId ?? newDraftId(),
      onServer: draft.draftId !== undefined,
      read: () => latest.current.readDraft(),
      onStatus: (next) => {
        // A compose that was just closed may still be finishing its save; its status must not leak into the next one.
        if (saverRef.current === saver) {
          setDraftStatus(next);
        }
      },
      onEnded: () => {
        // The Drafts folder and its counter changed behind the compose.
        void latest.current.queryClient.invalidateQueries({ queryKey: queryKeys.messages });
        void latest.current.queryClient.invalidateQueries({ queryKey: queryKeys.stats });
      },
      onLost: () => latest.current.onNotice?.('Could not save draft')
    });
    saverRef.current = saver;
    return () => {
      // Every way out (buttons, Esc, system Back, a sent mail) ends up here; closing twice is harmless.
      void saver.close();
      saverRef.current = null;
    };
  }, [isOpen, draft]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    // A phone can kill a hidden page: save what is pending now instead of 1.5 s from now.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        saverRef.current?.saveNow();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [isOpen]);

  React.useEffect(() => {
    saverRef.current?.touch();
  }, [from, toList, ccList, bccList, toInput, ccInput, bccInput, subject]);

  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    const to = unique(splitRecipients(draft.to ?? ''));
    const cc = unique(splitRecipients(draft.cc ?? ''));
    const bcc = unique(splitRecipients(draft.bcc ?? ''));
    const sender = nonEmpty(draft.from) ?? defaultFrom;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- form state must be reset when the modal (re)opens
    setFrom(sender);
    setToList(to);
    setCcList(cc);
    setBccList(bcc);
    setToInput('');
    setCcInput('');
    setBccInput('');
    setShowCc(cc.length > 0);
    setShowBcc(bcc.length > 0);
    setSubject(draft.subject ?? '');
    setFiles([]);
    setStatus(null);
    setDraftStatus('idle');
    closingRef.current = false;
    const editor = editorRef.current;
    if (editor) {
      // New mail: the signature. Reply or forward: the signature above the quote. Reopened draft: exactly what was saved.
      const text = draft.body ?? `${signatureBlock(signature)}${draft.quote === undefined ? '' : `\n\n${trimQuote(draft.quote)}`}`;
      const savedHtml = nonEmpty(draft.html);
      editor.innerHTML = savedHtml === undefined ? escapeHtml(text) : sanitizeDraftHtml(savedHtml);
      baselineRef.current = contentKey(sender, to, cc, bcc, draft.subject ?? '', readBody().html);
      if (draft.quote !== undefined || draft.body !== undefined || draft.html !== undefined) {
        focusAtStart(editor);
      } else {
        // New mail: focus inside the dialog, otherwise Escape and Ctrl+Enter (handled on the dialog) never fire.
        toInputRef.current?.focus();
      }
    }
  }, [isOpen, defaultFrom, signature, draft, readBody]);

  if (!isOpen) {
    return null;
  }

  const commitRecipients = (
    raw: string,
    setList: React.Dispatch<React.SetStateAction<string[]>>,
    setInput: React.Dispatch<React.SetStateAction<string>>
  ) => {
    const parts = splitRecipients(raw);
    if (parts.length === 0) {
      return;
    }
    setList((prev) => [...new Set([...prev, ...parts])]);
    setInput('');
  };

  const exec = (command: string, value?: string) => {
    editorRef.current?.focus();
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- no replacement exists for execCommand in a contentEditable editor
    document.execCommand(command, false, value);
  };

  const handleFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const picked = [...(input.files ?? [])];
    input.value = '';
    if (picked.length === 0) {
      return;
    }

    try {
      const next = await Promise.all(picked.map(read));
      setFiles((prev) => [...prev, ...next]);
    } catch {
      setStatus({ text: 'Could not read one of the attachments.', type: 'error' });
    }
  };

  const handleSend = async () => {
    const sender = from.trim();
    const { to, cc, bcc, html, text } = collect();

    if (sender === '') {
      setStatus({ text: missingFromText, type: 'error' });
      return;
    }
    if (to.length === 0) {
      setStatus({ text: 'Add at least one recipient.', type: 'error' });
      return;
    }
    if (!subject.trim()) {
      setStatus({ text: 'Subject is required.', type: 'error' });
      return;
    }

    setIsSending(true);
    setStatus(null);

    const saver = saverRef.current;
    try {
      // A save in flight finishes first and no new one starts: a PUT landing after the send would bring the draft back.
      await saver?.lockForSend();
      const data = await sendMessage({
        from: sender,
        to,
        cc: cc.length > 0 ? cc : undefined,
        bcc: bcc.length > 0 ? bcc : undefined,
        subject: subject.trim(),
        text,
        html: `<div style="font-family:'Geist',ui-sans-serif,system-ui,sans-serif;font-size:15px;line-height:24px">${html}</div>`,
        attachments:
          files.length > 0
            ? files.map((f) => ({ filename: f.filename, content_type: f.content_type, content_base64: f.content_base64 }))
            : undefined,
        in_reply_to: draft.inReplyTo,
        references: draft.references,
        draft_id: saver?.id
      });

      saver?.finishSent();
      setDraftStatus('idle');
      setStatus({ text: data.note !== undefined && data.note !== '' ? data.note : 'Message sent.', type: 'success' });
      onSuccess(data.note);
      window.setTimeout(onClose, 900);
    } catch (error: unknown) {
      // The server keeps the draft when the send fails; autosave goes on.
      saver?.unlock();
      setStatus({ text: error instanceof Error && error.message !== '' ? error.message : 'Error sending email', type: 'error' });
    } finally {
      setIsSending(false);
    }
  };

  // The ways out of the compose that keep a draft: wait (up to 2 s) for its last save, then close.
  const requestClose = async () => {
    if (closingRef.current) {
      return;
    }
    closingRef.current = true;
    await Promise.race([saverRef.current?.close(), wait(2000)]);
    onClose();
  };

  const discardDraft = async () => {
    if (closingRef.current) {
      return;
    }
    closingRef.current = true;
    const deleted = (await saverRef.current?.discard()) ?? true;
    if (!deleted) {
      onNotice?.('Could not discard the draft');
    }
    onClose();
  };

  const fieldRow: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    padding: '6px 24px',
    borderBottom: `1px solid ${t.divider}`
  };
  const labelStyle: React.CSSProperties = { width: 60, flex: 'none', color: t.text2 };
  const inputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: 0,
    height: 36,
    border: 0,
    padding: '0 4px',
    background: 'transparent',
    color: t.text,
    font: 'inherit',
    fontSize: 14,
    outline: 'none'
  };
  const toolBtn: React.CSSProperties = {
    width: 36,
    height: 36,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 0,
    borderRadius: 8,
    background: 'transparent',
    color: t.text2,
    cursor: 'pointer'
  };

  const missingFrom = from.trim() === '';
  // The empty-sender hint shows until the field is filled; other messages (validation, send result) take over.
  const shownStatus = status ?? (missingFrom ? { text: missingFromText, type: 'error' as const } : null);

  const statusEl = shownStatus ? (
    <span
      role={shownStatus.type === 'error' ? 'alert' : 'status'}
      style={{
        display: 'inline-flex',
        // A wrapped message keeps its icon beside the FIRST line (2px = (20px line - 16px icon) / 2), not centred on the block.
        alignItems: 'flex-start',
        gap: 6,
        minWidth: 0,
        fontSize: 13,
        lineHeight: '20px',
        color: shownStatus.type === 'error' ? (t.dark ? '#F97066' : '#B42318') : t.dark ? '#4ADE80' : '#15803D'
      }}
    >
      {shownStatus.type === 'error' ? (
        <AlertCircle size={16} style={{ flex: 'none', marginTop: 2 }} aria-hidden="true" />
      ) : (
        <CheckCircle2 size={16} style={{ flex: 'none', marginTop: 2 }} aria-hidden="true" />
      )}
      {/* Wraps instead of clipping: an error the user cannot read in full is no use at any width. */}
      <span style={{ overflowWrap: 'anywhere' }}>{shownStatus.text}</span>
    </span>
  ) : null;

  // Always rendered (empty when idle) so a status change never moves anything and screen readers hear it.
  const draftStatusEl = (
    <output
      aria-live="polite"
      style={{
        flex: 'none',
        marginLeft: statusBelow ? 'auto' : undefined,
        minWidth: statusBelow ? undefined : 128,
        textAlign: 'right',
        fontSize: 12,
        lineHeight: '16px',
        whiteSpace: 'nowrap',
        color: draftStatus === 'error' ? (t.dark ? '#F97066' : '#B42318') : t.text3
      }}
    >
      {draftStatusText[draftStatus]}
    </output>
  );

  // Desktop: sits at the right end of the To row. Phones: at the end of the address input line, so chips keep the full width.
  // Gone once both rows are showing.
  const ccBccToggle =
    showCc && showBcc ? null : (
      <button
        type="button"
        onClick={() => {
          const newRow = showCc ? bccInputRef : ccInputRef;
          flushSync(() => {
            setShowCc(true);
            setShowBcc(true);
          });
          // This button is gone now: focus the new row, otherwise focus leaves the dialog and Escape / Ctrl+Enter stop working.
          newRow.current?.focus();
        }}
        className="nm-tap-h"
        style={{
          flex: narrow ? 'none' : undefined,
          height: 32,
          padding: '0 10px',
          border: 0,
          borderRadius: 8,
          background: 'transparent',
          color: t.text2,
          fontSize: 13,
          fontWeight: 500,
          cursor: 'pointer'
        }}
      >
        Cc/Bcc
      </button>
    );

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- dialog-wide Escape / Ctrl+Enter shortcuts catch keys bubbling up from the fields inside
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="compose-title"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        display: 'flex',
        flexDirection: 'column',
        background: t.bg,
        color: t.text
      }}
      className="nm-fade-in"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          void requestClose();
        }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void handleSend();
        }
      }}
    >
      <header
        className="nm-compose-head"
        style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 64, padding: '10px 16px', flexWrap: 'wrap' }}
      >
        <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex' }}>
          <button
            type="button"
            onClick={() => {
              void requestClose();
            }}
            aria-label="Back to inbox"
            className="nm-tap"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              height: 40,
              padding: '0 12px 0 8px',
              border: 0,
              borderRadius: 10,
              background: 'transparent',
              color: t.text2,
              fontWeight: 500,
              cursor: 'pointer'
            }}
          >
            <ArrowLeft size={20} strokeWidth={1.8} aria-hidden="true" />
            <span className="nm-hide-sm">Inbox</span>
          </button>
        </div>
        <h1 id="compose-title" style={{ margin: 0, fontSize: 16, lineHeight: '24px', fontWeight: 600, whiteSpace: 'nowrap' }}>
          {draft.draftId === undefined ? 'New message' : 'Draft'}
        </h1>
        <div style={{ flex: '1 1 0', minWidth: 0, display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
          {statusBelow ? null : statusEl}
          {statusBelow ? null : draftStatusEl}
          <button
            type="button"
            onClick={() => {
              void requestClose();
            }}
            aria-label="Close"
            className="nm-tap"
            title="Close"
            style={{ ...toolBtn, flex: 'none', width: 40, height: 40, borderRadius: 10 }}
          >
            <X size={20} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
      </header>
      {statusBelow ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minHeight: 24, padding: '0 16px 4px' }}>
          {statusEl}
          {draftStatusEl}
        </div>
      ) : null}

      <main style={{ flex: 1, minHeight: 0, padding: '4px 16px 32px' }}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void handleSend();
          }}
          style={{
            maxWidth: 880,
            maxHeight: '100%',
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            background: t.surface,
            border: `1px solid ${t.border}`,
            borderRadius: 16,
            boxShadow: '0 1px 2px rgba(16,24,40,0.05), 0 16px 40px -16px rgba(16,24,40,0.16)',
            overflow: 'hidden'
          }}
        >
          {/* Scroll region: fields, editor and attachments. The footer below stays pinned. */}
          <div className="nm-compose-scroll" style={{ overflowY: 'auto' }}>
            <div style={fieldRow}>
              <label htmlFor="compose-from" style={labelStyle}>
                From
              </label>
              <input
                id="compose-from"
                className="nm-tap-h"
                type="email"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                style={{ ...inputStyle, height: 40 }}
                placeholder="sender@yourdomain.com"
              />
            </div>

            <div style={{ ...fieldRow, padding: '6px 16px 6px 24px', ...(narrow ? { alignItems: 'flex-start' } : null) }}>
              <label htmlFor="compose-to" style={narrow ? { ...labelStyle, paddingTop: toList.length > 0 ? 6 : 12 } : labelStyle}>
                To
              </label>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                {toList.map((address) => (
                  <RecipientChip
                    key={address}
                    t={t}
                    address={address}
                    onRemove={() => setToList((prev) => prev.filter((a) => a !== address))}
                  />
                ))}
                <input
                  id="compose-to"
                  ref={toInputRef}
                  className="nm-tap-h"
                  type="text"
                  autoComplete="off"
                  placeholder={toList.length === 0 ? 'Add people' : ''}
                  value={toInput}
                  onChange={(e) => setToInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (['Enter', ',', ';'].includes(e.key)) {
                      e.preventDefault();
                      commitRecipients(toInput, setToList, setToInput);
                    }
                    if (e.key === 'Backspace' && !toInput && toList.length > 0) {
                      setToList((prev) => prev.slice(0, -1));
                    }
                  }}
                  onBlur={() => commitRecipients(toInput, setToList, setToInput)}
                  style={{ ...inputStyle, flex: '1 1 140px', minWidth: 120 }}
                />
                {narrow ? ccBccToggle : null}
              </div>
              {narrow ? null : ccBccToggle}
            </div>

            {showCc ? (
              <div style={fieldRow}>
                <label htmlFor="compose-cc" style={labelStyle}>
                  Cc
                </label>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                  {ccList.map((address) => (
                    <RecipientChip
                      key={address}
                      t={t}
                      address={address}
                      onRemove={() => setCcList((prev) => prev.filter((a) => a !== address))}
                    />
                  ))}
                  <input
                    id="compose-cc"
                    ref={ccInputRef}
                    className="nm-tap-h"
                    type="text"
                    autoComplete="off"
                    value={ccInput}
                    onChange={(e) => setCcInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (['Enter', ',', ';'].includes(e.key)) {
                        e.preventDefault();
                        commitRecipients(ccInput, setCcList, setCcInput);
                      }
                    }}
                    onBlur={() => commitRecipients(ccInput, setCcList, setCcInput)}
                    style={{ ...inputStyle, flex: '1 1 140px', minWidth: 120 }}
                  />
                </div>
              </div>
            ) : null}

            {showBcc ? (
              <div style={fieldRow}>
                <label htmlFor="compose-bcc" style={labelStyle}>
                  Bcc
                </label>
                <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
                  {bccList.map((address) => (
                    <RecipientChip
                      key={address}
                      t={t}
                      address={address}
                      onRemove={() => setBccList((prev) => prev.filter((a) => a !== address))}
                    />
                  ))}
                  <input
                    id="compose-bcc"
                    ref={bccInputRef}
                    className="nm-tap-h"
                    type="text"
                    autoComplete="off"
                    value={bccInput}
                    onChange={(e) => setBccInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (['Enter', ',', ';'].includes(e.key)) {
                        e.preventDefault();
                        commitRecipients(bccInput, setBccList, setBccInput);
                      }
                    }}
                    onBlur={() => commitRecipients(bccInput, setBccList, setBccInput)}
                    style={{ ...inputStyle, flex: '1 1 140px', minWidth: 120 }}
                  />
                </div>
              </div>
            ) : null}

            <div style={fieldRow}>
              <label htmlFor="compose-subject" style={labelStyle}>
                Subject
              </label>
              <input
                id="compose-subject"
                className="nm-tap-h"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Subject"
                style={{ ...inputStyle, height: 40, fontSize: 15, fontWeight: 500 }}
              />
            </div>

            <div
              aria-label="Formatting"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 2,
                flexWrap: 'wrap',
                padding: '8px 16px',
                borderBottom: `1px solid ${t.divider}`,
                background: t.raised
              }}
            >
              <select
                aria-label="Text style"
                className="nm-tap-h"
                onChange={(e) => exec('formatBlock', e.target.value)}
                defaultValue="p"
                style={{
                  height: 36,
                  padding: '0 8px',
                  border: 0,
                  borderRadius: 8,
                  background: 'transparent',
                  color: t.text,
                  font: 'inherit',
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                <option value="p">Normal text</option>
                <option value="h3">Heading</option>
                <option value="h4">Subheading</option>
              </select>
              <span aria-hidden="true" className="nm-hide-sm" style={{ width: 1, height: 20, margin: '0 6px', background: t.border }} />
              <button type="button" aria-label="Bold" title="Bold" className="nm-tap-ext" onClick={() => exec('bold')} style={toolBtn}>
                <Bold size={18} strokeWidth={2.2} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Italic"
                title="Italic"
                className="nm-tap-ext"
                onClick={() => exec('italic')}
                style={toolBtn}
              >
                <Italic size={18} strokeWidth={2} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Underline"
                title="Underline"
                className="nm-tap-ext"
                onClick={() => exec('underline')}
                style={toolBtn}
              >
                <Underline size={18} strokeWidth={2} aria-hidden="true" />
              </button>
              <span aria-hidden="true" className="nm-hide-sm" style={{ width: 1, height: 20, margin: '0 6px', background: t.border }} />
              <button
                type="button"
                aria-label="Bulleted list"
                title="Bulleted list"
                className="nm-tap-ext"
                onClick={() => exec('insertUnorderedList')}
                style={toolBtn}
              >
                <List size={18} strokeWidth={2} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Numbered list"
                title="Numbered list"
                className="nm-tap-ext"
                onClick={() => exec('insertOrderedList')}
                style={toolBtn}
              >
                <ListOrdered size={18} strokeWidth={2} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Quote"
                title="Quote"
                className="nm-tap-ext"
                onClick={() => exec('formatBlock', 'blockquote')}
                style={toolBtn}
              >
                <Quote size={18} strokeWidth={2} aria-hidden="true" />
              </button>
              <span aria-hidden="true" className="nm-hide-sm" style={{ width: 1, height: 20, margin: '0 6px', background: t.border }} />
              <button
                type="button"
                aria-label="Insert link"
                title="Insert link"
                className="nm-tap-ext"
                onClick={() => {
                  // eslint-disable-next-line no-alert -- no custom dialog exists for the URL prompt
                  const url = window.prompt('Link URL');
                  if (url !== null && url !== '') {
                    exec('createLink', url);
                  }
                }}
                style={toolBtn}
              >
                <Link2 size={18} strokeWidth={2} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Insert image"
                title="Insert image by URL"
                className="nm-tap-ext"
                onClick={() => {
                  // eslint-disable-next-line no-alert -- no custom dialog exists for the URL prompt
                  const url = window.prompt('Image URL');
                  if (url !== null && url !== '') {
                    exec('insertImage', url);
                  }
                }}
                style={toolBtn}
              >
                <ImageIcon size={18} strokeWidth={2} aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="Attach files"
                title="Attach files"
                className="nm-tap-ext"
                onClick={() => fileRef.current?.click()}
                style={toolBtn}
              >
                <Paperclip size={18} strokeWidth={2} aria-hidden="true" />
              </button>
            </div>

            <input
              ref={fileRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                void handleFiles(e);
              }}
            />

            <div
              ref={editorRef}
              contentEditable
              role="textbox"
              aria-multiline="true"
              aria-label="Message body"
              data-placeholder="Write your message…"
              className="nm-editor"
              onInput={() => {
                readBody();
                setStatus((prev) => (prev?.type === 'error' ? null : prev));
                saverRef.current?.touch();
              }}
              style={{
                display: 'block',
                width: '100%',
                minHeight: 320,
                padding: '20px 24px 12px',
                background: 'transparent',
                color: t.text,
                fontSize: 15,
                lineHeight: '24px',
                outline: 'none',
                overflowY: 'auto'
              }}
            />

            {files.length > 0 ? (
              <ul
                role="list"
                aria-label="Attachments"
                style={{ listStyle: 'none', margin: 0, padding: '0 24px 20px', display: 'flex', flexWrap: 'wrap', gap: 12 }}
              >
                {files.map((file, index) => (
                  <li
                    // eslint-disable-next-line react/no-array-index-key -- the same file can be attached twice and rows have no id; the list is only appended to or filtered by index
                    key={`${file.filename}-${index}`}
                    style={{
                      flex: '0 1 300px',
                      minWidth: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      padding: '10px 6px 10px 10px',
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
                        background: getChip('#2F5BEA', t).bg,
                        color: getChip('#2F5BEA', t).fg,
                        fontSize: 11,
                        fontWeight: 700,
                        letterSpacing: '0.04em'
                      }}
                    >
                      {fileTypeOf(file.filename)}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 13, fontWeight: 500 }}>
                        {file.filename}
                      </span>
                      <span style={{ fontSize: 12, lineHeight: '16px', color: t.text3 }}>{formatBytes(file.size)}</span>
                    </span>
                    <button
                      type="button"
                      aria-label={`Remove ${file.filename}`}
                      title="Remove"
                      className="nm-tap"
                      onClick={() => setFiles((prev) => prev.filter((_, i) => i !== index))}
                      style={toolBtn}
                    >
                      <X size={16} strokeWidth={2} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            {files.length > 0 ? (
              <p style={{ margin: '-8px 0 0', padding: '0 24px 16px', fontSize: 12, lineHeight: '16px', color: t.text3 }}>
                Attachments are not saved in drafts
              </p>
            ) : null}
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: narrow ? 8 : 16,
              flexWrap: 'wrap',
              padding: '16px 24px',
              borderTop: `1px solid ${t.divider}`
            }}
          >
            <div style={{ display: 'inline-flex', borderRadius: 10, overflow: 'hidden', boxShadow: '0 1px 2px rgba(16,24,40,0.14)' }}>
              <button
                type="submit"
                disabled={isSending || missingFrom}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  height: 44,
                  padding: '0 20px',
                  border: 0,
                  background: t.accent,
                  color: '#FFFFFF',
                  fontSize: 14,
                  fontWeight: 600,
                  cursor: isSending ? 'progress' : missingFrom ? 'not-allowed' : 'pointer',
                  opacity: isSending ? 0.8 : missingFrom ? 0.5 : 1
                }}
              >
                {isSending ? (
                  <Loader2 size={18} className="nm-spin" aria-hidden="true" />
                ) : (
                  <Send size={18} strokeWidth={1.8} aria-hidden="true" />
                )}
                {isSending ? 'Sending…' : 'Send'}
              </button>
            </div>
            <span
              className="nm-hide-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, lineHeight: '16px', color: t.text2 }}
            >
              <kbd
                style={{
                  fontFamily: "'Geist Mono', ui-monospace, monospace",
                  fontSize: 11,
                  lineHeight: '18px',
                  padding: '0 6px',
                  borderRadius: 5,
                  border: `1px solid ${t.borderStrong}`,
                  background: t.surface,
                  color: t.text2
                }}
              >
                Ctrl
              </kbd>
              <kbd
                style={{
                  fontFamily: "'Geist Mono', ui-monospace, monospace",
                  fontSize: 11,
                  lineHeight: '18px',
                  padding: '0 6px',
                  borderRadius: 5,
                  border: `1px solid ${t.borderStrong}`,
                  background: t.surface,
                  color: t.text2
                }}
              >
                Enter
              </kbd>
              to send
            </span>
            <button
              type="button"
              aria-label="Insert signature"
              className="nm-tap"
              title="Insert signature"
              onClick={() => {
                editorRef.current?.focus();
                const block = signatureBlock(signature);
                if (block !== '') {
                  // eslint-disable-next-line @typescript-eslint/no-deprecated -- no replacement exists for execCommand in a contentEditable editor
                  document.execCommand('insertText', false, block);
                }
              }}
              style={{ ...toolBtn, marginLeft: 'auto', width: 40, height: 40, borderRadius: 10 }}
            >
              <Signature size={20} strokeWidth={1.8} aria-hidden="true" />
            </button>
            <button
              type="button"
              aria-label="Discard draft"
              className="nm-tap"
              title="Discard draft"
              onClick={() => {
                void discardDraft();
              }}
              style={{ ...toolBtn, width: 40, height: 40, borderRadius: 10 }}
            >
              <Trash2 size={20} strokeWidth={1.8} aria-hidden="true" />
            </button>
          </div>
        </form>
      </main>
    </div>
  );
};
