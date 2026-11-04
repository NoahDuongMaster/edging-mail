CREATE TABLE `push_keys` (
	`id` integer PRIMARY KEY NOT NULL,
	`public_key` text NOT NULL,
	`private_key_sealed` text NOT NULL,
	`created_at` integer NOT NULL
);
