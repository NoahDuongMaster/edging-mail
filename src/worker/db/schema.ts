import { sql } from 'drizzle-orm';
import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

// Property names intentionally match the snake_case column names, and integer
// columns have no boolean/timestamp mode, so rows serialise to the same JSON
// the API has always returned.

export type Folder = 'inbox' | 'sent' | 'starred' | 'archive' | 'trash' | 'spam' | 'drafts' | 'snoozed';

export const messages = sqliteTable(
  'messages',
  {
    id: text('id').primaryKey(),
    message_id: text('message_id'),
    thread_id: text('thread_id'),
    from_address: text('from_address').notNull(),
    from_name: text('from_name'),
    to_address: text('to_address').notNull(),
    cc: text('cc'),
    bcc: text('bcc'),
    reply_to: text('reply_to'),
    subject: text('subject'),
    snippet: text('snippet'),
    body_text: text('body_text'),
    body_html: text('body_html'),
    r2_key: text('r2_key'),
    folder: text('folder').$type<Folder>().notNull().default('inbox'),
    labels: text('labels').notNull().default('[]'),
    is_read: integer('is_read').notNull().default(0),
    is_starred: integer('is_starred').notNull().default(0),
    has_attachments: integer('has_attachments').notNull().default(0),
    size: integer('size').notNull().default(0),
    created_at: integer('created_at').notNull(),
    updated_at: integer('updated_at').notNull(),
    // Message-ID chain of the mail (header `References`), kept so replies can extend it.
    references_header: text('references_header'),
    // Message-ID this mail answers; used to rebuild a reply when a draft is reopened.
    in_reply_to: text('in_reply_to'),
    // Epoch ms at which a snoozed mail returns to the inbox (null unless folder is 'snoozed').
    snoozed_until: integer('snoozed_until')
  },
  (t) => [
    index('idx_messages_folder_created_at').on(t.folder, sql`${t.created_at} desc`),
    index('idx_messages_thread_id').on(t.thread_id),
    index('idx_messages_is_read').on(t.is_read),
    index('idx_messages_is_starred').on(t.is_starred),
    index('idx_messages_from_address').on(t.from_address),
    index('idx_messages_to_address').on(t.to_address),
    index('idx_messages_snoozed_until').on(t.snoozed_until)
  ]
);

export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    message_id: text('message_id')
      .notNull()
      .references(() => messages.id, { onDelete: 'cascade' }),
    filename: text('filename').notNull(),
    mime_type: text('mime_type').notNull(),
    size: integer('size').notNull(),
    r2_key: text('r2_key').notNull(),
    content_id: text('content_id'),
    is_inline: integer('is_inline').notNull().default(0),
    created_at: integer('created_at').notNull()
  },
  (t) => [index('idx_attachments_message_id').on(t.message_id)]
);

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updated_at: integer('updated_at').notNull()
});

// One row per browser/device subscribed to Web Push (see src/worker/push.ts).
export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  user_agent: text('user_agent'),
  created_at: integer('created_at').notNull(),
  last_success_at: integer('last_success_at')
});

// Failed-login throttle (see src/worker/auth.ts): one row per client (CF-Connecting-IP, IPv6 as /64) plus one 'global' row.
export const loginAttempts = sqliteTable('login_attempts', {
  key: text('key').primaryKey(),
  failures: integer('failures').notNull(),
  window_start: integer('window_start').notNull(),
  locked_until: integer('locked_until').notNull().default(0),
  updated_at: integer('updated_at').notNull()
});
