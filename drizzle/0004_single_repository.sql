DELETE FROM `repository`
WHERE `id` NOT IN (
  SELECT `id`
  FROM `repository`
  ORDER BY `added_at` DESC, `id` DESC
  LIMIT 1
);
--> statement-breakpoint
UPDATE `repository`
SET `id` = 1
WHERE `id` <> 1;
--> statement-breakpoint
DELETE FROM `repository_index_cache`
WHERE `repo_url` NOT IN (
  SELECT `url`
  FROM `repository`
);
--> statement-breakpoint
CREATE UNIQUE INDEX `repository_singleton_uniq` ON `repository` ((1));
