import { sql } from 'drizzle-orm';
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';
import type { Locale } from '../../shared/i18n/languages';

// Property names intentionally match the snake_case column names, and integer
// columns have no boolean/timestamp mode, so rows serialise to the same JSON
// the API has always returned.

export type Folder = 'inbox' | 'sent' | 'starred' | 'archive' | 'trash' | 'spam' | 'drafts' | 'snoozed';
export type Role = 'admin' | 'member';
export type UserStatus = 'active' | 'disabled';
export type AddressKind = 'primary' | 'alias';
// How a mail came to be in a mailbox (PX-12), set by the Worker and never by a sender.
export type MessageOrigin = 'smtp' | 'internal';

// One mailbox owner. `email` is the primary address (sign-in name and From) and mirrors the `addresses` row of kind 'primary'.
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull().unique(),
    display_name: text('display_name').notNull().default(''),
    signature: text('signature').notNull().default(''),
    // PBKDF2-SHA256 of `auth`, the opaque 32-byte credential the browser derives from the password (the server never sees the password):
    // base64url verifier and salt, the iteration count it was made with (so the count can be raised later) and the browser KDF version.
    auth_verifier: text('auth_verifier').notNull(),
    auth_salt: text('auth_salt').notNull(),
    auth_iterations: integer('auth_iterations').notNull(),
    kdf_version: integer('kdf_version').notNull().default(1),
    role: text('role').$type<Role>().notNull().default('member'),
    status: text('status').$type<UserStatus>().notNull().default('active'),
    // 1 after an admin created the account: only "choose a new password" works until it is changed (then the key setup follows).
    must_change_password: integer('must_change_password').notNull().default(0),
    // Epoch ms: the temporary password of a NEW account (72 hours, set when the admin creates it) stops working at this time; null when there is none.
    temp_password_expires_at: integer('temp_password_expires_at'),
    // Epoch ms: a session cookie issued at or before this time is revoked (sign out, password change, disable, role change).
    sessions_valid_after: integer('sessions_valid_after').notNull().default(0),
    last_login_at: integer('last_login_at'),
    created_at: integer('created_at').notNull(),
    updated_at: integer('updated_at').notNull(),
    // The user's key pair (crypto-design.md section 4). The server holds the PUBLIC key (SPKI, base64url), its id (first 16 bytes of
    // SHA-256 of the SPKI, base64url) and the private key only WRAPPED (AES-GCM, by a key the browser derives from the password and, for
    // the recovery copy, from the recovery key): it can never open either wrap. NULL until the key setup, then the key, the recovery wrap and
    // the recovery verifier are set together (users_key_set_check).
    public_key: text('public_key'),
    key_id: text('key_id'),
    wrapped_private_key_pw: text('wrapped_private_key_pw'),
    wrapped_private_key_recovery: text('wrapped_private_key_recovery'),
    // Compare-and-set counter of EVERY operation that rewrites a wrapped key or the recovery verifier (key setup, password change, new
    // recovery key, forgot-password, break-glass): a stale forgot ticket dies by itself. Also the hook for key rotation in a later version.
    keys_version: integer('keys_version').notNull().default(0),
    // Two-step verification (TOTP). The secret is sealed under DATA_KEY: the server must read it back to verify a code.
    totp_secret_enc: text('totp_secret_enc'),
    totp_enabled: integer('totp_enabled').notNull().default(0),
    // The last accepted 30-second step: a code is accepted only for a later step, so a code works once.
    totp_last_step: integer('totp_last_step').notNull().default(0),
    totp_enrolled_at: integer('totp_enrolled_at'),
    // 1 after a member was made an admin: no console until a password of the admin length is set. The browser enforces the length and
    // asserts it (`admin_strength: true`): the server cannot see a password, so this is a gate of the interface, not a cryptographic check.
    admin_password_upgrade_required: integer('admin_password_upgrade_required').notNull().default(0),
    // The check of the recovery key (crypto-design.md 15.2): the SAME verifier function as `auth`, over the raw 32 bytes of `rauth`, with its
    // own salt and count. NULL exactly when there are no keys.
    recovery_verifier: text('recovery_verifier'),
    recovery_salt: text('recovery_salt'),
    recovery_iterations: integer('recovery_iterations'),
    recovery_set_at: integer('recovery_set_at'),
    // The person's language for push texts and the app: NULL (use the organisation default) or a tag of src/shared/i18n/languages.ts. No CHECK on it:
    // the routes validate against that list, so adding a language needs no migration.
    language: text('language').$type<Locale>(),
    // A reset of an ADMIN's two-step verification takes effect at this time unless the admin cancels it by signing in (null = none pending).
    reset_2fa_due_at: integer('reset_2fa_due_at'),
    reset_2fa_by: text('reset_2fa_by')
  },
  (t) => [
    uniqueIndex('idx_users_key_id').on(t.key_id),
    check('users_role_check', sql`${t.role} IN ('admin', 'member')`),
    check('users_status_check', sql`${t.status} IN ('active', 'disabled')`),
    // The whole key set exists together or not at all (PB-7): the public key and its id, both wraps, and the recovery verifier with its salt and
    // iteration count. A person cannot hold keys that the forgot flow cannot reach, nor a public key with no password wrap (no way in).
    check(
      'users_key_set_check',
      sql`(${t.public_key} IS NULL) = (${t.key_id} IS NULL) AND (${t.public_key} IS NULL) = (${t.wrapped_private_key_pw} IS NULL) AND (${t.public_key} IS NULL) = (${t.wrapped_private_key_recovery} IS NULL) AND (${t.public_key} IS NULL) = (${t.recovery_verifier} IS NULL) AND (${t.public_key} IS NULL) = (${t.recovery_salt} IS NULL) AND (${t.public_key} IS NULL) = (${t.recovery_iterations} IS NULL)`
    )
  ]
);

