import type { Locale } from '../shared/i18n/languages';
import type { attachments, messages, Role } from './db/schema';

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  SEND_EMAIL?: SendEmail;
  ASSETS?: Fetcher;
  MAIL_HUB: DurableObjectNamespace;
  APP_NAME?: string;
  /** Prefills the admin address on the first-run Setup screen and is the contact in Web Push (VAPID) requests. Not a sender: everyone sends from their own address. */
  DEFAULT_FROM?: string;
  /** Setup key (secret): needed only for the first-run Setup and the break-glass recovery of an admin. Nobody signs in with it. */
  APP_PASSWORD?: string;
  /** Signs the session cookie and the two-step-verification challenge (secret, at least 32 characters). */
  JWT_SECRET?: string;
  /**
   * Protects what the server must read back: pending mail, two-step-verification secrets, recovery-code MACs, audit MACs and the Web Push
   * key (secret): base64 of exactly 32 random bytes. Missing or malformed, sign-in and Setup answer 503 and nothing is stored in plaintext.
   */
  DATA_KEY?: string;
  /** The previous DATA_KEY while it is being rotated (secret, read-only): values sealed under it stay readable while it is set (nothing re-seals them). */
  DATA_KEY_PREVIOUS?: string;
  /** Rows the encryption job converts per cron run (default 25, 1..500). A tuning knob; tests use 1 to interrupt it mid-run. */
  ENCRYPT_CHUNK_ROWS?: string;
  /** "on" (after trim and lower-casing) serves the public landing pages at /, /en/ and /zh/; anything else, or unset, keeps them off. */
  LANDING_PAGE?: string;
  /**
   * "on" (after trim and lower-casing) says this deployment is local (`wrangler dev`, the tests): a Web Push endpoint on loopback, over http and on any port, is
   * then accepted for a fake push service. Unset or anything else: only https on port 443 to the browsers' push services.
   */
  ALLOW_LOCAL_PUSH?: string;
}

/** The signed-in account the auth middleware puts on the Hono context (`c.get('user')`). */
export interface SessionUser {
  id: string;
  /** Primary address: the sign-in name and the only From address. */
  email: string;
  display_name: string;
  role: Role;
  must_change_password: boolean;
  /** Has a key pair (the key setup is done) and does not have to set it up again. */
  has_keys: boolean;
  totp_enabled: boolean;
  /** Organisation policy: every member needs two-step verification (admins always do). */
  require_2fa: boolean;
  /** Epoch ms at which an admin-requested reset of THIS admin's two-step verification takes effect (null = none pending): the cancel banner. */
  two_factor_reset_due_at: number | null;
  /** The person's saved language (null = the organisation default). */
  language: Locale | null;
  /** Promoted to admin and not yet through the admin-length password change: no console until then. */
  admin_password_upgrade_required: boolean;
  /** Epoch ms of the last second-factor check of THIS session (0 = none). Step-up actions need it within five minutes. */
  step_up_at: number;
}

/** Hono generics shared by every route module. `user` is null only on the few routes that work signed out. */
export interface AppEnv {
  Bindings: Env;
  Variables: { user: SessionUser | null };
}

// Row types are derived from the Drizzle schema (src/worker/db/schema.ts).
type MessageRow = typeof messages.$inferSelect;

// `labels` is filled in by the DB default ('[]') and the threading/snooze columns are nullable, so records built in
// memory (send, inbound email) may leave them out.
type OptionalColumns =
  | 'labels'
  | 'references_header'
  | 'in_reply_to'
  | 'snoozed_until'
  | 'enc_fmt'
  | 'key_id'
  | 'wrapped_cek'
  | 'wrap_kind'
  | 'summary_blob'
  | 'body_blob'
  | 'is_e2e'
  | 'origin';
export type Message = Omit<MessageRow, OptionalColumns> & Partial<Pick<MessageRow, OptionalColumns>>;

export type Attachment = Omit<typeof attachments.$inferSelect, 'meta_blob'> & Partial<Pick<typeof attachments.$inferSelect, 'meta_blob'>>;

export interface SendEmailPayload {
  /** Optional and informational: the Worker always sends from the signed-in user's primary address (a different value is refused with 403). */
  from?: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  reply_to?: string;
  /** Message-ID (with angle brackets) of the mail being answered. */
  in_reply_to?: string;
  references?: string[];
  /** Id of the draft this mail was written in: deleted once the mail is sent. */
  draft_id?: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: {
    filename: string;
    content_base64: string;
    content_type: string;
  }[];
}

export interface BatchActionPayload {
  message_ids?: string[];
  action: 'read' | 'unread' | 'star' | 'unstar' | 'trash' | 'archive' | 'restore' | 'move' | 'snooze' | 'delete';
  folder?: 'inbox' | 'sent' | 'drafts' | 'snoozed' | 'archive' | 'spam' | 'trash';
  /** Snooze only: when the mail returns to the inbox (epoch ms). */
  until?: number;
}
