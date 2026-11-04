CREATE TABLE `push_subscriptions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`endpoint` text NOT NULL,
	`p256dh` text NOT NULL,
	`auth` text NOT NULL,
	`user_agent` text,
	`created_at` integer NOT NULL,
	`last_success_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `push_subscriptions_endpoint_unique` ON `push_subscriptions` (`endpoint`);--> statement-breakpoint
-- Hand-added: remove the demo settings that 0000 seeded. Only rows that still hold the exact seed value are
-- deleted, so a display name or signature the user saved in Settings survives.
DELETE FROM `settings` WHERE (`key` = 'display_name' AND `value` = 'Edging Mail Admin')
	OR (`key` = 'signature' AND `value` = 'Sent from edging-mail - 100% on Cloudflare Edge')
	OR (`key` = 'outbound_provider' AND `value` = 'cloudflare_send_email');