ALTER TABLE `chapter` ADD `found_at` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `chapter`
SET `found_at` = MAX(
  COALESCE(`created_at`, 0),
  COALESCE(`updated_at`, 0),
  COALESCE(
    (
      SELECT `library_added_at`
      FROM `novel`
      WHERE `novel`.`id` = `chapter`.`novel_id`
    ),
    (
      SELECT `updated_at`
      FROM `novel`
      WHERE `novel`.`id` = `chapter`.`novel_id`
    ),
    (
      SELECT `created_at`
      FROM `novel`
      WHERE `novel`.`id` = `chapter`.`novel_id`
    ),
    0
  )
);
--> statement-breakpoint
CREATE INDEX `chapter_unread_found_position_idx` ON `chapter` (`unread`,`found_at`,`position`,`id`);
