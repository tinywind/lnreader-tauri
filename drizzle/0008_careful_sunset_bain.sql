ALTER TABLE `chapter` ADD `content_bytes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
UPDATE `chapter`
SET `content_bytes` = length(CAST(COALESCE(`content`, '') AS BLOB))
WHERE `is_downloaded` = 1;--> statement-breakpoint
CREATE INDEX `chapter_downloaded_updated_idx` ON `chapter` (`is_downloaded`,`updated_at`,`novel_id`);--> statement-breakpoint
CREATE INDEX `chapter_novel_downloaded_position_idx` ON `chapter` (`novel_id`,`is_downloaded`,`position`,`id`);
