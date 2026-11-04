ALTER TABLE `messages` ADD `references_header` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `in_reply_to` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `snoozed_until` integer;--> statement-breakpoint
CREATE INDEX `idx_messages_snoozed_until` ON `messages` (`snoozed_until`);