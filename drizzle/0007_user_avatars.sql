-- A person's profile picture, one row at most, in its own table so the session check (which reads the users row on every request) never loads the image.
-- `id` is new at every upload and is the name the picture is fetched by; `data` is the base64 of a JPEG or WebP of at most 12000 bytes. Nothing existing is touched.
CREATE TABLE `user_avatars` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`mime` text NOT NULL,
	`data` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_avatars_mime_check" CHECK("user_avatars"."mime" IN ('image/webp', 'image/jpeg'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_avatars_user_id_unique` ON `user_avatars` (`user_id`);