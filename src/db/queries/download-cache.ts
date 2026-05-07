import { getDb } from "../client";

export interface DownloadCacheResult {
  rowsAffected: number;
}

export interface DownloadCacheNovel {
  novelId: number;
  novelName: string;
  novelCover: string | null;
  pluginId: string;
  inLibrary: boolean;
  chaptersDownloaded: number;
  totalChapters: number;
  unreadDownloaded: number;
  readDownloaded: number;
  totalBytes: number;
  lastDownloadedAt: number | null;
}

interface RawDownloadCacheNovel
  extends Omit<DownloadCacheNovel, "inLibrary"> {
  inLibrary: number;
}

export interface DownloadCacheChapter {
  id: number;
  novelId: number;
  name: string;
  position: number;
  unread: boolean;
  progress: number;
  readAt: number | null;
  downloadedAt: number | null;
  contentBytes: number;
}

interface RawDownloadCacheChapter
  extends Omit<DownloadCacheChapter, "unread"> {
  unread: number;
}

export async function listDownloadCacheNovels(): Promise<DownloadCacheNovel[]> {
  const db = await getDb();
  const rows = await db.select<RawDownloadCacheNovel[]>(
    `SELECT
       n.id             AS novelId,
       n.name           AS novelName,
       n.cover          AS novelCover,
       n.plugin_id      AS pluginId,
       n.in_library     AS inLibrary,
       COUNT(c.id)      AS chaptersDownloaded,
       (
         SELECT COUNT(*)
         FROM chapter all_chapters
         WHERE all_chapters.novel_id = n.id
       )                AS totalChapters,
       COALESCE(SUM(CASE WHEN c.unread = 1 THEN 1 ELSE 0 END), 0)
                        AS unreadDownloaded,
       COALESCE(SUM(CASE WHEN c.unread = 0 THEN 1 ELSE 0 END), 0)
                        AS readDownloaded,
       COALESCE(SUM(c.content_bytes), 0) AS totalBytes,
       MAX(c.updated_at) AS lastDownloadedAt
     FROM novel n
     JOIN chapter c ON c.novel_id = n.id
     WHERE c.is_downloaded = 1
     GROUP BY n.id
     ORDER BY lastDownloadedAt DESC, n.name COLLATE NOCASE ASC`,
  );

  return rows.map((row) => ({
    ...row,
    inLibrary: !!row.inLibrary,
  }));
}

export async function listDownloadCacheChapters(
  novelId: number,
): Promise<DownloadCacheChapter[]> {
  const db = await getDb();
  const rows = await db.select<RawDownloadCacheChapter[]>(
    `SELECT
       id,
       novel_id AS novelId,
       name,
       position,
       unread,
       progress,
       read_at AS readAt,
       updated_at AS downloadedAt,
       content_bytes AS contentBytes
     FROM chapter
     WHERE novel_id = $1
       AND is_downloaded = 1
     ORDER BY position ASC, id ASC`,
    [novelId],
  );

  return rows.map((row) => ({
    ...row,
    unread: !!row.unread,
  }));
}

export async function deleteDownloadCacheChapter(
  chapterId: number,
): Promise<DownloadCacheResult> {
  const db = await getDb();
  const result = await db.execute(
    `UPDATE chapter
     SET
       content       = NULL,
       content_bytes = 0,
       is_downloaded = 0,
       updated_at    = unixepoch()
     WHERE id = $1
       AND is_downloaded = 1`,
    [chapterId],
  );
  return { rowsAffected: result.rowsAffected };
}

export async function deleteDownloadCacheNovel(
  novelId: number,
): Promise<DownloadCacheResult> {
  const db = await getDb();
  const result = await db.execute(
    `UPDATE chapter
     SET
       content       = NULL,
       content_bytes = 0,
       is_downloaded = 0,
       updated_at    = unixepoch()
     WHERE novel_id = $1
       AND is_downloaded = 1`,
    [novelId],
  );
  return { rowsAffected: result.rowsAffected };
}

export async function deleteAllDownloadCache(): Promise<DownloadCacheResult> {
  const db = await getDb();
  const result = await db.execute(
    `UPDATE chapter
     SET
       content       = NULL,
       content_bytes = 0,
       is_downloaded = 0,
       updated_at    = unixepoch()
     WHERE is_downloaded = 1`,
  );
  return { rowsAffected: result.rowsAffected };
}
