CREATE TABLE `novel_stats` (
	`novel_id` integer PRIMARY KEY NOT NULL,
	`total_chapters` integer DEFAULT 0 NOT NULL,
	`chapters_downloaded` integer DEFAULT 0 NOT NULL,
	`chapters_unread` integer DEFAULT 0 NOT NULL,
	`reading_progress` integer DEFAULT 0 NOT NULL,
	`last_chapter_updated_at` integer DEFAULT 0 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`novel_id`) REFERENCES `novel`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `novel_stats_downloaded_idx` ON `novel_stats` (`chapters_downloaded`);--> statement-breakpoint
CREATE INDEX `novel_stats_unread_idx` ON `novel_stats` (`chapters_unread`);--> statement-breakpoint
CREATE INDEX `novel_stats_total_idx` ON `novel_stats` (`total_chapters`);--> statement-breakpoint
CREATE INDEX `novel_stats_last_chapter_updated_idx` ON `novel_stats` (`last_chapter_updated_at`);
--> statement-breakpoint
INSERT OR REPLACE INTO `novel_stats` (
  `novel_id`,
  `total_chapters`,
  `chapters_downloaded`,
  `chapters_unread`,
  `reading_progress`,
  `last_chapter_updated_at`,
  `updated_at`
)
SELECT
  n.`id`,
  COUNT(c.`id`),
  COALESCE(SUM(CASE WHEN c.`is_downloaded` = 1 THEN 1 ELSE 0 END), 0),
  COALESCE(SUM(CASE WHEN c.`unread` = 1 THEN 1 ELSE 0 END), 0),
  COALESCE(
    ROUND(AVG(
      CASE
        WHEN c.`id` IS NULL THEN NULL
        WHEN c.`progress` >= 100 THEN 100
        WHEN c.`progress` < 0 THEN 0
        WHEN c.`progress` > 100 THEN 100
        ELSE c.`progress`
      END
    )),
    0
  ),
  COALESCE(MAX(c.`updated_at`), 0),
  unixepoch()
FROM `novel` n
LEFT JOIN `chapter` c ON c.`novel_id` = n.`id`
GROUP BY n.`id`;
--> statement-breakpoint
CREATE TRIGGER `chapter_stats_after_insert`
AFTER INSERT ON `chapter`
BEGIN
  INSERT OR REPLACE INTO `novel_stats` (
    `novel_id`,
    `total_chapters`,
    `chapters_downloaded`,
    `chapters_unread`,
    `reading_progress`,
    `last_chapter_updated_at`,
    `updated_at`
  )
  SELECT
    n.`id`,
    COUNT(c.`id`),
    COALESCE(SUM(CASE WHEN c.`is_downloaded` = 1 THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN c.`unread` = 1 THEN 1 ELSE 0 END), 0),
    COALESCE(
      ROUND(AVG(
        CASE
          WHEN c.`id` IS NULL THEN NULL
          WHEN c.`progress` >= 100 THEN 100
          WHEN c.`progress` < 0 THEN 0
          WHEN c.`progress` > 100 THEN 100
          ELSE c.`progress`
        END
      )),
      0
    ),
    COALESCE(MAX(c.`updated_at`), 0),
    unixepoch()
  FROM `novel` n
  LEFT JOIN `chapter` c ON c.`novel_id` = n.`id`
  WHERE n.`id` = NEW.`novel_id`
  GROUP BY n.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `chapter_stats_after_update_same_novel`
AFTER UPDATE ON `chapter`
WHEN OLD.`novel_id` = NEW.`novel_id`
BEGIN
  INSERT OR REPLACE INTO `novel_stats` (
    `novel_id`,
    `total_chapters`,
    `chapters_downloaded`,
    `chapters_unread`,
    `reading_progress`,
    `last_chapter_updated_at`,
    `updated_at`
  )
  SELECT
    n.`id`,
    COUNT(c.`id`),
    COALESCE(SUM(CASE WHEN c.`is_downloaded` = 1 THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN c.`unread` = 1 THEN 1 ELSE 0 END), 0),
    COALESCE(
      ROUND(AVG(
        CASE
          WHEN c.`id` IS NULL THEN NULL
          WHEN c.`progress` >= 100 THEN 100
          WHEN c.`progress` < 0 THEN 0
          WHEN c.`progress` > 100 THEN 100
          ELSE c.`progress`
        END
      )),
      0
    ),
    COALESCE(MAX(c.`updated_at`), 0),
    unixepoch()
  FROM `novel` n
  LEFT JOIN `chapter` c ON c.`novel_id` = n.`id`
  WHERE n.`id` = NEW.`novel_id`
  GROUP BY n.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `chapter_stats_after_update_moved_novel`
