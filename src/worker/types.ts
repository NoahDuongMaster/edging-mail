import type { attachments, messages } from './db/schema';

export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  SEND_EMAIL?: SendEmail;
  ASSETS?: Fetcher;
  MAIL_HUB: DurableObjectNamespace;
  APP_NAME?: string;
  /** Sender address used until one is saved in Settings. */
  DEFAULT_FROM?: string;
  /** Single-user login password (secret). */
  APP_PASSWORD?: string;
  /** HMAC key for the session cookie (secret). */
  JWT_SECRET?: string;
  /** Web Push (VAPID): public key is a var, private key a secret. */
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
}

// Row types are derived from the Drizzle schema (src/worker/db/schema.ts).
type MessageRow = typeof messages.$inferSelect;

// `labels` is filled in by the DB default ('[]') and the threading/snooze columns are nullable, so records built in
// memory (send, inbound email) may leave them out.
type OptionalColumns = 'labels' | 'references_header' | 'in_reply_to' | 'snoozed_until';
export type Message = Omit<MessageRow, OptionalColumns> & Partial<Pick<MessageRow, OptionalColumns>>;

export type Attachment = typeof attachments.$inferSelect;

export interface SendEmailPayload {
  /** Defaults to the sender address from Settings (or the DEFAULT_FROM var). */
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
