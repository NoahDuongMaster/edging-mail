import React from 'react';
import { flushSync } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Paperclip, Send, Signature, Trash2, X } from 'lucide-react';
import type { ThemeTokens } from '../theme';
import { ApiError, UnauthorizedError } from '../lib/api';
import { nonEmpty } from '../lib/mail';
import { DraftSaver, newDraftId, sanitizeDraftHtml, type DraftSnapshot, type DraftStatus } from '../lib/drafts';
import { trapTab } from '../lib/focusTrap';
import { tRich, useT, type TFunction } from '../lib/i18n';
import { queryKeys, useSendMessage } from '../lib/queries';
import { SealedMailError, previewAddresses, sealedErrorText, type OutgoingAttachment } from '../lib/sealedmail';
import { restoreSignatureDelimiter, signatureBlock } from '../lib/settings';
import { Banner, Button, IconButton, Kbd } from '../ui';
import { AttachmentList } from './compose/AttachmentList';
import { ComposeState } from './compose/ComposeState';
import { FormatToolbar } from './compose/FormatToolbar';
import { RecipientField } from './compose/RecipientField';
import { useComposePreview } from './compose/useComposePreview';
import { useSendFlow } from './compose/useSendFlow';
import { ReplyRedirectNote } from './compose/ReplyRedirectNote';
import type { ReplyRedirect } from '../lib/mail';
import './compose/compose.css';

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
  /** The mail being answered or forwarded is end-to-end encrypted (`is_e2e`): sending its content to an outside address needs a warning first (N6). */
  sourceIsE2E?: boolean;
  /** The mail being answered asks for replies at another address than the sender's (PX-12): shown on a line of its own while it is in To. */
  replyRedirect?: ReplyRedirect;
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

const splitRecipients = (value: string): string[] => value.split(/[\s,;]+/).filter(Boolean);

// The worker's rule (isEmail in src/worker/utils.ts): one plain address, no name part.
const isAddress = (value: string) => /^[^\s@<>,"]+@[^\s@<>,"]+\.[^\s@<>,"]+$/.test(value);

// What the server accepts in one send (src/worker/services/email-sender.ts); it counts the base64 text of the attachments.
const MAX_ATTACHMENTS = 32;
const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;
const base64Length = (bytes: number) => Math.ceil(bytes / 3) * 4;

/** A picked file as the sealed send takes it: its bytes (the compose keeps them as base64). */
const outgoingFile = (file: PendingFile): OutgoingAttachment => ({
  filename: file.filename,
  mimeType: file.content_type,
  contentId: null,
  bytes: Uint8Array.from(atob(file.content_base64), (char) => char.codePointAt(0) ?? 0)
});

const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br />');

/** The header's status text of the draft autosave ('' while idle). */
const draftStatusText = (status: DraftStatus, tr: TFunction): string => {
  if (status === 'saving') {
    return tr('compose.draft_saving');
  }
  if (status === 'saved') {
    return tr('compose.draft_saved');
  }
  return status === 'error' ? tr('compose.draft_not_saved') : '';
};

/**
 * The code the server gives a send that went out although its copy in Sent could not be stored: the compose closes as sent and
 * must never offer a second send. The other codes handled in `sendErrorText` are Cloudflare's refusals.
 */
const SENT_COPY_FAILED = 'sent_copy_not_saved';

/** What a failed send says: Cloudflare's refusals turned into what the user has to do, else the (already localized) message of the API error. */
const sendErrorText = (error: unknown, tr: TFunction): string => {
  if (error instanceof SealedMailError) {
    return sealedErrorText(error);
  }
  const code = error instanceof ApiError ? error.code : undefined;
  if (code === 'recipient_not_allowed') {
    return tr('compose.err_recipient_not_allowed');
  }
  if (code === 'sender_not_verified' || code === 'sender_domain_not_available') {
    return tr('compose.err_sender_domain');
  }
  if (code === SENT_COPY_FAILED) {
    return tr('compose.sent_copy_failed');
  }
  return error instanceof Error && error.message !== '' ? error.message : tr('fail.compose_send');
};

/** The compose header: what this compose is, from the draft it was opened with. */
const titleOf = (draft: ComposeDraft, tr: TFunction) => {
  if (draft.draftId !== undefined) {
    return tr('compose.title_draft');
  }
  if (draft.quote === undefined) {
    return tr('compose.title_new');
  }
  return /^fwd:/i.test(draft.subject ?? '') ? tr('action.forward') : tr('action.reply');
};

const unique = (list: string[]) => [...new Set(list)];

const squash = (value: string) => value.replaceAll(/\s+/g, ' ').trim();

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

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
    reader.addEventListener('error', () => reject(reader.error ?? new Error('file read failed')));
    reader.readAsDataURL(file);
  });

