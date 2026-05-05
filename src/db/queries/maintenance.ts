import { getDb } from "../client";

export interface MaintenanceResult {
  rowsAffected: number;
}

export async function clearCachedNovels(): Promise<MaintenanceResult> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM chapter
     WHERE novel_id IN (
       SELECT id FROM novel WHERE in_library = 0
     )`,
  );
  await db.execute(
    `DELETE FROM novel_category
     WHERE novel_id IN (
       SELECT id FROM novel WHERE in_library = 0
     )`,
  );
  const result = await db.execute(
    `DELETE FROM novel
     WHERE in_library = 0`,
  );
  return { rowsAffected: result.rowsAffected };
}

export async function clearUpdatesTab(): Promise<MaintenanceResult> {
  const db = await getDb();
  const result = await db.execute(
    `UPDATE chapter
     SET unread = 0, updated_at = unixepoch()
     WHERE unread = 1
       AND novel_id IN (
         SELECT id FROM novel WHERE in_library = 1
       )
       AND COALESCE(created_at, updated_at) >= (
         SELECT COALESCE(library_added_at, updated_at, created_at)
         FROM novel
         WHERE novel.id = chapter.novel_id
       )`,
  );
  return { rowsAffected: result.rowsAffected };
}

export async function deleteReadDownloadedChapters(): Promise<MaintenanceResult> {
  const db = await getDb();
  const result = await db.execute(
    `UPDATE chapter
     SET
       content = NULL,
       is_downloaded = 0,
       updated_at = unixepoch()
     WHERE unread = 0
       AND is_downloaded = 1`,
  );
  return { rowsAffected: result.rowsAffected };
}
