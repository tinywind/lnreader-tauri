ALTER TABLE `novel` ADD `library_added_at` integer;
--> statement-breakpoint
UPDATE `novel`
SET `library_added_at` = `updated_at`
WHERE `in_library` = 1 AND `library_added_at` IS NULL;
--> statement-breakpoint
ALTER TABLE `chapter` ADD `created_at` integer;
--> statement-breakpoint
UPDATE `chapter`
SET `created_at` = `updated_at`
WHERE `created_at` IS NULL;
