import { getDb } from "../../db/client";
import { upsertChapter } from "../../db/queries/chapter";
import type { NovelItem, Plugin } from "./types";

/**
 * Pull a novel + its chapter list from a plugin source and upsert
 * into the local DB. Returns the local `novel.id` so callers can
 * navigate to `/novel?id=N` immediately.
 *
 * Idempotent — repeated imports of the same `(pluginId, path)` row
 * update the metadata in place and INSERT-OR-IGNORE the chapter
 * list, leaving any local progress intact.
 */
export async function importNovelFromSource(
  plugin: Plugin,
  item: NovelItem,
): Promise<number> {
  const detail = await plugin.parseNovel(item.path);
  const db = await getDb();

  await db.execute(
    `INSERT INTO novel (plugin_id, path, name, cover, summary, author, artist, status, genres)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT(plugin_id, path) DO UPDATE SET
       name = excluded.name,
       cover = excluded.cover,
       summary = excluded.summary,
       author = excluded.author,
       artist = excluded.artist,
       status = excluded.status,
       genres = excluded.genres,
       updated_at = unixepoch()`,
    [
      plugin.id,
      item.path,
      detail.name,
      detail.cover ?? item.cover ?? null,
      detail.summary ?? null,
      detail.author ?? null,
      detail.artist ?? null,
      detail.status ?? null,
      detail.genres ?? null,
    ],
  );

  const rows = await db.select<{ id: number }[]>(
    `SELECT id FROM novel WHERE plugin_id = $1 AND path = $2`,
    [plugin.id, item.path],
  );
  const novelId = rows[0]?.id;
  if (!novelId) {
    throw new Error("import-novel: failed to resolve local novel id");
  }

  for (let i = 0; i < detail.chapters.length; i += 1) {
    const ch = detail.chapters[i]!;
    await upsertChapter({
      novelId,
      path: ch.path,
      name: ch.name,
      position: i + 1,
      chapterNumber:
        ch.chapterNumber !== undefined ? String(ch.chapterNumber) : null,
      releaseTime: ch.releaseTime ?? null,
    });
  }

  return novelId;
}
