import { getDb } from "../client";

export interface ChapterRow {
  id: number;
  novelId: number;
  path: string;
  name: string;
  chapterNumber: string | null;
  position: number;
  page: string;
  bookmark: boolean;
  unread: boolean;
  progress: number;
  isDownloaded: boolean;
  content: string | null;
  releaseTime: string | null;
  readAt: number | null;
  updatedAt: number;
}

const SELECT_FIELDS = `
  id,
  novel_id       AS novelId,
  path,
  name,
  chapter_number AS chapterNumber,
  position,
  page,
  bookmark,
  unread,
  progress,
  is_downloaded  AS isDownloaded,
  content,
  release_time   AS releaseTime,
  read_at        AS readAt,
  updated_at     AS updatedAt
`;

export async function listChaptersByNovel(
  novelId: number,
): Promise<ChapterRow[]> {
  const db = await getDb();
  return db.select<ChapterRow[]>(
    `SELECT ${SELECT_FIELDS}
     FROM chapter
     WHERE novel_id = $1
     ORDER BY position`,
    [novelId],
  );
}

export async function getChapterById(
  chapterId: number,
): Promise<ChapterRow | null> {
  const db = await getDb();
  const rows = await db.select<ChapterRow[]>(
    `SELECT ${SELECT_FIELDS}
     FROM chapter
     WHERE id = $1`,
    [chapterId],
  );
  return rows[0] ?? null;
}

export interface InsertChapterInput {
  novelId: number;
  path: string;
  name: string;
  position: number;
  chapterNumber?: string | null;
  page?: string;
  releaseTime?: string | null;
}

export async function insertChapter(
  input: InsertChapterInput,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR IGNORE INTO chapter
       (novel_id, path, name, position, chapter_number, page, release_time)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.novelId,
      input.path,
      input.name,
      input.position,
      input.chapterNumber ?? null,
      input.page ?? "1",
      input.releaseTime ?? null,
    ],
  );
}

export async function updateChapterProgress(
  chapterId: number,
  progress: number,
): Promise<void> {
  const db = await getDb();
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));
  await db.execute(
    `UPDATE chapter
     SET
       progress   = $2,
       unread     = CASE WHEN $2 >= 97 THEN 0 ELSE unread END,
       read_at    = CASE WHEN $2 >= 97 THEN unixepoch() ELSE read_at END,
       updated_at = unixepoch()
     WHERE id = $1`,
    [chapterId, clamped],
  );
}

export async function setChapterBookmark(
  chapterId: number,
  bookmarked: boolean,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE chapter
     SET bookmark = $2, updated_at = unixepoch()
     WHERE id = $1`,
    [chapterId, bookmarked],
  );
}

export async function saveChapterContent(
  chapterId: number,
  html: string,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE chapter
     SET
       content        = $2,
       is_downloaded  = 1,
       updated_at     = unixepoch()
     WHERE id = $1`,
    [chapterId, html],
  );
}

export async function getChapterContent(
  chapterId: number,
): Promise<string | null> {
  const db = await getDb();
  const rows = await db.select<{ content: string | null }[]>(
    `SELECT content FROM chapter WHERE id = $1`,
    [chapterId],
  );
  return rows[0]?.content ?? null;
}

export async function clearChapterContent(
  chapterId: number,
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE chapter
     SET
       content        = NULL,
       is_downloaded  = 0,
       updated_at     = unixepoch()
     WHERE id = $1`,
    [chapterId],
  );
}

/** One chapter recently read, joined with its parent novel for display. */
export interface RecentlyReadEntry {
  chapterId: number;
  novelId: number;
  chapterName: string;
  position: number;
  readAt: number;
  progress: number;
  novelName: string;
  novelCover: string | null;
}

const DEFAULT_HISTORY_LIMIT = 100;

/**
 * Recently read chapters across the whole library, sorted by read
 * timestamp descending. Excludes never-read chapters.
 */
export async function listRecentlyRead(
  limit: number = DEFAULT_HISTORY_LIMIT,
): Promise<RecentlyReadEntry[]> {
  const db = await getDb();
  return db.select<RecentlyReadEntry[]>(
    `SELECT
       c.id              AS chapterId,
       c.novel_id        AS novelId,
       c.name            AS chapterName,
       c.position,
       c.read_at         AS readAt,
       c.progress,
       n.name            AS novelName,
       n.cover           AS novelCover
     FROM chapter c
     JOIN novel n ON n.id = c.novel_id
     WHERE c.read_at IS NOT NULL
     ORDER BY c.read_at DESC
     LIMIT $1`,
    [Math.max(1, Math.floor(limit))],
  );
}

export async function getAdjacentChapter(
  novelId: number,
  position: number,
  direction: 1 | -1,
): Promise<ChapterRow | null> {
  const db = await getDb();
  const sql =
    direction === 1
      ? `SELECT ${SELECT_FIELDS}
         FROM chapter
         WHERE novel_id = $1 AND position > $2
         ORDER BY position ASC
         LIMIT 1`
      : `SELECT ${SELECT_FIELDS}
         FROM chapter
         WHERE novel_id = $1 AND position < $2
         ORDER BY position DESC
         LIMIT 1`;
  const rows = await db.select<ChapterRow[]>(sql, [novelId, position]);
  return rows[0] ?? null;
}
