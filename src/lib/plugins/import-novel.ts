import type { NovelItem, Plugin } from "./types";
import { syncNovelFromSource } from "./sync-novel";

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
  const result = await syncNovelFromSource(plugin, item);
  return result.novelId;
}
