ALTER TABLE `novel_stats` ADD `progress_sum` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
UPDATE `novel_stats`
SET
  `progress_sum` = COALESCE(
    (
      SELECT SUM(
        CASE
          WHEN c.`progress` >= 100 THEN 100
          WHEN c.`progress` < 0 THEN 0
          WHEN c.`progress` > 100 THEN 100
          ELSE c.`progress`
        END
      )
      FROM `chapter` c
      WHERE c.`novel_id` = `novel_stats`.`novel_id`
    ),
    0
  );
--> statement-breakpoint
UPDATE `novel_stats`
SET `reading_progress` = CASE
  WHEN `total_chapters` > 0
    THEN ROUND(CAST(`progress_sum` AS REAL) / `total_chapters`)
  ELSE 0
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `chapter_stats_after_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `chapter_stats_after_update_same_novel`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `chapter_stats_after_update_moved_novel`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `chapter_stats_after_delete`;
--> statement-breakpoint
CREATE TRIGGER `chapter_stats_after_insert`
AFTER INSERT ON `chapter`
BEGIN
  INSERT INTO `novel_stats` (
    `novel_id`,
    `total_chapters`,
    `chapters_downloaded`,
    `chapters_unread`,
    `progress_sum`,
    `reading_progress`,
    `last_chapter_updated_at`,
    `updated_at`
  )
  VALUES (
    NEW.`novel_id`,
    1,
    CASE WHEN NEW.`is_downloaded` = 1 THEN 1 ELSE 0 END,
    CASE WHEN NEW.`unread` = 1 THEN 1 ELSE 0 END,
    CASE
      WHEN NEW.`progress` >= 100 THEN 100
      WHEN NEW.`progress` < 0 THEN 0
      WHEN NEW.`progress` > 100 THEN 100
      ELSE NEW.`progress`
    END,
    CASE
      WHEN NEW.`progress` >= 100 THEN 100
      WHEN NEW.`progress` < 0 THEN 0
      WHEN NEW.`progress` > 100 THEN 100
      ELSE NEW.`progress`
    END,
    COALESCE(NEW.`updated_at`, 0),
    unixepoch()
  )
  ON CONFLICT(`novel_id`) DO UPDATE SET
    `total_chapters` = `total_chapters` + 1,
    `chapters_downloaded` =
      `chapters_downloaded` + excluded.`chapters_downloaded`,
    `chapters_unread` =
      `chapters_unread` + excluded.`chapters_unread`,
    `progress_sum` = `progress_sum` + excluded.`progress_sum`,
    `reading_progress` = ROUND(
      CAST(`progress_sum` + excluded.`progress_sum` AS REAL) /
      (`total_chapters` + 1)
    ),
    `last_chapter_updated_at` = MAX(
      `last_chapter_updated_at`,
      excluded.`last_chapter_updated_at`
    ),
    `updated_at` = unixepoch();
END;
--> statement-breakpoint
CREATE TRIGGER `chapter_stats_after_update_same_novel`
AFTER UPDATE ON `chapter`
WHEN OLD.`novel_id` = NEW.`novel_id`
BEGIN
  UPDATE `novel_stats`
  SET
    `chapters_downloaded` = MAX(
      `chapters_downloaded` +
        CASE WHEN NEW.`is_downloaded` = 1 THEN 1 ELSE 0 END -
        CASE WHEN OLD.`is_downloaded` = 1 THEN 1 ELSE 0 END,
      0
    ),
    `chapters_unread` = MAX(
      `chapters_unread` +
        CASE WHEN NEW.`unread` = 1 THEN 1 ELSE 0 END -
        CASE WHEN OLD.`unread` = 1 THEN 1 ELSE 0 END,
      0
    ),
    `progress_sum` = MAX(
      `progress_sum` +
        CASE
          WHEN NEW.`progress` >= 100 THEN 100
          WHEN NEW.`progress` < 0 THEN 0
          WHEN NEW.`progress` > 100 THEN 100
          ELSE NEW.`progress`
        END -
        CASE
          WHEN OLD.`progress` >= 100 THEN 100
          WHEN OLD.`progress` < 0 THEN 0
          WHEN OLD.`progress` > 100 THEN 100
          ELSE OLD.`progress`
        END,
      0
    ),
    `reading_progress` = CASE
      WHEN `total_chapters` > 0 THEN ROUND(
        CAST(MAX(
          `progress_sum` +
            CASE
              WHEN NEW.`progress` >= 100 THEN 100
              WHEN NEW.`progress` < 0 THEN 0
              WHEN NEW.`progress` > 100 THEN 100
              ELSE NEW.`progress`
            END -
            CASE
              WHEN OLD.`progress` >= 100 THEN 100
              WHEN OLD.`progress` < 0 THEN 0
              WHEN OLD.`progress` > 100 THEN 100
              ELSE OLD.`progress`
            END,
          0
        ) AS REAL) / `total_chapters`
      )
      ELSE 0
    END,
    `last_chapter_updated_at` = CASE
      WHEN COALESCE(NEW.`updated_at`, 0) >= `last_chapter_updated_at`
        THEN COALESCE(NEW.`updated_at`, 0)
      WHEN COALESCE(OLD.`updated_at`, 0) = `last_chapter_updated_at`
        THEN COALESCE(
          (
            SELECT MAX(c.`updated_at`)
            FROM `chapter` c
            WHERE c.`novel_id` = NEW.`novel_id`
          ),
          0
        )
      ELSE `last_chapter_updated_at`
    END,
    `updated_at` = unixepoch()
  WHERE `novel_id` = NEW.`novel_id`;
END;
--> statement-breakpoint
CREATE TRIGGER `chapter_stats_after_update_moved_novel`
AFTER UPDATE OF `novel_id` ON `chapter`
WHEN OLD.`novel_id` <> NEW.`novel_id`
BEGIN
  UPDATE `novel_stats`
  SET
    `total_chapters` = MAX(`total_chapters` - 1, 0),
    `chapters_downloaded` = MAX(
      `chapters_downloaded` -
        CASE WHEN OLD.`is_downloaded` = 1 THEN 1 ELSE 0 END,
      0
    ),
    `chapters_unread` = MAX(
      `chapters_unread` -
        CASE WHEN OLD.`unread` = 1 THEN 1 ELSE 0 END,
      0
    ),
    `progress_sum` = MAX(
      `progress_sum` -
        CASE
          WHEN OLD.`progress` >= 100 THEN 100
          WHEN OLD.`progress` < 0 THEN 0
          WHEN OLD.`progress` > 100 THEN 100
          ELSE OLD.`progress`
        END,
      0
    ),
    `reading_progress` = CASE
      WHEN `total_chapters` > 1 THEN ROUND(
        CAST(MAX(
          `progress_sum` -
            CASE
              WHEN OLD.`progress` >= 100 THEN 100
              WHEN OLD.`progress` < 0 THEN 0
              WHEN OLD.`progress` > 100 THEN 100
              ELSE OLD.`progress`
            END,
          0
        ) AS REAL) / (`total_chapters` - 1)
      )
      ELSE 0
    END,
    `last_chapter_updated_at` = CASE
      WHEN COALESCE(OLD.`updated_at`, 0) = `last_chapter_updated_at`
        THEN COALESCE(
          (
            SELECT MAX(c.`updated_at`)
            FROM `chapter` c
            WHERE c.`novel_id` = OLD.`novel_id`
          ),
          0
        )
      ELSE `last_chapter_updated_at`
    END,
    `updated_at` = unixepoch()
  WHERE `novel_id` = OLD.`novel_id`;

  INSERT INTO `novel_stats` (
    `novel_id`,
    `total_chapters`,
    `chapters_downloaded`,
    `chapters_unread`,
    `progress_sum`,
    `reading_progress`,
    `last_chapter_updated_at`,
    `updated_at`
  )
  VALUES (
    NEW.`novel_id`,
    1,
    CASE WHEN NEW.`is_downloaded` = 1 THEN 1 ELSE 0 END,
    CASE WHEN NEW.`unread` = 1 THEN 1 ELSE 0 END,
    CASE
      WHEN NEW.`progress` >= 100 THEN 100
      WHEN NEW.`progress` < 0 THEN 0
      WHEN NEW.`progress` > 100 THEN 100
      ELSE NEW.`progress`
    END,
    CASE
      WHEN NEW.`progress` >= 100 THEN 100
      WHEN NEW.`progress` < 0 THEN 0
      WHEN NEW.`progress` > 100 THEN 100
      ELSE NEW.`progress`
    END,
    COALESCE(NEW.`updated_at`, 0),
    unixepoch()
  )
  ON CONFLICT(`novel_id`) DO UPDATE SET
    `total_chapters` = `total_chapters` + 1,
    `chapters_downloaded` =
      `chapters_downloaded` + excluded.`chapters_downloaded`,
    `chapters_unread` =
      `chapters_unread` + excluded.`chapters_unread`,
    `progress_sum` = `progress_sum` + excluded.`progress_sum`,
    `reading_progress` = ROUND(
      CAST(`progress_sum` + excluded.`progress_sum` AS REAL) /
      (`total_chapters` + 1)
    ),
    `last_chapter_updated_at` = MAX(
      `last_chapter_updated_at`,
      excluded.`last_chapter_updated_at`
    ),
    `updated_at` = unixepoch();
END;
--> statement-breakpoint
CREATE TRIGGER `chapter_stats_after_delete`
AFTER DELETE ON `chapter`
BEGIN
  UPDATE `novel_stats`
  SET
    `total_chapters` = MAX(`total_chapters` - 1, 0),
    `chapters_downloaded` = MAX(
      `chapters_downloaded` -
        CASE WHEN OLD.`is_downloaded` = 1 THEN 1 ELSE 0 END,
      0
    ),
    `chapters_unread` = MAX(
      `chapters_unread` -
        CASE WHEN OLD.`unread` = 1 THEN 1 ELSE 0 END,
      0
    ),
    `progress_sum` = MAX(
      `progress_sum` -
        CASE
          WHEN OLD.`progress` >= 100 THEN 100
          WHEN OLD.`progress` < 0 THEN 0
          WHEN OLD.`progress` > 100 THEN 100
          ELSE OLD.`progress`
        END,
      0
    ),
    `reading_progress` = CASE
      WHEN `total_chapters` > 1 THEN ROUND(
        CAST(MAX(
          `progress_sum` -
            CASE
              WHEN OLD.`progress` >= 100 THEN 100
              WHEN OLD.`progress` < 0 THEN 0
              WHEN OLD.`progress` > 100 THEN 100
              ELSE OLD.`progress`
            END,
          0
        ) AS REAL) / (`total_chapters` - 1)
      )
      ELSE 0
    END,
    `last_chapter_updated_at` = CASE
      WHEN COALESCE(OLD.`updated_at`, 0) = `last_chapter_updated_at`
        THEN COALESCE(
          (
            SELECT MAX(c.`updated_at`)
            FROM `chapter` c
            WHERE c.`novel_id` = OLD.`novel_id`
          ),
          0
        )
      ELSE `last_chapter_updated_at`
    END,
    `updated_at` = unixepoch()
  WHERE `novel_id` = OLD.`novel_id`;
END;
