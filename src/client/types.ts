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

export interface FolderStats {
  [folder: string]: {
    total: number;
    unread: number;
  };
}
