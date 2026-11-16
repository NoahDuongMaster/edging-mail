import React from 'react';
import { flushSync } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Check, CircleAlert, Ellipsis, Paperclip, Send, Signature, Trash2, X } from 'lucide-react';
import type { ThemeTokens } from '../theme';
import type { Message } from '../types';
import { ApiError, UnauthorizedError } from '../lib/api';
import { bareAddress, nonEmpty } from '../lib/mail';
import { isAddress, knownContacts, type Contact } from '../lib/contacts';
import { DraftSaver, newDraftId, sanitizeDraftHtml, type DraftSnapshot, type DraftStatus } from '../lib/drafts';
import { trapTab } from '../lib/focusTrap';
import { tRich, useT, type TFunction } from '../lib/i18n';
import { holdForUndo, SendUndone } from '../lib/outbox';
import { readPrefs } from '../lib/prefs';
import { queryKeys, useSendMessage, type MessageDetail, type MessagesPage } from '../lib/queries';
import { SealedMailError, previewAddresses, sealedErrorText, type Fetcher, type OutgoingAttachment } from '../lib/sealedmail';
import { restoreSignatureDelimiter, signatureBlock } from '../lib/settings';
import { announce } from '../lib/announce';
import { Banner, Button, Divider, IconButton, Kbd } from '../ui';
import { ConfirmDialog } from './ConfirmDialog';
import { AttachmentList } from './compose/AttachmentList';
import { useComposeMotion, type ComposeExit } from './compose/composeMotion';
import { ComposeState } from './compose/ComposeState';
import { FormatToolbar } from './compose/FormatToolbar';
import { RecipientField } from './compose/RecipientField';
import { useComposePreview } from './compose/useComposePreview';
import { useSendFlow } from './compose/useSendFlow';
import { ReplyRedirectNote } from './compose/ReplyRedirectNote';
import type { ReplyRedirect } from '../lib/mail';
import './compose/compose.css';

/** A file of a compose that is reopened as it was (Undo send, a send that failed after the window closed): its bytes come with it. */
export interface ComposeAttachment {
  id: string;
  filename: string;
  content_type: string;
  content_base64: string;
  size: number;
}

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
  /** Quoted mail of a reply or forward; the signature goes above it and the caret on top. A reply's quote is folded away (J6-13). */
  quote?: string;
  /** Message-ID of the mail being answered (replies only; a forward is a new thread). */
  inReplyTo?: string;
  references?: string[];
  /** The mail being answered or forwarded is end-to-end encrypted (`is_e2e`): sending its content to an outside address needs a warning first (N6). */
  sourceIsE2E?: boolean;
  /** The mail being answered asks for replies at another address than the sender's (PX-12): shown on a line of its own while it is in To. */
  replyRedirect?: ReplyRedirect;
  /** The heading of the window when it is reopened as it was ("Reply", "New message"), instead of the one its fields would give. */
  title?: string;
  /** The files of a compose reopened as it was (drafts keep none: they come back only with Undo send or a failed send). */
  attachments?: ComposeAttachment[];
  /** A send that failed after the window had closed: said at the top of the reopened window. */
  sendError?: string;
}

/** A message waiting for its Undo time before it leaves (lib/outbox.ts): the app shows "Sending..." with Undo until it goes. */
export interface QueuedSend {
  seconds: number;
  /** Takes the message back and reopens the compose as it was; false when it is too late. */
  undo: () => boolean;
  /**
   * The hold's clock (J1-16): the "Sending..." toast pauses it whenever its own countdown stops (hover, focus, a hidden tab) and resumes it,
   * so the message never leaves while the toast says there is time left.
   */
  pause: () => void;
  resume: () => void;
  /** Milliseconds left before it leaves: the toast's time when it comes up a moment after the window closed. */
  remaining: () => number;
  /** Settles when the wait is over (true: it leaves now) or Undo took it back (false). */
  done: Promise<boolean>;
}

interface ComposeModalProps {
  isOpen: boolean;
  t: ThemeTokens;
  onClose: () => void;
  /** The signed-in account's address: the only From the server sends with (`from_not_allowed` for any other), shown read-only (J6-30). */
  defaultFrom: string;
  /** The account's display name, shown before the address on the From line ('' when none). */
  fromName?: string;
  /** Saved plain-text signature; '' when none. */
  signature: string;
  draft: ComposeDraft;
  /** The message has left (after its Undo time). */
  onSuccess: (note?: string) => void;
  /** A short message for after the compose is gone (a draft that could not be saved or discarded). */
  onNotice?: (text: string) => void;
  /** Send was pressed and the window has closed: the message waits `seconds` for an Undo (J6-02). Not called when Undo send is off. */
  onQueued?: (queued: QueuedSend) => void;
  /** Opens the compose again with this content (Undo of a send, a send that failed after the window closed). */
  onReopen?: (draft: ComposeDraft) => void;
  /** The window was closed and its draft is kept in Drafts: the app says so, with a way to open it again (J4-11). */
  onDraftKept?: (draft: ComposeDraft) => void;
}

