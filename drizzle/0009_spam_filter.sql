-- The spam filter (src/worker/spam). `mail_filters`: a person's own allow and block lists, one row per entry, `value` lower-case (`name@host`, or a bare host that also covers its
-- subdomains). `messages` gains the verdict of a mail the filter put in Spam (`spam_score` and `spam_reasons`, a JSON array of rule ids, never any content of the mail) and `auth`,
-- the compact SPF/DKIM/DMARC result Cloudflare recorded for a mail that arrived by email (`spf=<r>;dkim=<r>;dmarc=<r>`, NULL when there is none). `users.spam_filter` is the person's
-- switch: 1 for everybody who exists now, so the filter is on. Nothing existing is rewritten.
CREATE TABLE `mail_filters` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mail_filters_kind_check" CHECK("mail_filters"."kind" IN ('allow', 'block'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_filters_user_id_kind_value_unique` ON `mail_filters` (`user_id`,`kind`,`value`);--> statement-breakpoint
ALTER TABLE `messages` ADD `spam_score` integer;--> statement-breakpoint
ALTER TABLE `messages` ADD `spam_reasons` text;--> statement-breakpoint
ALTER TABLE `messages` ADD `auth` text;--> statement-breakpoint
ALTER TABLE `users` ADD `spam_filter` integer DEFAULT 1 NOT NULL;