export const ComposeModal: React.FC<ComposeModalProps> = ({ isOpen, t, onClose, defaultFrom, signature, draft, onSuccess, onNotice }) => {
  const tr = useT();
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
  // The recipient field whose typed text is not an address: the error is said under that field, not in the notice at the top.
  const [badField, setBadField] = React.useState<'to' | 'cc' | 'bcc' | null>(null);
  const [draftStatus, setDraftStatus] = React.useState<DraftStatus>('idle');
  // The first click on the trash button only asks; the second one discards.
  const [confirmingDiscard, setConfirmingDiscard] = React.useState(false);

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
  // The error under a recipient field stays until that field holds only addresses (the bad text was corrected or deleted, or the bad chip
  // removed), not one keystroke and not a change elsewhere: it is a line in the flow, and going away would move the fields under it.
  const fieldParts = { to: [toList, toInput], cc: [ccList, ccInput], bcc: [bccList, bccInput] } as const;
  if (badField !== null) {
    const [list, typed] = fieldParts[badField];
    if ([...list, ...splitRecipients(typed)].every((part) => isAddress(part))) {
      setBadField(null);
    }
  }

  const editorRef = React.useRef<HTMLDivElement | null>(null);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const discardRef = React.useRef<HTMLButtonElement | null>(null);
  const toInputRef = React.useRef<HTMLInputElement | null>(null);
  const ccInputRef = React.useRef<HTMLInputElement | null>(null);
  const bccInputRef = React.useRef<HTMLInputElement | null>(null);
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const { mutateAsync: sendMessage } = useSendMessage();
  const sendFlow = useSendFlow(t);
  // What this message will be, from a debounced key lookup (EC-4): the quiet line under the recipients.
  const preview = useComposePreview({
    enabled: isOpen,
    draft,
    addresses: previewAddresses(toList, ccList, bccList, splitRecipients(toInput), splitRecipients(ccInput), splitRecipients(bccInput)),
    fileSizes: files.map((file) => file.size)
  });
  const queryClient = useQueryClient();

  // Drafts: one saver per time the compose opens. It outlives renders (and the close of the modal, while its last save
  // finishes), so it reads the form and calls back through `latest`.
  const saverRef = React.useRef<DraftSaver | null>(null);
  // contentKey of the form as it was opened; a form still equal to it has nothing to save.
  const baselineRef = React.useRef('');
  const closingRef = React.useRef(false);
  // A send is under way or has gone through. A ref, as state lags a Ctrl+Enter pressed twice; it is only cleared by a failed send
  // or a new compose.
  const sendingRef = React.useRef(false);
  const closeTimerRef = React.useRef<number | undefined>(undefined);
  // The draft the form was last reset for: a later change of `defaultFrom` / `signature` is not a new compose.
  const openedRef = React.useRef<ComposeDraft | null>(null);
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
        ...(draft.inReplyTo === undefined ? null : { in_reply_to: draft.inReplyTo }),
        // N6 must survive a save and a reopen: the flag goes into the sealed draft (EC-3).
        ...(draft.sourceIsE2E === true ? { from_e2e: true } : null)
      },
      empty: to.length === 0 && cc.length === 0 && bcc.length === 0 && subjectText === '' && writtenText(text, signature) === '',
      key: contentKey(from, to, cc, bcc, subjectText, html),
      baseline: baselineRef.current
    };
  };

  // Nothing typed, attached or sent since the compose opened (the sender and the signature it was opened with are not typing).
  const isPristine = () => !sendingRef.current && files.length === 0 && readDraft().key === baselineRef.current;

  const latest = React.useRef({ readDraft, isPristine, onNotice, queryClient, tr });
  React.useLayoutEffect(() => {
    latest.current = { readDraft, isPristine, onNotice, queryClient, tr };
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
      onLost: () => latest.current.onNotice?.(latest.current.tr('compose.draft_not_saved'))
    });
    saverRef.current = saver;
    return () => {
      // Every way out (buttons, Esc, system Back, a sent mail) ends up here; closing twice is harmless.
      void saver.close();
      saverRef.current = null;
      // The close that follows a sent mail must not outlive its compose: it would close the next one.
      window.clearTimeout(closeTimerRef.current);
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

  // The trash button asks for 4 s. A tap elsewhere ends it too (the button's own blur is not enough: Safari does not focus a tapped button).
  React.useEffect(() => {
    if (!confirmingDiscard) {
      return;
    }
    const timer = window.setTimeout(() => setConfirmingDiscard(false), 4000);
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node && discardRef.current?.contains(event.target) === true)) {
        setConfirmingDiscard(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [confirmingDiscard]);

  // Focus goes back to what opened the compose when it closes (as in SettingsModal). This effect comes before the one below, which
  // moves focus into the form.
  React.useEffect(() => {
    if (!isOpen) {
      return;
    }
    const opener = document.activeElement as HTMLElement | null;
    return () => {
      // The opener can be gone: the phone drawer unmounts when its Compose button is used, and the C shortcut starts from BODY. The
      // header button that opens the drawer takes over, else the Compose button (neither has an id: the first is found by its
      // data attribute, the second by its own data attribute).
      const openerGone = !opener || opener === document.body || !opener.isConnected;
      const target = openerGone
        ? (document.querySelector<HTMLElement>('button[data-nav-toggle="mailboxes"]') ??
          document.querySelector<HTMLElement>('button[data-compose-button]'))
        : opener;
      target?.focus({ preventScroll: true });
    };
  }, [isOpen]);

  React.useEffect(() => {
    if (!isOpen) {
      openedRef.current = null;
      return;
    }
    // Settings that finish loading with the compose open must not wipe it: a form that was typed in only gets a sender if it has none.
    if (openedRef.current === draft && !latest.current.isPristine()) {
      setFrom((current) => (current === '' ? defaultFrom : current));
      return;
    }
    openedRef.current = draft;
    const to = unique(splitRecipients(draft.to ?? ''));
    const cc = unique(splitRecipients(draft.cc ?? ''));
    const bcc = unique(splitRecipients(draft.bcc ?? ''));
    const sender = nonEmpty(draft.from) ?? defaultFrom;
    // Form state must be reset when the modal (re)opens.
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
    setBadField(null);
    setDraftStatus('idle');
    setConfirmingDiscard(false);
    closingRef.current = false;
    sendingRef.current = false;
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
    setInput: React.Dispatch<React.SetStateAction<string>>,
    field: 'to' | 'cc' | 'bcc'
  ) => {
    const parts = splitRecipients(raw);
    if (parts.length === 0) {
      return;
    }
    // A mistyped address ('bob') stays in the input instead of becoming a chip that only the server would refuse.
    const valid = parts.filter((part) => isAddress(part));
    const invalid = parts.filter((part) => !isAddress(part));
    const add = () => {
      setList((prev) => [...new Set([...prev, ...valid])]);
      setInput(invalid.join(', '));
    };
    if (invalid.length === 0) {
      add();
      return;
    }
    if (valid.length > 0) {
      add();
    }
    setBadField(field);
  };

  const exec = (command: string, value?: string) => {
    editorRef.current?.focus();
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- no replacement exists for execCommand in a contentEditable editor
    document.execCommand(command, false, value);
  };

  // Enter in a one-line field must not submit the form (Ctrl/Cmd+Enter still sends, from the dialog): it moves on to the body.
  const enterToBody = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      if (editorRef.current) {
        focusAtStart(editorRef.current);
      }
    }
  };

  const handleFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const picked = [...(input.files ?? [])];
    input.value = '';
    if (picked.length === 0) {
      return;
    }
    // Refused as a whole when it would pass what the server accepts; it counts the attachments as base64 plus the text of the body.
    if (files.length + picked.length > MAX_ATTACHMENTS) {
      setStatus({ text: tr('compose.too_many_attachments', { max: MAX_ATTACHMENTS }), type: 'error' });
      return;
    }
    const { html, text } = readBody();
    const size = [...files, ...picked].reduce((total, file) => total + base64Length(file.size), html.length + text.length);
    if (size > MAX_MESSAGE_BYTES) {
      setStatus({ text: tr('compose.attachments_too_large', { max: MAX_MESSAGE_BYTES / (1024 * 1024) }), type: 'error' });
      return;
    }

    try {
      const next = await Promise.all(picked.map(read));
      setFiles((prev) => [...prev, ...next]);
    } catch {
      setStatus({ text: tr('compose.attachment_read_failed'), type: 'error' });
    }
  };

  const handleSend = async () => {
    if (sendingRef.current) {
      return;
    }
    const sender = from.trim();
    const { to, cc, bcc, html, text } = collect();

    if (sender === '') {
      setStatus({ text: tr('compose.missing_from'), type: 'error' });
      return;
    }
    if (to.length === 0) {
      setStatus({ text: tr('compose.need_recipient'), type: 'error' });
      return;
    }
    // Text left in a field after Enter / blur (or a chip from an old draft) that is not an address: said under the first such field.
    const lists = { to, cc, bcc };
    const wrongField = (['to', 'cc', 'bcc'] as const).find((field) => lists[field].some((address) => !isAddress(address)));
    if (wrongField !== undefined) {
      setBadField(wrongField);
      return;
    }
    if (!subject.trim()) {
      setStatus({ text: tr('compose.need_subject'), type: 'error' });
      return;
    }

    sendingRef.current = true;
    setIsSending(true);
    setStatus(null);

    const saver = saverRef.current;
    // The mail is out: its draft is done and the compose closes by itself in a moment (sendingRef stays set until then).
    const markSent = (notice: string) => {
      saver?.finishSent();
      setDraftStatus('idle');
      setStatus({ text: notice, type: 'success' });
      closeTimerRef.current = window.setTimeout(onClose, 900);
    };
    try {
      // A save in flight finishes first and no new one starts: a PUT landing after the send would bring the draft back.
      await saver?.lockForSend();
      const wrappedHtml = `<div style="font-family:'Geist',ui-sans-serif,system-ui,sans-serif;font-size:15px;line-height:24px">${html}</div>`;
      // Between people on this server the message is sealed here, in the browser (lib/sealedmail); anything else goes the usual way.
      const outcome = await sendFlow.run({
        sender,
        headers: { to, cc, bcc, in_reply_to: draft.inReplyTo, references: draft.references, draft_id: saver?.id },
        content: { subject: subject.trim(), text, html: wrappedHtml },
        attachments: files.map(outgoingFile),
        sourceIsE2E: draft.sourceIsE2E === true
      });
      if (outcome.status === 'cancelled') {
        // The person said no to a question: nothing was sent, the compose stays as it was.
        saver?.unlock();
        sendingRef.current = false;
        return;
      }
      let note: string | undefined;
      if (outcome.status === 'normal') {
        ({ note } = await sendMessage({
          from: sender,
          to,
          cc: cc.length > 0 ? cc : undefined,
          bcc: bcc.length > 0 ? bcc : undefined,
          subject: subject.trim(),
          text,
          html: wrappedHtml,
          attachments:
            files.length > 0
              ? files.map((f) => ({ filename: f.filename, content_type: f.content_type, content_base64: f.content_base64 }))
              : undefined,
          in_reply_to: draft.inReplyTo,
          references: draft.references,
          draft_id: saver?.id
        }));
      }

      markSent(tr('compose.sent'));
      onSuccess(note);
    } catch (error: unknown) {
      console.error('Send failed', error);
      if (error instanceof UnauthorizedError) {
        // The session is gone: a normal read signs the person out the way every other screen does.
        void queryClient.invalidateQueries({ queryKey: queryKeys.messages });
      }
      const message = sendErrorText(error, tr);
      if (error instanceof ApiError && error.code === SENT_COPY_FAILED) {
        // The mail went out and only its copy in Sent is missing: sending it again would deliver it twice.
        markSent(message);
        onSuccess();
        // The compose is gone in under a second; the warning has to outlive it.
        onNotice?.(message);
      } else {
        // The server keeps the draft when the send fails; autosave goes on.
        saver?.unlock();
        sendingRef.current = false;
        setStatus({ text: error instanceof TypeError ? tr('compose.no_connection') : message, type: 'error' });
      }
    } finally {
      setIsSending(false);
    }
  };

  // The ways out of the compose that keep a draft: wait (up to 2 s) for its last save, then close.
  const requestClose = async () => {
    // Not while a send is under way: a failure after the compose is gone would go unseen.
    if (closingRef.current || isSending) {
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
      onNotice?.(tr('compose.discard_failed'));
    }
    onClose();
  };

  const missingFrom = from.trim() === '';
  // A sent mail (it closes in a moment) must not be sent again.
  const sent = status?.type === 'success';
  const noSignature = signatureBlock(signature) === '';
  // The empty-sender hint shows until the field is filled; other messages (validation, send result) take over.
  const shownStatus = status ?? (missingFrom ? { text: tr('compose.missing_from'), type: 'error' as const } : null);

  // At the end of the line of the To field, on every width. Gone once both rows are showing.
  const ccBccToggle =
    showCc && showBcc ? null : (
      <Button
        variant="ghost"
        size="sm"
        className="cp-toggle"
        onClick={() => {
          const newRow = showCc ? bccInputRef : ccInputRef;
          flushSync(() => {
            setShowCc(true);
            setShowBcc(true);
          });
          // This button is gone now: focus the new row, otherwise focus leaves the dialog and Escape / Ctrl+Enter stop working.
          newRow.current?.focus();
        }}
      >
        {`${tr('term.cc')}/${tr('term.bcc')}`}
      </Button>
    );

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- dialog-wide Escape / Ctrl+Enter shortcuts catch keys bubbling up from the fields inside
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby="compose-title"
      tabIndex={-1}
      className="cp-root"
      onKeyDown={(e) => {
        // The question dialog of a send (compose/useConfirm) lives inside this root: its keys are its own.
        if (e.target instanceof Element && e.target.closest('[role="alertdialog"]') !== null) {
          return;
        }
        trapTab(e, dialogRef.current);
        if (e.key === 'Escape') {
          void requestClose();
        }
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          void handleSend();
        }
      }}
    >
      <div className="cp-panel nm-fade-in">
        <header className="cp-head">
          <h1 id="compose-title" className="cp-title">
            {titleOf(draft, tr)}
          </h1>
          {/* Always rendered (empty when idle) so a status change never moves anything and screen readers hear it. */}
          <output aria-live="polite" className="cp-draft" data-state={draftStatus}>
            {draftStatusText(draftStatus, tr)}
          </output>
          <IconButton
            label={tr('common.close')}
            disabled={isSending}
            onClick={() => {
              void requestClose();
            }}
          >
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
        </header>

        {shownStatus ? (
          <div className="cp-notice">
            <Banner tone={shownStatus.type === 'error' ? 'danger' : 'success'}>{shownStatus.text}</Banner>
          </div>
        ) : null}

        <main className="cp-main">
          <form
            className="cp-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend();
            }}
          >
            {/* Scroll region: fields, editor and attachments. The footer below stays pinned. */}
            <div className="cp-scroll">
              <div className="cp-row">
                <label htmlFor="compose-from" className="cp-label">
                  {tr('term.sender')}
                </label>
                <div className="cp-field">
                  <input
                    id="compose-from"
                    className="cp-input"
                    type="email"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    onKeyDown={enterToBody}
                    placeholder={tr('compose.from_placeholder')}
                  />
                </div>
              </div>

              <RecipientField
                id="compose-to"
                className="cp-row-to"
                label={tr('term.to')}
                list={toList}
                input={toInput}
                inputRef={toInputRef}
                placeholder={toList.length === 0 ? tr('compose.to_placeholder') : ''}
                onInput={setToInput}
                onCommit={() => commitRecipients(toInput, setToList, setToInput, 'to')}
                onRemove={(address) => setToList((prev) => prev.filter((a) => a !== address))}
                onBackspace={() => setToList((prev) => prev.slice(0, -1))}
                trailing={ccBccToggle}
                error={badField === 'to' ? tr('compose.invalid_address') : undefined}
              />

              {showCc ? (
                <RecipientField
                  id="compose-cc"
                  label={tr('term.cc')}
                  list={ccList}
                  input={ccInput}
                  inputRef={ccInputRef}
                  onInput={setCcInput}
                  onCommit={() => commitRecipients(ccInput, setCcList, setCcInput, 'cc')}
                  onRemove={(address) => setCcList((prev) => prev.filter((a) => a !== address))}
                  error={badField === 'cc' ? tr('compose.invalid_address') : undefined}
                />
              ) : null}

              {showBcc ? (
                <RecipientField
                  id="compose-bcc"
                  label={tr('term.bcc')}
                  list={bccList}
                  input={bccInput}
                  inputRef={bccInputRef}
                  onInput={setBccInput}
                  onCommit={() => commitRecipients(bccInput, setBccList, setBccInput, 'bcc')}
                  onRemove={(address) => setBccList((prev) => prev.filter((a) => a !== address))}
                  error={badField === 'bcc' ? tr('compose.invalid_address') : undefined}
                />
              ) : null}

              <ReplyRedirectNote t={t} redirect={draft.replyRedirect} to={toList} />

              <ComposeState t={t} preview={preview} />

              <div className="cp-row">
                <label htmlFor="compose-subject" className="cp-label">
                  {tr('term.subject')}
                </label>
                <div className="cp-field">
                  <input
                    id="compose-subject"
                    className="cp-input cp-subject"
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    onKeyDown={enterToBody}
                    placeholder={tr('term.subject')}
                  />
                </div>
              </div>

              <FormatToolbar exec={exec} />

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
                aria-label={tr('compose.body_label')}
                data-placeholder={tr('compose.body_placeholder')}
                className="nm-editor cp-editor"
                onInput={() => {
                  readBody();
                  setStatus((prev) => (prev?.type === 'error' ? null : prev));
                  saverRef.current?.touch();
                }}
              />

              <AttachmentList files={files} onRemove={(index) => setFiles((prev) => prev.filter((_, i) => i !== index))} />
            </div>

            <div className="cp-foot">
              <Button
                type="submit"
                variant="primary"
                loading={isSending}
                disabled={sent || missingFrom}
                leadingIcon={<Send size={16} strokeWidth={1.75} aria-hidden="true" />}
              >
                {isSending ? tr('compose.sending') : tr('action.send')}
              </Button>
              <span className="cp-hint">
                {tRich('compose.send_shortcut', {
                  keys: (
                    <span className="cp-keys">
                      <Kbd>{tr('compose.key_ctrl')}</Kbd>
                      <Kbd>{tr('compose.key_enter')}</Kbd>
                    </span>
                  )
                })}
              </span>
              <div className="cp-tools">
                <IconButton label={tr('action.attach_files')} onClick={() => fileRef.current?.click()}>
                  <Paperclip size={18} strokeWidth={1.75} aria-hidden="true" />
                </IconButton>
                {/* Not `disabled` without a signature: a disabled button cannot say why. It stays focusable and its label says what to do. */}
                <IconButton
                  label={noSignature ? tr('compose.no_signature') : tr('compose.insert_signature')}
                  aria-disabled={noSignature ? true : undefined}
                  onClick={() => {
                    if (noSignature) {
                      return;
                    }
                    editorRef.current?.focus();
                    const block = signatureBlock(signature);
                    if (block !== '') {
                      // eslint-disable-next-line @typescript-eslint/no-deprecated -- no replacement exists for execCommand in a contentEditable editor
                      document.execCommand('insertText', false, block);
                    }
                  }}
                >
                  <Signature size={18} strokeWidth={1.75} aria-hidden="true" />
                </IconButton>
                {/* The same button asks and then discards, so it keeps focus between the two presses. */}
                <IconButton
                  ref={discardRef}
                  variant={confirmingDiscard ? 'danger' : 'ghost'}
                  className="cp-discard"
                  data-confirming={confirmingDiscard ? 'true' : undefined}
                  label={confirmingDiscard ? tr('compose.confirm_discard') : tr('action.discard_draft')}
                  onClick={() => {
                    // Asks first when something would be lost: typed text, attachments, or a draft that is saved on the server.
                    const { empty } = readDraft();
                    const worthKeeping = files.length > 0 || (!empty && (draft.draftId !== undefined || !isPristine()));
                    if (confirmingDiscard || !worthKeeping) {
                      void discardDraft();
                    } else {
                      setConfirmingDiscard(true);
                    }
                  }}
                  onBlur={() => setConfirmingDiscard(false)}
                >
                  {confirmingDiscard ? tr('compose.discard_ask') : <Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />}
                </IconButton>
              </div>
            </div>
          </form>
        </main>
      </div>
      {sendFlow.dialog}
    </div>
  );
};