interface PendingFile {
  /** Tells two files of the same name apart while they are listed. */
  id: string;
  filename: string;
  content_type: string;
  /** Empty while the file is being read. */
  content_base64: string;
  size: number;
  /** How much of it is read (0..1) while it is being added (M12), null once it is in. */
  progress: number | null;
}

const splitRecipients = (value: string): string[] => value.split(/[\s,;]+/).filter(Boolean);

// What the server accepts in one send (src/worker/services/email-sender.ts); it counts the base64 text of the attachments.
const MAX_ATTACHMENTS = 32;
const MAX_MESSAGE_BYTES = 25 * 1024 * 1024;
const base64Length = (bytes: number) => Math.ceil(bytes / 3) * 4;

/** The address lookup of the end-to-end route: it runs before the questions, so it is never held back for Undo. */
const LOOKUP_URL = '/api/keys/lookup';

/** A picked file as the sealed send takes it: its bytes (the compose keeps them as base64). */
const outgoingFile = (file: PendingFile): OutgoingAttachment => ({
  filename: file.filename,
  mimeType: file.content_type,
  contentId: null,
  bytes: Uint8Array.from(atob(file.content_base64), (char) => char.codePointAt(0) ?? 0)
});

const escapeHtml = (value: string) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br />');

/** A field that has nothing in it at Send: the problem is said under that field (settled: errors in the flow, under their field). */
type MissingField = 'to' | 'subject';

/**
 * The header's status text of the draft autosave ('' while idle). A draft keeps no files (J4-12, J6-03): that is said ONCE, under the files
 * (AttachmentList), next to its cause; the header only says that the draft was saved.
 */
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
  if (error instanceof TypeError) {
    return tr('compose.no_connection');
  }
  return error instanceof Error && error.message !== '' ? error.message : tr('fail.compose_send');
};

/** The compose header: what this compose is, from the draft it was opened with. */
const titleOf = (draft: ComposeDraft, tr: TFunction) => {
  if (draft.title !== undefined) {
    return draft.title;
  }
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

/** The quote of a reply: the attribution line, then the answered mail line by line with its `> ` marks (a forward's header is not one). */
const isReplyQuote = (quote: string) => {
  const lines = quote.split('\n');
  return lines.length >= 2 && lines.slice(1).every((line) => line.startsWith('>'));
};

/** A reply's quote as the HTML that follows the body: the attribution, then the answered mail in a blockquote. Normalised by the parser. */
const quoteHtmlOf = (quote: string): string => {
  const [attribution, ...lines] = quote.split('\n');
  const probe = document.createElement('div');
  probe.innerHTML = `<br><br><div>${escapeHtml(attribution)}</div><blockquote>${lines
    .map((line) => escapeHtml(line.replace(/^> ?/, '')))
    .join('<br>')}</blockquote>`;
  return probe.innerHTML;
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

/** A phone on its side (compose.css: the short landscape compose). */
const SHORT_LANDSCAPE = '(max-width: 900px) and (orientation: landscape) and (max-height: 500px)';

/**
 * J5-25: writing in the body of a phone on its side with the keyboard up brings the body to the top of the scrolling form (the fields scroll
 * away above it, a scroll up brings them back), as long as the caret stays in view: all of what the keyboard leaves is room to write.
 */
function bodyToTop(root: HTMLElement): void {
  const editor = root.querySelector<HTMLElement>('.cp-editor');
  const scroller = editor?.closest<HTMLElement>('.cp-scroll');
  if (
    editor === null ||
    scroller === null ||
    scroller === undefined ||
    document.activeElement !== editor ||
    root.dataset.keyboard !== 'true' ||
    !window.matchMedia(SHORT_LANDSCAPE).matches
  ) {
    return;
  }
  const editorTop = editor.getBoundingClientRect().top;
  const offset = editorTop - scroller.getBoundingClientRect().top;
  const selection = window.getSelection();
  const caret = selection !== null && selection.rangeCount > 0 ? selection.getRangeAt(0).getBoundingClientRect() : null;
  const caretDepth = caret === null || caret.height === 0 ? 0 : caret.bottom - editorTop;
  if (offset > 0 && caretDepth < scroller.clientHeight - 8) {
    scroller.scrollTop += offset;
  }
}

/** Reads a picked file as base64, telling how far it has got (0..1) as it goes. */
const read = (file: File, onProgress: (part: number) => void) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('progress', (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress(event.loaded / event.total);
      }
    });
    reader.addEventListener('load', () => {
      const result = typeof reader.result === 'string' ? reader.result : '';
      resolve(result.split(',', 2)[1] || '');
    });
    reader.addEventListener('error', () => reject(reader.error ?? new Error('file read failed')));
    reader.readAsDataURL(file);
  });