// Keys a user no longer uses (after a break-glass): their mail stays encrypted to them, and only the recovery-key wrap (kept, never the
// password wrap) can still open it. `delete_after` is set when the person asked to delete that locked mail: it is executed by the cron once
// the time has passed (seven days after `delete_requested_at`), and until then the request can be cancelled.
export const userKeys = sqliteTable('user_keys', {
  key_id: text('key_id').primaryKey(),
  user_id: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  public_key: text('public_key').notNull(),
  wrapped_private_key_recovery: text('wrapped_private_key_recovery'),
  retired_at: integer('retired_at').notNull(),
  delete_requested_at: integer('delete_requested_at'),
  delete_after: integer('delete_after')
});

// The ten single-use recovery codes of two-step verification: only an HMAC under DATA_KEY is stored, never the code.
export const recoveryCodes = sqliteTable(
  'recovery_codes',
  {
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    code_hmac: text('code_hmac').notNull(),
    used_at: integer('used_at')
  },
  (t) => [primaryKey({ columns: [t.user_id, t.code_hmac] })]
);

// A password step that needs a second factor hands out a signed challenge; its `jti` lives here so it can be used once, expire, and be
// burned after five wrong codes.
export const twoFactorChallenges = sqliteTable(
  'two_factor_challenges',
  {
    jti: text('jti').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    attempts: integer('attempts').notNull().default(0),
    expires_at: integer('expires_at').notNull(),
    created_at: integer('created_at').notNull()
  },
  (t) => [index('idx_two_factor_challenges_expires').on(t.expires_at)]
);

