CREATE TABLE `locks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`symbol_path` text NOT NULL,
	`session_id` text NOT NULL,
	`acquired_at` integer NOT NULL,
	`expires_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `locks_symbol_path_unique` ON `locks` (`symbol_path`);--> statement-breakpoint
CREATE TABLE `symbol_deps` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file` text NOT NULL,
	`caller` text NOT NULL,
	`callee` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `symbol_deps_callee_idx` ON `symbol_deps` (`callee`);--> statement-breakpoint
CREATE INDEX `symbol_deps_caller_idx` ON `symbol_deps` (`caller`);--> statement-breakpoint
CREATE INDEX `symbol_deps_file_idx` ON `symbol_deps` (`file`);