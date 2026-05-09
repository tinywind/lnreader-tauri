import { getDb } from "../../db/client";
import { upsertChapter } from "../../db/queries/chapter";
import { normalizeChapterContentType } from "../chapter-content";
import { markUpdatesIndexDirty } from "../updates/update-index-events";
import type { NovelItem, Plugin } from "./types";

export interface SyncNovelFromSourceOptions {
  notifyUpdatesIndex?: boolean;
  preserveMissingMetadata?: boolean;
}

export interface SyncNovelFromSourceResult {
  changed: boolean;
  changedChapters: number;
  novelId: number;
  chapterCount: number;
}

function optionalText(value: string | undefined | null): string | null {
  return value ?? null;
}

function metadataAssignment(
  column: string,
  preserveMissingMetadata: boolean,
): string {
  return `${column} = ${metadataValue(column, preserveMissingMetadata)}`;
}

function metadataChangedClause(
  column: string,
  preserveMissingMetadata: boolean,
): string {
  return `${column} IS NOT ${metadataValue(column, preserveMissingMetadata)}`;
}

function metadataValue(
  column: string,
  preserveMissingMetadata: boolean,
): string {
  return preserveMissingMetadata
    ? `COALESCE(excluded.${column}, ${column})`
    : `excluded.${column}`;
}

export async function syncNovelFromSource(
  plugin: Plugin,
  item: NovelItem,
  options: SyncNovelFromSourceOptions = {},
): Promise<SyncNovelFromSourceResult> {
  const detail = await plugin.parseNovel(item.path);
  const db = await getDb();
  const preserveMissingMetadata = options.preserveMissingMetadata ?? false;

  const novelResult = await db.execute(
    `INSERT INTO novel (plugin_id, path, name, cover, summary, author, artist, status, genres)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT(plugin_id, path) DO UPDATE SET
       name = excluded.name,
       ${metadataAssignment("cover", preserveMissingMetadata)},
       ${metadataAssignment("summary", preserveMissingMetadata)},
       ${metadataAssignment("author", preserveMissingMetadata)},
       ${metadataAssignment("artist", preserveMissingMetadata)},
       ${metadataAssignment("status", preserveMissingMetadata)},
       ${metadataAssignment("genres", preserveMissingMetadata)},
       updated_at = unixepoch()
      WHERE
        name IS NOT excluded.name
        OR ${metadataChangedClause("cover", preserveMissingMetadata)}
        OR ${metadataChangedClause("summary", preserveMissingMetadata)}
        OR ${metadataChangedClause("author", preserveMissingMetadata)}
        OR ${metadataChangedClause("artist", preserveMissingMetadata)}
        OR ${metadataChangedClause("status", preserveMissingMetadata)}
        OR ${metadataChangedClause("genres", preserveMissingMetadata)}`,
    [
      plugin.id,
      item.path,
      detail.name || item.name,
      optionalText(detail.cover) ?? optionalText(item.cover),
      optionalText(detail.summary),
      optionalText(detail.author),
      optionalText(detail.artist),
      detail.status ? String(detail.status) : null,
      optionalText(detail.genres),
    ],
  );

  const rows = await db.select<{ id: number }[]>(
    `SELECT id FROM novel WHERE plugin_id = $1 AND path = $2`,
    [plugin.id, item.path],
  );
  const novelId = rows[0]?.id;
  if (!novelId) {
    throw new Error("sync-novel: failed to resolve local novel id");
  }

  let changedChapters = 0;
  for (let index = 0; index < detail.chapters.length; index += 1) {
    const chapter = detail.chapters[index]!;
    const chapterMutation = await upsertChapter({
      novelId,
      path: chapter.path,
      name: chapter.name,
      position: index + 1,
      chapterNumber:
        chapter.chapterNumber !== undefined
          ? String(chapter.chapterNumber)
          : null,
      page: chapter.page ?? "1",
      releaseTime: chapter.releaseTime ?? null,
      contentType: normalizeChapterContentType(chapter.contentType),
    });
    if (chapterMutation.rowsAffected > 0) changedChapters += 1;
  }

  const changed = novelResult.rowsAffected > 0 || changedChapters > 0;
  if (changed && (options.notifyUpdatesIndex ?? true)) {
    markUpdatesIndexDirty("novel-sync");
  }

  return {
    changed,
    changedChapters,
    novelId,
    chapterCount: detail.chapters.length,
  };
}
