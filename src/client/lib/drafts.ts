import { apiDelete, apiGet, apiPut } from './api';

/** Body of `PUT /api/drafts/:id`. Attachments are not part of a draft. */
export interface DraftFields {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  text: string;
  html: string;
  in_reply_to?: string;
}

/** A draft as `GET /api/drafts/:id` returns it. */
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

export async function fetchDraft(id: string): Promise<StoredDraft> {
  await closing.get(id);
  const data = await apiGet<{ draft: StoredDraft }>(draftUrl(id), 'Could not open the draft');
  return data.draft;
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
 * A failed save is retried 5 s, 15 s and 45 s later, and at once when the browser comes back online.
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
        await apiDelete(draftUrl(this.id), 'Could not discard the draft');
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
    this.copy = this.copy === 'none' ? 'maybe' : this.copy;
    this.everOnServer = true;
    try {
      await apiPut(draftUrl(this.id), snapshot.fields, 'Could not save draft');
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

  private async removeCopy(): Promise<void> {
    if (this.copy === 'none') {
      this.failed = false;
      this.status('idle');
      return;
    }
    const confirmed = this.copy === 'yes';
    try {
      await apiDelete(draftUrl(this.id), 'Could not discard the draft');
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