// A forgot-password ticket (crypto-design.md 15.3): handed out by `forgot/verify`, used once by `forgot/complete`. Only an HMAC of the ticket
// is stored (under DATA_KEY), so a copy of the database cannot complete a recovery. It is bound to the key state it was issued for.
export const recoveryTickets = sqliteTable(
  'recovery_tickets',
  {
    ticket_hmac: text('ticket_hmac').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    key_id: text('key_id').notNull(),
    keys_version: integer('keys_version').notNull(),
    exp: integer('exp').notNull(),
    used_at: integer('used_at'),
    created_at: integer('created_at').notNull(),
    ip: text('ip')
  },
  (t) => [
    // At most one open ticket per user: a new successful verify replaces the older one.
    uniqueIndex('idx_recovery_tickets_open')
      .on(t.user_id)
      .where(sql`${t.used_at} IS NULL`)
  ]
);

// Notices a person (or, for the alert kinds, an admin) is shown in the app and cannot dismiss before `dismissible_after` (seven days):
// 'recovery_started', 'password_recovered', 'recovery_key_replaced', 'locked_delete_requested', 'second_factor_locked', '2fa_reset', '2fa_reset_pending', 'break_glass',
// 'first_sign_in', and the
// admin alerts 'alert_2fa_reset', 'alert_role_change', 'alert_account_delete', 'alert_break_glass', 'alert_require_2fa_relaxed'. `detail` is
// small JSON of codes and ids, never prose.
export const userSecurityEvents = sqliteTable(
  'user_security_events',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    at: integer('at').notNull(),
    actor_email: text('actor_email'),
    detail: text('detail').notNull().default('{}'),
    dismissible_after: integer('dismissible_after').notNull().default(0),
    dismissed_at: integer('dismissed_at')
  },
  (t) => [index('idx_user_security_events_user_at').on(t.user_id, sql`${t.at} desc`)]
);

// A user's own sign-in history (Settings > Account) and account-security notices. Only known accounts are recorded (failures for
// unknown addresses would grow without bound and reveal nothing useful); pruned by the cron (latest 50 per user, 90 days).
export const userSignIns = sqliteTable(
  'user_sign_ins',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    at: integer('at').notNull(),
    ip: text('ip'),
    user_agent: text('user_agent'),
    ok: integer('ok').notNull(),
    // 'sign_in', or a note of a security action in the person's history: 'recovery_started', 'password_recovered', 'break_glass'.
    kind: text('kind').notNull().default('sign_in')
  },
  (t) => [index('idx_user_sign_ins_user_at').on(t.user_id, sql`${t.at} desc`)]
);

// Every address that receives mail, lower-case: one namespace for primary addresses and aliases, so the database itself
// refuses an address used twice, and inbound routing is a single lookup by primary key.
export const addresses = sqliteTable(
  'addresses',
  {
    address: text('address').primaryKey(),
    user_id: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<AddressKind>().notNull()
  },
  (t) => [
    index('idx_addresses_user_id').on(t.user_id),
    // A user has exactly one primary address.
    uniqueIndex('idx_addresses_one_primary')
      .on(t.user_id)
      .where(sql`${t.kind} = 'primary'`),
    check('addresses_kind_check', sql`${t.kind} IN ('primary', 'alias')`)
  ]
);

// The mail domains this installation serves (Email Routing catch-all -> this Worker), lower-case host names.
export const domains = sqliteTable('domains', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  created_at: integer('created_at').notNull()
});

