CREATE TABLE `intents` (
	`id` text PRIMARY KEY NOT NULL,
	`session_id` text NOT NULL,
	`description` text NOT NULL,
	`files` text NOT NULL,
	`symbols` text DEFAULT '[]' NOT NULL,
	`start_byte` integer,
	`end_byte` integer,
	`status` text DEFAULT 'declared' NOT NULL,
	`declared_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `intents_session_id_idx` ON `intents` (`session_id`);--> statement-breakpoint
CREATE INDEX `intents_status_idx` ON `intents` (`status`);--> statement-breakpoint
CREATE INDEX `intents_files_idx` ON `intents` (`files`);