AFTER UPDATE OF `novel_id` ON `chapter`
WHEN OLD.`novel_id` <> NEW.`novel_id`
BEGIN
  INSERT OR REPLACE INTO `novel_stats` (
    `novel_id`,
    `total_chapters`,
    `chapters_downloaded`,
    `chapters_unread`,
    `reading_progress`,
    `last_chapter_updated_at`,
    `updated_at`
  )
  SELECT
    n.`id`,
    COUNT(c.`id`),
    COALESCE(SUM(CASE WHEN c.`is_downloaded` = 1 THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN c.`unread` = 1 THEN 1 ELSE 0 END), 0),
    COALESCE(
      ROUND(AVG(
        CASE
          WHEN c.`id` IS NULL THEN NULL
          WHEN c.`progress` >= 100 THEN 100
          WHEN c.`progress` < 0 THEN 0
          WHEN c.`progress` > 100 THEN 100
          ELSE c.`progress`
        END
      )),
      0
    ),
    COALESCE(MAX(c.`updated_at`), 0),
    unixepoch()
  FROM `novel` n
  LEFT JOIN `chapter` c ON c.`novel_id` = n.`id`
  WHERE n.`id` = OLD.`novel_id`
  GROUP BY n.`id`;

  INSERT OR REPLACE INTO `novel_stats` (
    `novel_id`,
    `total_chapters`,
    `chapters_downloaded`,
    `chapters_unread`,
    `reading_progress`,
    `last_chapter_updated_at`,
    `updated_at`
  )
  SELECT
    n.`id`,
    COUNT(c.`id`),
    COALESCE(SUM(CASE WHEN c.`is_downloaded` = 1 THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN c.`unread` = 1 THEN 1 ELSE 0 END), 0),
    COALESCE(
      ROUND(AVG(
        CASE
          WHEN c.`id` IS NULL THEN NULL
          WHEN c.`progress` >= 100 THEN 100
          WHEN c.`progress` < 0 THEN 0
          WHEN c.`progress` > 100 THEN 100
          ELSE c.`progress`
        END
      )),
      0
    ),
    COALESCE(MAX(c.`updated_at`), 0),
    unixepoch()
  FROM `novel` n
  LEFT JOIN `chapter` c ON c.`novel_id` = n.`id`
  WHERE n.`id` = NEW.`novel_id`
  GROUP BY n.`id`;
END;
--> statement-breakpoint
CREATE TRIGGER `chapter_stats_after_delete`
AFTER DELETE ON `chapter`
BEGIN
  INSERT OR REPLACE INTO `novel_stats` (
    `novel_id`,
    `total_chapters`,
    `chapters_downloaded`,
    `chapters_unread`,
    `reading_progress`,
    `last_chapter_updated_at`,
    `updated_at`
  )
  SELECT
    n.`id`,
    COUNT(c.`id`),
    COALESCE(SUM(CASE WHEN c.`is_downloaded` = 1 THEN 1 ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN c.`unread` = 1 THEN 1 ELSE 0 END), 0),
    COALESCE(
      ROUND(AVG(
        CASE
          WHEN c.`id` IS NULL THEN NULL
          WHEN c.`progress` >= 100 THEN 100
          WHEN c.`progress` < 0 THEN 0
          WHEN c.`progress` > 100 THEN 100
          ELSE c.`progress`
        END
      )),
      0
    ),
    COALESCE(MAX(c.`updated_at`), 0),
    unixepoch()
  FROM `novel` n
  LEFT JOIN `chapter` c ON c.`novel_id` = n.`id`
  WHERE n.`id` = OLD.`novel_id`
  GROUP BY n.`id`;
END;