// Admin and account events. No foreign key on the actor: an entry outlives the account that made it. `detail` is small JSON, never a secret.
export const auditLog = sqliteTable(
  'audit_log',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    at: integer('at').notNull(),
    actor_user_id: text('actor_user_id'),
    actor_email: text('actor_email').notNull(),
    action: text('action').notNull(),
    target: text('target').notNull().default(''),
    detail: text('detail').notNull().default('{}')
  },
  (t) => [index('idx_audit_log_at').on(sql`${t.at} desc`, sql`${t.id} desc`)]
);

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
    snoozed_until: integer('snoozed_until'),
    // The mailbox owner. NULL only for mail that arrived before the first-run setup: setup hands those rows to the admin.
    user_id: text('user_id').references(() => users.id, { onDelete: 'cascade' }),
    // 0 = legacy plaintext row, 1 = EM1: subject/snippet/body_text/body_html are NULL and the content lives in the blobs below
    // (base64url AES-GCM blobs under a per-row key, which `wrapped_cek` holds sealed to the owner's public key).
    enc_fmt: integer('enc_fmt').notNull().default(0),
    key_id: text('key_id'),
    wrapped_cek: text('wrapped_cek'),
    // 'user' = sealed to the owner's key (zero-access); 'server' = pending mail for an owner without keys yet, sealed under DATA_KEY.
    wrap_kind: text('wrap_kind').$type<'user' | 'server'>(),
    summary_blob: text('summary_blob'),
    body_blob: text('body_blob'),
    // 1 only when no plaintext of this mail reached the server (internal mail written in the sender's browser).
    is_e2e: integer('is_e2e').notNull().default(0),
    // 'smtp' = arrived by email: its From address is only what the sender wrote (nothing here checks it). 'internal' = written in a member's browser and
    // sent through this deployment's own route: the From address is the signed-in author. Mail from before this column, and drafts and sent copies, are 'smtp'.
    origin: text('origin').$type<MessageOrigin>().notNull().default('smtp')
  },
  (t) => [
    // Both are partial: they hold only the rows a background job still has to visit.
    index('idx_messages_plaintext')
      .on(t.id)
      .where(sql`${t.enc_fmt} = 0`),
    index('idx_messages_pending')
      .on(t.user_id)
      .where(sql`${t.wrap_kind} = 'server'`),
    index('idx_messages_user_folder_created_at').on(t.user_id, t.folder, sql`${t.created_at} desc`),
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
    created_at: integer('created_at').notNull(),
    // EM1 rows: filename, type and content id as one encrypted blob (base64url); the three columns above are then empty.
    meta_blob: text('meta_blob')
  },
  (t) => [index('idx_attachments_message_id').on(t.message_id)]
);

// Key/value store. The pre-multi-user identity rows (display_name, signature, default_from, sessions_valid_after) are copied to the first
// admin at Setup and deleted. Today it holds the organisation's settings: `require_2fa` ('1' | '0', absent = '1') and `default_language`.
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updated_at: integer('updated_at').notNull()
});

// One row per browser/device subscribed to Web Push (see src/worker/push.ts). `user_id` is the account the device notifies;
// NULL only before the first-run setup assigns existing devices to the admin.
export const pushSubscriptions = sqliteTable(
  'push_subscriptions',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    endpoint: text('endpoint').notNull().unique(),
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    user_agent: text('user_agent'),
    created_at: integer('created_at').notNull(),
    last_success_at: integer('last_success_at'),
    user_id: text('user_id').references(() => users.id, { onDelete: 'cascade' })
  },
  (t) => [index('idx_push_subscriptions_user_id').on(t.user_id)]
);

// Web Push (VAPID) key pair: created on first use by src/worker/push.ts, a single row with id 1.
// The private half is sealed under DATA_KEY (base64url of `version || kid || iv || ciphertext`), so a copy of the database alone cannot sign pushes.
export const pushKeys = sqliteTable('push_keys', {
  id: integer('id').primaryKey(),
  public_key: text('public_key').notNull(),
  private_key_sealed: text('private_key_sealed').notNull(),
  created_at: integer('created_at').notNull()
});

// Failed-login throttle (see src/worker/auth/throttle.ts): one row per client (CF-Connecting-IP, IPv6 as /64), `setup:<ip>` / `recover:<ip>`
// per client for setup and recovery, `acct:<email>` per account, `forgot:<client>` / `forgotacct:<email>` for the forgot-password flow, `stepup:<id>`, `2fa:<id>`, plus one 'global' row.
export const loginAttempts = sqliteTable('login_attempts', {
  key: text('key').primaryKey(),
  failures: integer('failures').notNull(),
  window_start: integer('window_start').notNull(),
  locked_until: integer('locked_until').notNull().default(0),
  updated_at: integer('updated_at').notNull()
});
