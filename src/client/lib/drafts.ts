import { newCek, sealCek, sealField, toBase64Url, utf8 } from '../../shared/crypto/client';
import { ApiError, apiDelete, apiGet, apiPut } from './api';
import { getUnlockedKey } from './crypto/keyStore';
import type { UnlockedKey } from './crypto/keyStore';
import { fetchMyKeys } from './crypto/unlock';
import { tr } from './i18n';
import { nonEmpty } from './mail';
import { cekOf, keyEpoch } from './mailcrypto/cek';
import { readDraftBody, readSummary } from './mailcrypto/fields';
import type { OpenKey } from './mailcrypto/types';

// A draft is an ordinary encrypted mail row (EM1, crypto-design.md section 5): every autosave seals the subject and the text in the
// browser under a NEW content key, bound to the draft id, and the Worker stores only blobs. Recipients stay plaintext, like on every
// mail row. Nothing here writes, logs or keeps the text: it goes into a request body or comes back to the caller.

/** What the compose form holds. `sealDraft` turns it into the body of `PUT /api/drafts/:id`. Attachments are not part of a draft. */
export interface DraftFields {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  html: string;
  in_reply_to?: string;
  /**
   * The mail this draft answers or forwards was end-to-end encrypted (N6): reopened later, or on another device, the send still warns before the
   * quoted text goes to an outside address. It travels INSIDE the sealed body (`body_blob`), never as a column the server can read.
   */
  from_e2e?: boolean;
}

/** A draft as `fetchDraft` hands it to the compose: opened, plain text. */
export interface StoredDraft extends DraftFields {
  id: string;
}

export type DraftStatus = 'idle' | 'saving' | 'saved' | 'error';

/** What the compose form holds right now. */
export interface DraftSnapshot {
  fields: DraftFields;
  /** No recipient, no subject and no text beyond the signature: nothing worth keeping. */
  empty: boolean;
  /** Fingerprint of everything a draft keeps. */
  key: string;
  /** `key` of the form as it was opened (a fresh form, a reply's prefill, or the reopened draft). */
  baseline: string;
}

const AUTOSAVE_DELAY_MS = 1500;
// A failed save is retried after each of these delays (counted from the failure), then waits for an edit or the `online` event.
const RETRY_DELAYS_MS = [5000, 15_000, 45_000];

const draftUrl = (id: string) => `/api/drafts/${encodeURIComponent(id)}`;

/** `409 conflict` of a PUT: the content key was not sealed to the key the server holds for this person. */
const isKeyConflict = (error: unknown): boolean => error instanceof ApiError && error.status === 409 && error.code === 'conflict';

/** Whether the key the server holds for this person now is the one in memory. */
async function isCurrentKey(key: Pick<UnlockedKey, 'keyId'>): Promise<boolean> {
  const { keys } = await fetchMyKeys();
  return keys !== null && keys.key_id === key.keyId;
}

