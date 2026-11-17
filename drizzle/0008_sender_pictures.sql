-- The pictures of senders who are not on this deployment (looked up by the Worker while an admin has the `outside_pictures` setting on). One row per sender,
-- keyed by the SHA-256 of the address (the address itself is not stored) and named by an `id` that changes only when the bytes change. `found` 0 is a marker
-- (none found, or the lookup failed): then `mime` and `data` are null. Nothing existing is touched.
CREATE TABLE `sender_pictures` (
	`id` text PRIMARY KEY NOT NULL,
	`address_hash` text NOT NULL,
	`found` integer NOT NULL,
	`mime` text,
	`data` text,
	`checked_at` integer NOT NULL,
	CONSTRAINT "sender_pictures_mime_check" CHECK("sender_pictures"."mime" IN ('image/jpeg', 'image/webp', 'image/png')),
	CONSTRAINT "sender_pictures_found_check" CHECK(("sender_pictures"."found" = 1) = ("sender_pictures"."mime" IS NOT NULL AND "sender_pictures"."data" IS NOT NULL))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sender_pictures_address_hash_unique` ON `sender_pictures` (`address_hash`);