-- Sessions ended on one device: signing out revokes the `sid` of that cookie only, not every cookie of the person (users.sessions_valid_after still
-- does that for a password change, a disable, a role change ...). Nothing existing is touched: cookies issued before this have no sid.
CREATE TABLE `revoked_sessions` (
	`sid` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_revoked_sessions_expires_at` ON `revoked_sessions` (`expires_at`);