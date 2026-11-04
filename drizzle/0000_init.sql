-- Baseline migration: the schema that used to live in schema.sql.
-- Hand-edited after `drizzle-kit generate` so it is safe on databases that were
-- already created from schema.sql: every CREATE is IF NOT EXISTS and the settings
-- seed is INSERT OR IGNORE. Do not regenerate this file; drizzle-kit only diffs
-- against drizzle/meta, so later migrations are unaffected by these edits.
CREATE TABLE IF NOT EXISTS `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`r2_key` text NOT NULL,
	`content_id` text,
	`is_inline` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`message_id`) REFERENCES `messages`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_attachments_message_id` ON `attachments` (`message_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`message_id` text,
	`thread_id` text,
	`from_address` text NOT NULL,
	`from_name` text,
	`to_address` text NOT NULL,
	`cc` text,
	`bcc` text,
	`reply_to` text,
	`subject` text,
	`snippet` text,
	`body_text` text,
	`body_html` text,
	`r2_key` text,
	`folder` text DEFAULT 'inbox' NOT NULL,
	`labels` text DEFAULT '[]' NOT NULL,
	`is_read` integer DEFAULT 0 NOT NULL,
	`is_starred` integer DEFAULT 0 NOT NULL,
	`has_attachments` integer DEFAULT 0 NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
-- Guard for databases created from the very first schema.sql: they have no
-- `messages.labels` column and the IF NOT EXISTS above skipped it, and Drizzle's
-- quoted "labels" would then read back as the string 'labels' instead of failing.
-- No-op on healthy databases; fails with "no such column: labels" on legacy ones.
-- Fix: see "Legacy databases" in README.md, then re-run the migration.
UPDATE messages SET labels = '[]' WHERE labels IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_messages_folder_created_at` ON `messages` (`folder`,"created_at" desc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_messages_thread_id` ON `messages` (`thread_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_messages_is_read` ON `messages` (`is_read`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_messages_is_starred` ON `messages` (`is_starred`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_messages_from_address` ON `messages` (`from_address`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_messages_to_address` ON `messages` (`to_address`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
-- Pre-seed default settings
INSERT OR IGNORE INTO `settings` (`key`, `value`, `updated_at`) VALUES
	('display_name', 'Edging Mail Admin', 1700000000000),
	('signature', 'Sent from edging-mail - 100% on Cloudflare Edge', 1700000000000),
	('outbound_provider', 'cloudflare_send_email', 1700000000000);