/** The names the mail in this browser gives addresses (lower-case address -> display name): a recipient chip shows the name (J6-12). */
function knownNames(queryClient: ReturnType<typeof useQueryClient>): Map<string, string> {
  const names = new Map<string, string>();
  const add = (message: Message) => {
    const name = message.from_name?.trim() ?? '';
    if (name !== '') {
      names.set(bareAddress(message.from_address), name);
    }
  };
  for (const [, data] of queryClient.getQueriesData<{ pages?: MessagesPage[] }>({ queryKey: queryKeys.messages })) {
    for (const page of data?.pages ?? []) {
      for (const message of page.messages) {
        add(message);
      }
    }
  }
  for (const [, detail] of queryClient.getQueriesData<MessageDetail>({ queryKey: queryKeys.messageDetails })) {
    if (detail !== undefined) {
      add(detail.message);
    }
  }
  return names;
}

let fileCounter = 0;

export const ComposeModal: React.FC<ComposeModalProps> = ({
  isOpen,
  t,
  onClose,
  defaultFrom,
  fromName = '',
  signature,
  draft,
  onSuccess,
  onNotice,
  onQueued,
  onReopen,
  onDraftKept
}) => {
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
  // A field left empty at Send (To, the subject): said under that field until it is filled.
  const [missing, setMissing] = React.useState<MissingField | null>(null);
  // Discard draft asks first (a ConfirmDialog) when something would be lost.
  const [discardAsk, setDiscardAsk] = React.useState(false);
  // Closing with files attached asks first: a draft keeps no files (J4-12, J6-03).
  const [closeAsk, setCloseAsk] = React.useState(false);
  // A reply's quote is folded away behind "Show quoted text" (it is sent all the same).
  const [quoteFolded, setQuoteFolded] = React.useState(false);

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
  // An empty field's problem goes as soon as the field holds something.
  const filled = { to: toList.length > 0 || toInput.trim() !== '', subject: subject.trim() !== '' };
  if (missing !== null && filled[missing]) {
    setMissing(null);
  }

  const editorRef = React.useRef<HTMLDivElement | null>(null);
  const dialogRef = React.useRef<HTMLDivElement | null>(null);
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  // How the window leaves (M10 back toward its opener, or M11 sent): read by the exit motion when it closes.
  const exitRef = React.useRef<ComposeExit>('close');
  useComposeMotion(isOpen, dialogRef, panelRef, exitRef);
  // The files still being read; a send waits for them.
  const readsRef = React.useRef<Promise<unknown>[]>([]);
  // The bytes of each file once read, by its id: a send that waited for a read takes them from here (its render saw the file still empty).
  const contentsRef = React.useRef(new Map<string, string>());
  // "Draft saved" is said to screen readers once per compose (and again after a failure), not after every pause in typing.
  const savedSaidRef = React.useRef(false);
  // The draft of this compose is on the server (a save went through, or it was opened from Drafts).
  const savedOnceRef = React.useRef(false);
  // Each opening of the compose: a send that finishes after the window was closed and opened again must not touch the new one.
  const sessionRef = React.useRef(0);
  // The folded quote of a reply (its HTML and its plain text), added to what is saved and sent while it is folded.
  const quoteRef = React.useRef<{ html: string; text: string } | null>(null);
  const foldedRef = React.useRef(false);
  const discardRef = React.useRef<HTMLButtonElement | null>(null);
  const toInputRef = React.useRef<HTMLInputElement | null>(null);
  const subjectRef = React.useRef<HTMLInputElement | null>(null);
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
  // The names of the people in the mail already loaded, for the recipient chips; read again each time the compose opens.
  const [names, setNames] = React.useState<ReadonlyMap<string, string>>(() => new Map());
  // J6-44: the people the recipient fields suggest, newest first, from the same mail in memory (lib/contacts.ts: never stored, never sent).
  const [contacts, setContacts] = React.useState<readonly Contact[]>([]);
  // The addresses already in the message: no field suggests them again.
  const taken = React.useMemo(
    () => new Set([...toList, ...ccList, ...bccList].map((address) => address.toLowerCase())),
    [toList, ccList, bccList]
  );

  // Drafts: one saver per time the compose opens. It outlives renders (and the close of the modal, while its last save
  // finishes), so it reads the form and calls back through `latest`.
  const saverRef = React.useRef<DraftSaver | null>(null);
  // contentKey of the form as it was opened; a form still equal to it has nothing to save.
  const baselineRef = React.useRef('');
  const closingRef = React.useRef(false);
  // A send is under way or has gone through. A ref, as state lags a Ctrl+Enter pressed twice; it is only cleared by a failed send
  // or a new compose.
  const sendingRef = React.useRef(false);
  // The draft the form was last reset for: a later change of `defaultFrom` / `signature` is not a new compose.
  const openedRef = React.useRef<ComposeDraft | null>(null);
  // The body as of the last edit. A compose closed from outside (system Back) loses its editor before the last save reads it.
  const bodyRef = React.useRef({ html: '', text: '' });
  const readBody = React.useCallback(() => {
    const editor = editorRef.current;
    if (editor) {
      const quote = foldedRef.current ? quoteRef.current : null;
      bodyRef.current = {
        html: `${editor.innerHTML}${quote?.html ?? ''}`,
        text: `${plainTextOf(editor)}${quote?.text ?? ''}`
      };
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

  /** The compose as it is now, to open it again exactly so (Undo send, a send that failed, Open of a kept draft). */
  const snapshotOf = (attached: readonly PendingFile[], draftId: string | undefined): ComposeDraft => {
    const { to, cc, bcc, html, text } = collect();
    return {
      title: titleOf(draft, tr),
      draftId,
      from: from.trim(),
      to: to.join(', '),
      cc: cc.join(', '),
      bcc: bcc.join(', '),
      subject,
      html,
      body: text,
      inReplyTo: draft.inReplyTo,
      references: draft.references,
      sourceIsE2E: draft.sourceIsE2E,
      replyRedirect: draft.replyRedirect,
      attachments: attached.map(({ id, filename, content_type, content_base64, size }) => ({
        id,
        filename,
        content_type,
        content_base64,
        size
      }))
    };
  };

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
          if (next === 'saved') {
            savedOnceRef.current = true;
          }
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

  // The autosave line is shown in the header; screen readers hear it through the app's live region: "Draft saved" once (and again after a
  // failure), a failure every time.
  React.useEffect(() => {
    if (draftStatus === 'error') {
      savedSaidRef.current = false;
      announce(tr('compose.draft_not_saved'));
    } else if (draftStatus === 'saved' && !savedSaidRef.current) {
      savedSaidRef.current = true;
      announce(tr('compose.draft_saved'));
    }
  }, [draftStatus, tr]);

  // Phone: the window is as tall as what the on-screen keyboard leaves (the visual viewport), so the footer with Send stays above it.
  React.useEffect(() => {
    const viewport = window.visualViewport;
    const root = dialogRef.current;
    if (!isOpen || viewport === null || root === null) {
      return;
    }
    const fit = () => {
      root.style.setProperty('--vv-height', `${viewport.height}px`);
      root.style.setProperty('--vv-top', `${viewport.offsetTop}px`);
      // J5-25: the on-screen keyboard is up (it takes a good part of the window): a short landscape compose sends from its head (compose.css).
      root.dataset.keyboard = window.innerHeight - viewport.height > 80 ? 'true' : 'false';
    };
    // The keyboard coming up (a resize, not a pan of the viewport) gives the body the room it leaves.
    const resize = () => {
      fit();
      window.requestAnimationFrame(() => bodyToTop(root));
    };
    fit();
    viewport.addEventListener('resize', resize);
    viewport.addEventListener('scroll', fit);
    return () => {
      viewport.removeEventListener('resize', resize);
      viewport.removeEventListener('scroll', fit);
    };
  }, [isOpen]);

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
    // Settings that finish loading with the compose open must not wipe it: the form keeps what was typed and only takes the account's
    // address as its sender (the one From the server sends with).
    if (openedRef.current === draft && !latest.current.isPristine()) {
      setFrom((current) => nonEmpty(defaultFrom) ?? current);
      return;
    }
    openedRef.current = draft;
    sessionRef.current += 1;
    const people = knownContacts(latest.current.queryClient, defaultFrom);
    setContacts(people);
    // A chip names a picked person too (their name may come only from the recipients of sent mail).
    setNames(
      new Map([
        ...people.filter((person) => person.name !== '').map((person) => [person.address, person.name] as const),
        ...knownNames(latest.current.queryClient)
      ])
    );
    const to = unique(splitRecipients(draft.to ?? ''));
    const cc = unique(splitRecipients(draft.cc ?? ''));
    const bcc = unique(splitRecipients(draft.bcc ?? ''));
    // J6-30: the sender is the account's own address (read-only); a draft's older From only stands in until the settings have loaded.
    const sender = nonEmpty(defaultFrom) ?? nonEmpty(draft.from) ?? '';
    const attached = (draft.attachments ?? []).map((file) => ({ ...file, progress: null }));
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
    setFiles(attached);
    setStatus(draft.sendError === undefined ? null : { text: draft.sendError, type: 'error' });
    setBadField(null);
    setMissing(null);
    setDraftStatus('idle');
    setDiscardAsk(false);
    setCloseAsk(false);
    closingRef.current = false;
    sendingRef.current = false;
    exitRef.current = 'close';
    readsRef.current = [];
    contentsRef.current = new Map(attached.map((file) => [file.id, file.content_base64]));
    savedSaidRef.current = false;
    savedOnceRef.current = draft.draftId !== undefined;
    // A reply's quote (the attribution and the `> ` lines) is folded away under the body; a forward's header and text stay in it.
    const quote = draft.quote === undefined ? undefined : trimQuote(draft.quote);
    const fold = quote !== undefined && draft.body === undefined && draft.html === undefined && isReplyQuote(quote);
    quoteRef.current = fold ? { html: quoteHtmlOf(quote), text: `\n\n${quote}` } : null;
    foldedRef.current = fold;
    setQuoteFolded(fold);
    const editor = editorRef.current;
    if (editor) {
      // New mail: the signature. Reply: the signature, the quote folded under it. Forward: the signature above the quote. Reopened draft:
      // exactly what was saved.
      const inline = quote === undefined || fold ? '' : `\n\n${quote}`;
      const text = draft.body ?? `${signatureBlock(signature)}${inline}`;
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

  // J6-44: a suggestion was taken: its address is a chip at once (it comes from mail, so it is an address), and the typed text goes.
  const pickRecipient = (
    address: string,
    setList: React.Dispatch<React.SetStateAction<string[]>>,
    setInput: React.Dispatch<React.SetStateAction<string>>
  ) => {
    setList((prev) => unique([...prev, address]));
    setInput('');
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

  /** Shows the folded quote of a reply: it goes into the body, where it can be edited (J6-13). */
  const unfoldQuote = () => {
    const editor = editorRef.current;
    const quote = quoteRef.current;
    if (editor === null || quote === null) {
      return;
    }
    foldedRef.current = false;
    setQuoteFolded(false);
    editor.insertAdjacentHTML('beforeend', quote.html);
    readBody();
    // The button is gone: focus goes into the body, at its top (where a reply is written).
    focusAtStart(editor);
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

    // M12: each file is listed at once with its progress, and gets its size when it is in.
    const entries = picked.map((file) => {
      fileCounter += 1;
      return {
        file,
        entry: {
          id: `f${fileCounter}`,
          filename: file.name,
          content_type: file.type || 'application/octet-stream',
          content_base64: '',
          size: file.size,
          progress: 0
        } satisfies PendingFile
      };
    });
    setFiles((prev) => [...prev, ...entries.map(({ entry }) => entry)]);
    const update = (id: string, change: Partial<PendingFile>) =>
      setFiles((prev) => prev.map((file) => (file.id === id ? { ...file, ...change } : file)));
    const reads = entries.map(async ({ file, entry }) => {
      try {
        const content = await read(file, (part) => update(entry.id, { progress: part }));
        contentsRef.current.set(entry.id, content);
        update(entry.id, { content_base64: content, progress: null });
      } catch {
        setFiles((prev) => prev.filter((item) => item.id !== entry.id));
        setStatus({ text: tr('compose.attachment_read_failed'), type: 'error' });
      }
    });
    readsRef.current = [...readsRef.current, ...reads];
    await Promise.all(reads);
  };

  const handleSend = async () => {
    if (sendingRef.current) {
      return;
    }
    const sender = from.trim();
    const { to, cc, bcc, html, text } = collect();

    // What is missing is said under its field (and the field takes focus), not in the notice at the top. The sender is never missing: it
    // is the account's address (J6-30).
    if (to.length === 0) {
      setMissing('to');
      toInputRef.current?.focus();
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
      setMissing('subject');
      subjectRef.current?.focus();
      return;
    }

    const session = sessionRef.current;
    sendingRef.current = true;
    setIsSending(true);
    setStatus(null);
    // A file still being read is waited for: it goes out whole or not at all (one that failed is no longer in the list).
    await Promise.all(readsRef.current);
    const contents = contentsRef.current;
    const ready = files
      .filter((file) => contents.has(file.id))
      .map((file) => ({ ...file, content_base64: contents.get(file.id) ?? file.content_base64 }));

    const saver = saverRef.current;
    // Undo send (J6-02): the seconds this device holds a message back (Settings; 0 = it leaves at once).
    const seconds = readPrefs().undoSend;
    // `gone`: the window has closed and the message is on its way (its Undo time, then the send). `reopen`: the compose as it was then, to
    // open it again exactly so (Undo, or a send that fails once the window is gone).
    const flight: { gone: boolean; reopen: ComposeDraft | null } = { gone: false, reopen: null };

    // The moment the message is ready to leave (every question answered, the sealed copies built): the window closes now (M11: Send's
    // icon takes off from it), and the message waits its Undo time; Undo opens the compose again as it was.
    const leave = async (): Promise<void> => {
      if (flight.gone) {
        return;
      }
      flight.gone = true;
      // The draft is on the server (it was saved before the lock), so the reopened compose goes on with the same draft.
      const snapshot = snapshotOf(ready, savedOnceRef.current ? saver?.id : undefined);
      flight.reopen = snapshot;
      // Send shows its icon again (not the spinner) in the window that leaves: that icon is the one that takes off.
      flushSync(() => setIsSending(false));
      exitRef.current = 'sent';
      onClose();
      if (seconds <= 0) {
        return;
      }
      const held = holdForUndo(seconds);
      onQueued?.({
        seconds,
        undo: () => {
          if (!held.undo()) {
            return false;
          }
          announce(tr('compose.send_undone'));
          onReopen?.(snapshot);
          return true;
        },
        pause: held.pause,
        resume: held.resume,
        remaining: held.remaining,
        done: held.done
      });
      if (!(await held.done)) {
        throw new SendUndone();
      }
    };
    // The end-to-end route sends from inside the flow: its request is held at the door (the key lookup before the questions is not).
    const fetcher: Fetcher = async (url, init) => {
      if (url !== LOOKUP_URL) {
        await leave();
      }
      return fetch(url, init);
    };

    try {
      // The latest content is saved first (a tab closed during the Undo time keeps it in Drafts), then no new save starts: a PUT landing
      // after the send would bring the draft back.
      saver?.saveNow();
      await saver?.lockForSend();
      const wrappedHtml = `<div style="font-family:'Geist',ui-sans-serif,system-ui,sans-serif;font-size:15px;line-height:24px">${html}</div>`;
      // Between people on this server the message is sealed here, in the browser (lib/sealedmail); anything else goes the usual way.
      const outcome = await sendFlow.run(
        {
          sender,
          headers: { to, cc, bcc, in_reply_to: draft.inReplyTo, references: draft.references, draft_id: saver?.id },
          content: { subject: subject.trim(), text, html: wrappedHtml },
          attachments: ready.map(outgoingFile),
          sourceIsE2E: draft.sourceIsE2E === true
        },
        // A question that comes after the window closed (a key changed while the message waited) cannot be asked: it is a no.
        { fetcher, canAsk: () => !flight.gone }
      );
      if (outcome.status === 'cancelled') {
        if (flight.reopen !== null) {
          // Nothing was sent: the compose comes back as it was, and says why.
          onReopen?.({ ...flight.reopen, sendError: tr('compose.send_interrupted') });
          return;
        }
        // The person said no to a question: nothing was sent, the compose stays as it was.
        saver?.unlock();
        sendingRef.current = false;
        return;
      }
      let note: string | undefined;
      if (outcome.status === 'normal') {
        await leave();
        ({ note } = await sendMessage({
          from: sender,
          to,
          cc: cc.length > 0 ? cc : undefined,
          bcc: bcc.length > 0 ? bcc : undefined,
          subject: subject.trim(),
          text,
          html: wrappedHtml,
          attachments:
            ready.length > 0
              ? ready.map((f) => ({ filename: f.filename, content_type: f.content_type, content_base64: f.content_base64 }))
              : undefined,
          in_reply_to: draft.inReplyTo,
          references: draft.references,
          draft_id: saver?.id
        }));
      }
      // The mail is out: its draft is done (the server deleted it with the send).
      await leave();
      saver?.finishSent();
      onSuccess(note);
    } catch (error: unknown) {
      if (error instanceof SendUndone) {
        // Undo took it back and opened the compose again: nothing left.
        return;
      }
      console.error('Send failed', error);
      if (error instanceof UnauthorizedError) {
        // The session is gone: a normal read signs the person out the way every other screen does.
        void queryClient.invalidateQueries({ queryKey: queryKeys.messages });
      }
      const message = sendErrorText(error, tr);
      if (error instanceof ApiError && error.code === SENT_COPY_FAILED) {
        // The mail went out and only its copy in Sent is missing: sending it again would deliver it twice.
        await leave();
        saver?.finishSent();
        onSuccess();
        // The compose is gone; the warning has to outlive it.
        onNotice?.(message);
      } else if (flight.reopen !== null) {
        // The window is gone already: it opens again as it was, with what went wrong at its top (the server kept the draft).
        onReopen?.({ ...flight.reopen, sendError: message });
      } else {
        // The server keeps the draft when the send fails; autosave goes on.
        saver?.unlock();
        sendingRef.current = false;
        setStatus({ text: message, type: 'error' });
      }
    } finally {
      if (!flight.gone && sessionRef.current === session) {
        setIsSending(false);
      }
    }
  };

  // The ways out of the compose that keep a draft: wait (up to 2 s) for its last save, then close. With files attached it asks first: a
  // draft keeps no files (J4-12, J6-03). Then the app says the draft is kept, with a way to open it again (J4-11).
  const requestClose = async (confirmed = false) => {
    // Not while a send is under way: a failure after the compose is gone would go unseen.
    if (closingRef.current || isSending) {
      return;
    }
    if (!confirmed && files.length > 0) {
      setCloseAsk(true);
      return;
    }
    closingRef.current = true;
    const { empty, key } = readDraft();
    const kept = !empty && (savedOnceRef.current || key !== baselineRef.current);
    const saver = saverRef.current;
    const reopen = kept && saver !== null ? snapshotOf([], saver.id) : null;
    const saved = await Promise.race([saver?.close(), wait(2000)]);
    onClose();
    if (reopen !== null && saved === true) {
      onDraftKept?.({ ...reopen, title: tr('compose.title_draft') });
    }
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

  const noSignature = signatureBlock(signature) === '';
  // The problem of a field left empty, said under that field.
  const missingText: Record<MissingField, string> = {
    to: tr('compose.need_recipient'),
    subject: tr('compose.need_subject')
  };
  const toError = badField === 'to' ? tr('compose.invalid_address') : missing === 'to' ? missingText.to : undefined;

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

  /** An empty field's problem, on a line of its own under the field (an alert that describes it). */
  const fieldError = (field: 'subject') =>
    missing === field ? (
      <p id={`compose-${field}-error`} role="alert" className="cp-error">
        <CircleAlert size={14} strokeWidth={1.75} aria-hidden="true" />
        <span>{missingText[field]}</span>
      </p>
    ) : null;

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
        // The question dialog of a send (compose/useConfirm) and the discard question live inside this root: their keys are their own.
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
      <div ref={panelRef} className="cp-panel">
        <header className="cp-head">
          <h1 id="compose-title" className="cp-title">
            {titleOf(draft, tr)}
          </h1>
          {/* Always in the header (empty when idle) so a status change never moves anything; screen readers hear it through the app's live
              region (the effect above). With files: "Draft saved, attachments not included" (a draft keeps no files). */}
          <span className="cp-draft" data-state={draftStatus}>
            {draftStatus === 'saved' ? <Check size={14} strokeWidth={2} aria-hidden="true" /> : null}
            {draftStatusText(draftStatus, tr)}
          </span>
          {/* J5-25: Send of a phone on its side while the keyboard is up (the foot is hidden then; compose.css shows this one only then). */}
          <Button
            variant="primary"
            size="sm"
            className="cp-head-send"
            loading={isSending}
            leadingIcon={<Send data-send-icon="" size={16} strokeWidth={1.75} aria-hidden="true" />}
            onClick={() => {
              void handleSend();
            }}
          >
            {tr('action.send')}
          </Button>
          <IconButton
            label={tr('common.close')}
            className="cp-close"
            disabled={isSending}
            onClick={() => {
              void requestClose();
            }}
          >
            <X size={18} strokeWidth={1.75} aria-hidden="true" />
          </IconButton>
        </header>

        {status ? (
          <div className="cp-notice">
            <Banner tone={status.type === 'error' ? 'danger' : 'success'}>{status.text}</Banner>
          </div>
        ) : null}

        <div className="cp-main">
          <form
            className="cp-form"
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend();
            }}
          >
            {/* Scroll region: fields, toolbar, editor and attachments. The footer below stays pinned. */}
            <div className="cp-scroll">
              {/* J6-30: From is what the server sends with, the signed-in account's own address: read-only text, the name then the
                  address in the secondary colour (as in the reader's header), never a field that promises another sender (the server
                  refuses any other From). */}
              <div className="cp-row">
                <span id="compose-from-label" className="cp-label">
                  {tr('compose.from_label')}
                </span>
                <p className="cp-field cp-from">
                  <span className="cp-from-text">
                    {fromName.trim() === '' ? null : <span className="cp-from-name">{`${fromName.trim()} `}</span>}
                    <span className="cp-from-addr">{from}</span>
                  </span>
                </p>
              </div>

              <RecipientField
                id="compose-to"
                className="cp-row-to"
                label={tr('term.to')}
                list={toList}
                names={names}
                contacts={contacts}
                taken={taken}
                input={toInput}
                inputRef={toInputRef}
                placeholder={toList.length === 0 ? tr('compose.to_placeholder') : ''}
                onInput={setToInput}
                onCommit={() => commitRecipients(toInput, setToList, setToInput, 'to')}
                onPick={(address) => pickRecipient(address, setToList, setToInput)}
                onRemove={(address) => setToList((prev) => prev.filter((a) => a !== address))}
                trailing={ccBccToggle}
                error={toError}
              />

              {showCc ? (
                <RecipientField
                  id="compose-cc"
                  label={tr('term.cc')}
                  list={ccList}
                  names={names}
                  contacts={contacts}
                  taken={taken}
                  input={ccInput}
                  inputRef={ccInputRef}
                  onInput={setCcInput}
                  onCommit={() => commitRecipients(ccInput, setCcList, setCcInput, 'cc')}
                  onPick={(address) => pickRecipient(address, setCcList, setCcInput)}
                  onRemove={(address) => setCcList((prev) => prev.filter((a) => a !== address))}
                  error={badField === 'cc' ? tr('compose.invalid_address') : undefined}
                />
              ) : null}

              {showBcc ? (
                <RecipientField
                  id="compose-bcc"
                  label={tr('term.bcc')}
                  list={bccList}
                  names={names}
                  contacts={contacts}
                  taken={taken}
                  input={bccInput}
                  inputRef={bccInputRef}
                  onInput={setBccInput}
                  onCommit={() => commitRecipients(bccInput, setBccList, setBccInput, 'bcc')}
                  onPick={(address) => pickRecipient(address, setBccList, setBccInput)}
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
                    ref={subjectRef}
                    className="cp-input cp-subject"
                    type="text"
                    value={subject}
                    aria-invalid={missing === 'subject' ? true : undefined}
                    aria-describedby={missing === 'subject' ? 'compose-subject-error' : undefined}
                    onChange={(e) => setSubject(e.target.value)}
                    onKeyDown={enterToBody}
                  />
                  {fieldError('subject')}
                </div>
              </div>

              <FormatToolbar exec={exec} editorRef={editorRef} />

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
                onFocus={() => {
                  const root = dialogRef.current;
                  if (root !== null) {
                    window.requestAnimationFrame(() => bodyToTop(root));
                  }
                }}
                onInput={() => {
                  readBody();
                  setStatus((prev) => (prev?.type === 'error' ? null : prev));
                  saverRef.current?.touch();
                }}
              />

              {quoteFolded ? (
                <div className="cp-quote">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="cp-quote-btn"
                    leadingIcon={<Ellipsis size={16} strokeWidth={1.75} aria-hidden="true" />}
                    onClick={unfoldQuote}
                  >
                    {tr('compose.show_quoted')}
                  </Button>
                </div>
              ) : null}

              <AttachmentList t={t} files={files} onRemove={(id) => setFiles((prev) => prev.filter((file) => file.id !== id))} />
            </div>

            <div className="cp-foot">
              {/* Never disabled: a send with something missing says what, under that field. */}
              <Button
                type="submit"
                variant="primary"
                loading={isSending}
                leadingIcon={<Send data-send-icon="" size={16} strokeWidth={1.75} aria-hidden="true" />}
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
                <Divider orientation="vertical" className="cp-sep" />
                {/* Discard asks first (a ConfirmDialog, Cancel focused) when something would be lost; focus comes back here after Cancel. */}
                <IconButton
                  ref={discardRef}
                  className="cp-discard"
                  label={tr('action.discard_draft')}
                  onClick={() => {
                    // Asks first when something would be lost: typed text, attachments, or a draft that is saved on the server.
                    const { empty } = readDraft();
                    const worthKeeping = files.length > 0 || (!empty && (draft.draftId !== undefined || !isPristine()));
                    if (worthKeeping) {
                      setDiscardAsk(true);
                    } else {
                      void discardDraft();
                    }
                  }}
                >
                  <Trash2 size={18} strokeWidth={1.75} aria-hidden="true" />
                </IconButton>
              </div>
            </div>
          </form>
        </div>
      </div>
      {sendFlow.dialog}
      <ConfirmDialog
        isOpen={discardAsk}
        t={t}
        title={tr('compose.discard_title')}
        body={tr('compose.discard_body')}
        confirmLabel={tr('action.discard_draft')}
        onConfirm={() => {
          setDiscardAsk(false);
          void discardDraft();
        }}
        onCancel={() => setDiscardAsk(false)}
      />
      {/* Closing with files: the text is kept in Drafts, the files are not (J4-12, J6-03). Keep editing is the safe choice, focused first. */}
      <ConfirmDialog
        isOpen={closeAsk}
        t={t}
        title={tr('compose.close_files_title')}
        body={tr('compose.close_files_body')}
        detail={files.map((file) => file.filename).join(', ')}
        confirmLabel={tr('compose.close_files_confirm')}
        cancelLabel={tr('compose.keep_editing')}
        onConfirm={() => {
          setCloseAsk(false);
          void requestClose(true);
        }}
        onCancel={() => setCloseAsk(false)}
      />
    </div>
  );
};
