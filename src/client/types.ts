/**
 * What the browser could do with one message's encrypted content (see lib/mailcrypto): 'ready' = subject, snippet and bodies are
 * filled in; 'locked' = no key is unlocked yet; 'pending' = the server has not sealed it to the person's key yet; 'other_key' = it
 * was sealed to a key other than the one in use; 'failed' = it could not be opened.
 */
export type MailState = 'ready' | 'locked' | 'pending' | 'other_key' | 'failed';

export interface Message {
  id: string;
  message_id?: string | null;
  thread_id?: string | null;
  from_address: string;
  from_name?: string | null;
  to_address: string;
  cc?: string | null;
  bcc?: string | null;
  reply_to?: string | null;
  subject: string;
  snippet?: string | null;
  body_text?: string | null;
  body_html?: string | null;
  r2_key?: string | null;
  folder: 'inbox' | 'sent' | 'starred' | 'archive' | 'trash' | 'spam' | 'drafts' | 'snoozed';
  labels?: string | null;
  /** Header `References`: the Message-ID chain of the thread so far. */
  references_header?: string | null;
  /** Message-ID this mail answers. */
  in_reply_to?: string | null;
  /** Epoch ms a snoozed mail comes back; set only while folder is 'snoozed'. */
  snoozed_until?: number | null;
  is_read: number;
  is_starred: number;
  has_attachments: number;
  size: number;
  created_at: number;
  updated_at: number;
  /** 0 = a legacy plaintext row (subject, snippet and bodies are plain); 1 = encrypted (the server sends blobs, the browser fills the text in). */
  enc_fmt?: number;
  /** 1 only when the mail reached its recipients without any plaintext copy ever reaching the server (internal mail sealed in the sender's browser). */
  is_e2e?: number;
  /** Where the message came from (PX-12): 'smtp' = it arrived over email from outside, 'internal' = sent between people of this deployment. Absent on older rows. */
  origin?: 'smtp' | 'internal';
  /** True when the From address of the message belongs to a domain this deployment hosts: for an 'smtp' message that is a claim nobody verified. */
  from_hosted?: boolean | number;
  /**
   * The id of the sender's picture, served by this server: a person's own upload (mail between people of this deployment), or for an 'smtp'
   * message a picture the Worker looked up on Gravatar/Libravatar, only when an admin allowed it, and only after the sender was seen once
   * (the first view shows initials). The Worker decides; as unverified as the From address of outside mail. The client just shows it
   * (`senderPicture`, lib/avatar.ts).
   */
  from_avatar?: string | null;
  /** The spam filter's score, set only on mail the filter itself put in Spam (null: it did not, or the row is older than the filter). */
  spam_score?: number | null;
  /** The ids of the filter's rules that fired, a JSON array written as text (like `labels`); set only with `spam_score`. Read through lib/spamReasons.ts, never parsed in place: it may be malformed or name a rule this client does not know. */
  spam_reasons?: string | null;
  /** What the sender's domain proved about the message (the Worker's own text). The client does not use it. */
  auth?: string | null;
  /** Encrypted rows: the key the content key is sealed to, the sealed content key, and who sealed it ('server' = pending). Ciphertext only. */
  key_id?: string | null;
  wrapped_cek?: string | null;
  wrap_kind?: 'user' | 'server' | null;
  summary_blob?: string | null;
  /** Set by lib/mailcrypto on every message it returns; absent only on rows that never went through it. */
  mail_state?: MailState;
}

export interface Attachment {
  id: string;
  message_id: string;
  filename: string;
  mime_type: string;
  size: number;
  r2_key: string;
  content_id?: string | null;
  is_inline: number;
  created_at: number;
  /** Encrypted rows: filename, type and content id as one blob; lib/mailcrypto fills the three fields in from it. */
  meta_blob?: string | null;
  /** The name and type could not be opened (the file may still download). */
  meta_failed?: boolean;
}

export type FolderStats = Record<
  string,
  {
    total: number;
    unread: number;
  }
>;
