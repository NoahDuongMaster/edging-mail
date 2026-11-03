export interface Env {
  DB: D1Database;
  BUCKET: R2Bucket;
  SEND_EMAIL?: {
    send: (message: any) => Promise<void>;
  };
  ASSETS: Fetcher;
  APP_NAME?: string;
  DEFAULT_DOMAIN?: string;
  JWT_SECRET?: string;
}

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
  folder: 'inbox' | 'sent' | 'starred' | 'archive' | 'trash' | 'spam';
  is_read: number;
  is_starred: number;
  has_attachments: number;
  size: number;
  created_at: number;
  updated_at: number;
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
}

export interface SendEmailPayload {
  from: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  reply_to?: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{
    filename: string;
    content_base64: string;
    content_type: string;
  }>;
}

export interface BatchActionPayload {
  message_ids: string[];
  action: 'read' | 'unread' | 'star' | 'unstar' | 'trash' | 'archive' | 'restore' | 'delete';
}