/** The server wants a UUID, and `crypto.randomUUID` only exists on https and localhost (not on a phone testing over http). */
export function newDraftId(): string {
  if ((crypto as Partial<Crypto>).randomUUID !== undefined) {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// A compose that was just closed is still saving in the background; reopening the same draft must read what that save wrote.
const closing = new Map<string, Promise<unknown>>();

/** What `sealDraft` needs of the unlocked key: `getUnlockedKey()` is one. */
export type DraftSealKey = Pick<UnlockedKey, 'publicKey' | 'keyId'>;

/** The body of `PUT /api/drafts/:id`: recipients in clear, everything else sealed. The Worker refuses any other key. */
export interface SealedDraftBody {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  in_reply_to?: string;
  summary_blob: string;
  body_blob: string;
  wrapped_cek: string;
  key_id: string;
}

/** `GET /api/drafts/:id` as the Worker answers it: sealed columns, or the plain ones of a draft saved before encryption. */
export interface DraftRow {
  id: string;
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  in_reply_to?: string;
  enc_fmt?: number;
  key_id?: string | null;
  wrapped_cek?: string | null;
  summary_blob?: string | null;
  body_blob?: string | null;
  /** Legacy plaintext draft only. */
  subject?: string;
  text?: string;
  html?: string;
}

const SNIPPET_CHARS = 140;

/** The list preview of a draft: the first 140 characters of the text, whitespace collapsed (the Worker does the same for mail it seals). */
export function draftSnippet(text: string): string {
  const cut = text.replaceAll(/\s+/g, ' ').trim().slice(0, SNIPPET_CHARS);
  // Never end on half of a surrogate pair (an emoji cut in two).
  const last = cut.codePointAt(cut.length - 1) ?? 0;
  return (last >= 0xd8_00 && last <= 0xdb_ff ? cut.slice(0, -1) : cut).trimEnd();
}

/**
 * Seals a draft for `PUT /api/drafts/:id`. A NEW content key every time (a draft is saved again and again), wrapped to the unlocked
 * key with the draft id as the row id; the subject goes into `summary_blob` with a short preview, the text and html into `body_blob`.
 * No part of the subject, text or html is in the result in clear.
 */
export async function sealDraft(fields: DraftFields, id: string, key: DraftSealKey): Promise<SealedDraftBody> {
  const cek = newCek();
  try {
    const wrapped = await sealCek(cek, id, key.publicKey);
    const summary = await sealField(
      cek,
      'summary',
      id,
      utf8(JSON.stringify({ subject: fields.subject, snippet: draftSnippet(fields.text) }))
    );
    const body = await sealField(
      cek,
      'body',
      id,
      utf8(JSON.stringify({ text: fields.text, html: fields.html, ...(fields.from_e2e === true ? { from_e2e: true } : {}) }))
    );
    return {
      from: fields.from,
      to: fields.to,
      cc: fields.cc,
      bcc: fields.bcc,
      ...(fields.in_reply_to === undefined ? {} : { in_reply_to: fields.in_reply_to }),
      summary_blob: toBase64Url(summary),
      body_blob: toBase64Url(body),
      wrapped_cek: toBase64Url(wrapped),
      key_id: key.keyId
    };
  } finally {
    // The content key is not needed once the blobs exist.
    cek.fill(0);
  }
}

export type DraftOpenReason = 'locked' | 'other_key' | 'damaged';

/** A saved draft that cannot be opened. `message` is catalogue text in the UI language of the moment it was thrown: show it as it is. */
export class DraftOpenError extends Error {
  readonly reason: DraftOpenReason;

  constructor(reason: DraftOpenReason) {
    super(openFailureText(reason));
    this.name = 'DraftOpenError';
    this.reason = reason;
  }
}

function openFailureText(reason: DraftOpenReason): string {
  switch (reason) {
    case 'locked': {
      return tr('drafts.locked');
    }
    case 'other_key': {
      return tr('drafts.other_key');
    }
    case 'damaged': {
      return tr('fail.drafts_open');
    }
  }
}

const textList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

/**
 * Opens a draft row with the unlocked key. `id` is the id the draft was asked for: it is the row id of the seal, so a row of another
 * draft cannot be passed off as this one. A row with no `wrapped_cek` is a plaintext draft from before encryption and opens as it is.
 * Throws a `DraftOpenError` when the key is locked, is not the key the draft was sealed to, or the blobs do not open.
 */
export async function openDraft(id: string, row: DraftRow, key: OpenKey | null): Promise<StoredDraft> {
  const recipients = { from: row.from, to: textList(row.to), cc: textList(row.cc), bcc: textList(row.bcc) };
  const inReplyTo = typeof row.in_reply_to === 'string' ? { in_reply_to: row.in_reply_to } : {};
  const wrapped = nonEmpty(row.wrapped_cek);
  if (wrapped === undefined) {
    if (row.enc_fmt === 1) {
      throw new DraftOpenError('damaged');
    }
    return { id: row.id, ...recipients, ...inReplyTo, subject: row.subject ?? '', text: row.text ?? '', html: row.html ?? '' };
  }
  if (key === null) {
    throw new DraftOpenError('locked');
  }
  if (nonEmpty(row.key_id) !== key.keyId) {
    throw new DraftOpenError('other_key');
  }
  const started = keyEpoch();
  let opened: { subject: string; text: string; html: string; from_e2e: boolean };
  try {
    const cek = await cekOf({ id, enc_fmt: 1, key_id: row.key_id, wrap_kind: 'user', wrapped_cek: wrapped }, key);
    const [summary, body] = await Promise.all([readSummary(cek, id, row.summary_blob), readDraftBody(cek, id, row.body_blob)]);
    opened = { subject: summary.subject, text: body.text, html: body.html, from_e2e: body.from_e2e };
  } catch {
    throw new DraftOpenError('damaged');
  }
  // The keys were wiped while this worked: what was opened is not handed on.
  if (started !== keyEpoch()) {
    throw new DraftOpenError('locked');
  }
  const { from_e2e: fromE2e, ...content } = opened;
  return { id, ...recipients, ...inReplyTo, ...content, ...(fromE2e ? { from_e2e: true } : {}) };
}

export async function fetchDraft(id: string): Promise<StoredDraft> {
  await closing.get(id);
  const data = await apiGet<{ draft: DraftRow }>(draftUrl(id), 'fail.drafts_open');
  // Awaited, not returned: openDraft rejects at once for a locked key, and an already rejected promise handed back unawaited is reported as an
  // unhandled rejection (by workerd, where `npm test` runs this) for the tick before the caller's handler is attached.
  const opened = await openDraft(id, data.draft, getUnlockedKey());
  return opened;
}

const UNSAFE_ELEMENTS = 'script, style, iframe, object, embed, link, meta, base, form, svg, math';

/**
 * A stored draft goes back into the editor as HTML. Parsing it in an inert document and dropping scripts, event handlers and
 * script URLs first means nothing in it can run, whatever the server holds.
 */
export function sanitizeDraftHtml(html: string): string {
  const body = new DOMParser().parseFromString(html, 'text/html').body;
  for (const element of body.querySelectorAll(UNSAFE_ELEMENTS)) {
    element.remove();
  }
  for (const element of body.querySelectorAll('*')) {
    for (const name of element.getAttributeNames()) {
      if (name.startsWith('on') || /^\s*(?:javascript|vbscript):/i.test(element.getAttribute(name) ?? '')) {
        element.removeAttribute(name);
      }
    }
  }
  return body.innerHTML;
}

interface DraftSaverOptions {
  id: string;
  /** The server already holds this draft (it was reopened from the Drafts folder). */
  onServer: boolean;
  read: () => DraftSnapshot;
  onStatus: (status: DraftStatus) => void;
  /** The session is over and a copy of the draft was on the server at some point, so mail lists and counters may have changed. */
  onEnded: () => void;
  /** The compose closed with changes that could not be saved. */
  onLost: () => void;
}

/**
 * Keeps one compose session's draft on the server: autosave 1.5 s after the last change, never two requests at once.
 * A failed save is retried 5 s, 15 s and 45 s later, and at once when the browser comes back online. Every save is sealed in the browser
 * (`sealDraft`, with the key unlocked at that moment): with no unlocked key nothing is sent and the save fails like any other.
 *
 * phase: `open` -> `locked` (a send is under way: no new requests) -> `open` again if the send fails, or
 *        `open`/`locked` -> `ended` (closed, discarded or sent: nothing is ever sent again).
 * Every request goes through `run`, one loop that reads the latest form content each turn, so requests cannot overlap and
 * the last one always carries the final text. `discard` and `lockForSend` wait for the request in flight, so a late PUT can
 * neither undo a DELETE nor bring back a draft the server deleted after sending.
 */
export class DraftSaver {
  readonly id: string;
  private readonly options: DraftSaverOptions;
  private phase: 'open' | 'locked' | 'ended' = 'open';
  // `maybe`: a PUT was sent but its answer never came, so the server may or may not hold the draft.
  private copy: 'none' | 'maybe' | 'yes';
  private everOnServer: boolean;
  private savedKey: string | null = null;
  private dirty = false;
  private failed = false;
  private looping = false;
  private inflight: Promise<void> = Promise.resolve();
  private timer: number | undefined;
  private retryTimer: number | undefined;
  // Retries already used since the last edit (or `online` event).
  private retries = 0;
  // close() was called: its final flush is the last attempt.
  private closing = false;
  private closed: Promise<boolean> | null = null;

  // The browser is back online: if the last save failed, try again at once with a fresh set of retries.
  private readonly onOnline = (): void => {
    if (this.phase === 'open' && !this.closing && this.failed && !this.looping) {
      this.retries = 0;
      void this.pump();
    }
  };

  constructor(options: DraftSaverOptions) {
    this.options = options;
    this.id = options.id;
    this.copy = options.onServer ? 'yes' : 'none';
    this.everOnServer = options.onServer;
    window.addEventListener('online', this.onOnline);
  }

  /** The form changed: save 1.5 s from now unless it changes again. */
  touch(): void {
    if (this.phase !== 'open') {
      return;
    }
    this.dirty = true;
    // A new edit starts over: no retry of the old failure, a full set of retries for the new one.
    this.retries = 0;
    window.clearTimeout(this.retryTimer);
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      void this.pump();
    }, AUTOSAVE_DELAY_MS);
  }

  /** Saves a pending change right away (the page is being hidden). */
  saveNow(): void {
    window.clearTimeout(this.timer);
    if (this.phase === 'open' && this.dirty) {
      void this.pump();
    }
  }

  /** Saves the last changes, then ends the session. Resolves false when they could not be saved. Safe to call again. */
  close(): Promise<boolean> {
    if (this.closed === null) {
      const closed = this.closeNow();
      this.closed = closed;
      closing.set(this.id, closed);
      const forget = () => {
        if (closing.get(this.id) === closed) {
          closing.delete(this.id);
        }
      };
      void closed.then(forget, forget);
    }
    return this.closed;
  }

  /** Ends the session and deletes the draft from the server, if it ever got there. Resolves false when that failed. */
  async discard(): Promise<boolean> {
    this.end();
    this.dirty = false;
    // The request in flight must land before the DELETE, otherwise it would bring the draft back.
    await this.inflight;
    let ok = true;
    if (this.copy !== 'none') {
      const confirmed = this.copy === 'yes';
      try {
        await apiDelete(draftUrl(this.id), 'fail.drafts_discard');
      } catch (error) {
        console.error('Could not delete the draft', error);
        ok = !confirmed;
      }
      this.copy = 'none';
    }
    this.failed = false;
    this.ended();
    return ok;
  }

  /** A send is starting: no new request leaves, and the one in flight is awaited. */
  async lockForSend(): Promise<void> {
    window.clearTimeout(this.timer);
    window.clearTimeout(this.retryTimer);
    if (this.phase === 'open') {
      this.phase = 'locked';
    }
    await this.inflight;
  }

  /** The send failed: autosave goes on, and anything typed meanwhile is saved. */
  unlock(): void {
    if (this.phase === 'locked') {
      this.phase = 'open';
      this.touch();
    }
  }

  /** The mail was sent; the server deleted the draft with it. */
  finishSent(): void {
    this.end();
    this.copy = 'none';
    this.failed = false;
    this.ended();
  }

  /** Nothing is ever sent again, and nothing stays scheduled. */
  private end(): void {
    this.phase = 'ended';
    this.stopRetrying();
    window.clearTimeout(this.timer);
  }

  private stopRetrying(): void {
    window.clearTimeout(this.retryTimer);
    window.removeEventListener('online', this.onOnline);
  }

  private scheduleRetry(): void {
    if (this.phase !== 'open' || this.closing || this.retries >= RETRY_DELAYS_MS.length) {
      return;
    }
    this.retryTimer = window.setTimeout(() => {
      void this.pump();
    }, RETRY_DELAYS_MS[this.retries]);
    this.retries += 1;
  }

  private pump(): Promise<void> {
    // Any request replaces a pending retry; if it fails, the loop schedules the next one.
    window.clearTimeout(this.retryTimer);
    if (!this.looping) {
      this.inflight = this.run();
    }
    return this.inflight;
  }

  private async run(): Promise<void> {
    this.looping = true;
    try {
      while (this.dirty && this.phase === 'open') {
        this.dirty = false;
        await this.syncOnce();
        if (this.failed) {
          // Not retried in a loop: a retry timer, the next change or the close tries again.
          this.dirty = true;
          this.scheduleRetry();
          break;
        }
      }
    } finally {
      this.looping = false;
    }
  }

  private async syncOnce(): Promise<void> {
    const snapshot = this.options.read();
    if (snapshot.empty) {
      // Emptied: the draft goes away.
      await this.removeCopy();
      return;
    }
    if (snapshot.key === (this.savedKey ?? snapshot.baseline)) {
      // Still what the form was opened with, or what the server already has.
      return;
    }
    this.status('saving');
    try {
      await this.upload(snapshot.fields);
      this.copy = 'yes';
      this.savedKey = snapshot.key;
      this.failed = false;
      this.status('saved');
    } catch (error) {
      console.error('Could not save the draft', error);
      this.failed = true;
      this.status('error');
    }
  }

  /**
   * One save: the draft sealed to the key unlocked right now, then PUT. Throws when nothing was saved. With no unlocked key nothing is
   * sealed or sent, so the save fails like any other and the next retry or edit (after the person unlocks) saves it.
   */
  private async upload(fields: DraftFields): Promise<void> {
    const key = getUnlockedKey();
    if (key === null) {
      throw new Error('the draft was not saved: no unlocked key');
    }
    const body = await sealDraft(fields, this.id, key);
    // From here on the server may hold a copy.
    this.copy = this.copy === 'none' ? 'maybe' : this.copy;
    this.everOnServer = true;
    try {
      await apiPut(draftUrl(this.id), body, 'fail.drafts_save');
    } catch (error) {
      // 409: the draft was sealed to a key that is not the person's current one. Only if the server's key is still the one in
      // memory is that a race (the key was current when it was sealed): seal again, once. Otherwise this browser holds a stale key
      // (changed elsewhere, or after a recovery) and the person has to unlock again.
      if (!isKeyConflict(error) || !(await isCurrentKey(key))) {
        throw error;
      }
      await apiPut(draftUrl(this.id), await sealDraft(fields, this.id, key), 'fail.drafts_save');
    }
  }

  private async removeCopy(): Promise<void> {
    if (this.copy === 'none') {
      this.failed = false;
      this.status('idle');
      return;
    }
    const confirmed = this.copy === 'yes';
    try {
      await apiDelete(draftUrl(this.id), 'fail.drafts_discard');
      this.copy = 'none';
      this.savedKey = null;
      this.failed = false;
      this.status('idle');
    } catch (error) {
      console.error('Could not delete the draft', error);
      // Without a confirmed copy the failed PUT most likely never arrived either, so there is nothing to report.
      this.copy = confirmed ? this.copy : 'none';
      this.failed = confirmed;
      this.status(confirmed ? 'error' : 'idle');
    }
  }

  private async closeNow(): Promise<boolean> {
    this.closing = true;
    // The final flush below is the last attempt: no retries, no `online` listener.
    this.stopRetrying();
    window.clearTimeout(this.timer);
    if (this.phase !== 'open') {
      await this.inflight;
      return true;
    }
    if (this.dirty) {
      await this.pump();
    }
    await this.inflight;
    const ok = !this.failed;
    this.end();
    this.ended();
    if (!ok) {
      this.options.onLost();
    }
    return ok;
  }

  private ended(): void {
    if (this.everOnServer) {
      this.options.onEnded();
    }
  }

  private status(status: DraftStatus): void {
    if (this.phase !== 'ended') {
      this.options.onStatus(status);
    }
  }
}
