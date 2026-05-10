CREATE TABLE `installed_plugin` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`lang` text NOT NULL,
	`version` text NOT NULL,
	`icon_url` text NOT NULL,
	`source_url` text NOT NULL,
	`source_code` text NOT NULL,
	`installed_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `repository_index_cache` (
	`repo_url` text PRIMARY KEY NOT NULL,
	`fetched_at` integer DEFAULT (unixepoch()) NOT NULL,
	`items_json` text NOT NULL
);
