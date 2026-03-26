CREATE TABLE `contracts` (
	`id` text PRIMARY KEY NOT NULL,
	`proposer_session_id` text NOT NULL,
	`symbol_path` text NOT NULL,
	`signature` text NOT NULL,
	`status` text DEFAULT 'proposed' NOT NULL,
	`responder_session_id` text,
	`proposed_at` integer NOT NULL,
	`responded_at` integer
);
--> statement-breakpoint
CREATE INDEX `contracts_symbol_path_idx` ON `contracts` (`symbol_path`);--> statement-breakpoint
CREATE INDEX `contracts_status_idx` ON `contracts` (`status`);--> statement-breakpoint
CREATE INDEX `contracts_proposer_session_id_idx` ON `contracts` (`proposer_session_id`);