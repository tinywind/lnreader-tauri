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
