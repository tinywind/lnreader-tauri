CREATE TABLE `category` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`sort` integer NOT NULL,
	`is_system` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `category_name_uniq` ON `category` (`name`);--> statement-breakpoint
CREATE INDEX `category_sort_idx` ON `category` (`sort`);--> statement-breakpoint
CREATE TABLE `chapter` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`novel_id` integer NOT NULL,
	`path` text NOT NULL,
	`name` text NOT NULL,
	`chapter_number` text,
	`position` integer NOT NULL,
	`page` text DEFAULT '1' NOT NULL,
	`bookmark` integer DEFAULT false NOT NULL,
	`unread` integer DEFAULT true NOT NULL,
	`progress` integer DEFAULT 0 NOT NULL,
	`is_downloaded` integer DEFAULT false NOT NULL,
	`release_time` text,
	`read_at` integer,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`novel_id`) REFERENCES `novel`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chapter_novel_path_uniq` ON `chapter` (`novel_id`,`path`);--> statement-breakpoint
CREATE INDEX `chapter_novel_position_idx` ON `chapter` (`novel_id`,`position`);--> statement-breakpoint
CREATE TABLE `novel_category` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`novel_id` integer NOT NULL,
	`category_id` integer NOT NULL,
	FOREIGN KEY (`novel_id`) REFERENCES `novel`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `category`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `novel_category_uniq` ON `novel_category` (`novel_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `novel_category_category_idx` ON `novel_category` (`category_id`);--> statement-breakpoint
CREATE TABLE `novel` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`plugin_id` text NOT NULL,
	`path` text NOT NULL,
	`name` text NOT NULL,
	`cover` text,
	`summary` text,
	`author` text,
	`artist` text,
	`status` text,
	`genres` text,
	`in_library` integer DEFAULT false NOT NULL,
	`is_local` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	`last_read_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `novel_plugin_path_uniq` ON `novel` (`plugin_id`,`path`);--> statement-breakpoint
CREATE INDEX `novel_in_library_idx` ON `novel` (`in_library`);--> statement-breakpoint
CREATE TABLE `repository` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`url` text NOT NULL,
	`name` text,
	`added_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repository_url_uniq` ON `repository` (`url`);