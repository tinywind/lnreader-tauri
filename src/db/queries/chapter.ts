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
  contentBytes: number;
  releaseTime: string | null;
  readAt: number | null;
  createdAt: number | null;
  foundAt: number;
  updatedAt: number;
}

export type ChapterListRow = Omit<ChapterRow, "content">;

const CHAPTER_LIST_SELECT_FIELDS = `
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
  content_bytes   AS contentBytes,
  release_time   AS releaseTime,
  read_at        AS readAt,
  created_at     AS createdAt,
  found_at       AS foundAt,
  updated_at     AS updatedAt
`;

const CHAPTER_DETAIL_SELECT_FIELDS = `
  ${CHAPTER_LIST_SELECT_FIELDS},
  content
`;

function getUtf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export async function listChaptersByNovel(
  novelId: number,
): Promise<ChapterListRow[]> {
  const db = await getDb();
  return db.select<ChapterListRow[]>(
    `SELECT ${CHAPTER_LIST_SELECT_FIELDS}
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
    `SELECT ${CHAPTER_DETAIL_SELECT_FIELDS}
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
       (novel_id, path, name, position, chapter_number, page, release_time, created_at, found_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, unixepoch(), unixepoch())`,
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

export async function upsertChapter(input: InsertChapterInput): Promise<boolean> {
  const db = await getDb();
  const result = await db.execute(
    `INSERT INTO chapter
       (novel_id, path, name, position, chapter_number, page, release_time, created_at, found_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, unixepoch(), unixepoch())
     ON CONFLICT(novel_id, path) DO UPDATE SET
       name           = excluded.name,
       position       = excluded.position,
       chapter_number = excluded.chapter_number,
       page           = excluded.page,
       release_time   = excluded.release_time,
       updated_at     = unixepoch()
      WHERE
        name IS NOT excluded.name
        OR position IS NOT excluded.position
        OR chapter_number IS NOT excluded.chapter_number
        OR page IS NOT excluded.page
        OR release_time IS NOT excluded.release_time`,
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
  return result.rowsAffected > 0;
}

export async function updateChapterProgress(
  chapterId: number,
  progress: number,
  options: { recordHistory?: boolean } = {},
): Promise<void> {
  const db = await getDb();
  const clamped = Math.max(0, Math.min(100, Math.round(progress)));
  const recordHistory = options.recordHistory ?? true;
  if (recordHistory) {
    await db.execute(
      `UPDATE chapter
       SET
         progress   = $2,
         unread     = CASE WHEN $2 >= 100 THEN 0 ELSE unread END,
         read_at    = CASE WHEN $2 > 0 THEN unixepoch() ELSE read_at END,
         updated_at = unixepoch()
       WHERE id = $1`,
      [chapterId, clamped],
    );
    await db.execute(
      `UPDATE novel
       SET last_read_at = unixepoch(), updated_at = unixepoch()
       WHERE id = (
         SELECT novel_id FROM chapter WHERE id = $1
       )`,
      [chapterId],
    );
    return;
  }

  await db.execute(
    `UPDATE chapter
     SET
       progress   = $2,
       unread     = CASE WHEN $2 >= 100 THEN 0 ELSE unread END,
       updated_at = unixepoch()
     WHERE id = $1`,
    [chapterId, clamped],
  );
}

export async function markChapterOpened(chapterId: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE chapter
     SET read_at = unixepoch(), updated_at = unixepoch()
     WHERE id = $1`,
    [chapterId],
  );
  await db.execute(
    `UPDATE novel
     SET last_read_at = unixepoch(), updated_at = unixepoch()
     WHERE id = (
       SELECT novel_id FROM chapter WHERE id = $1
     )`,
    [chapterId],
  );
}

export async function clearNovelHistory(novelId: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    `UPDATE chapter
     SET read_at = NULL, updated_at = unixepoch()
     WHERE novel_id = $1 AND read_at IS NOT NULL`,
    [novelId],
  );
  await db.execute(
    `UPDATE novel
     SET last_read_at = NULL, updated_at = unixepoch()
     WHERE id = $1`,
    [novelId],
  );
}

export async function setChapterBookmark(
  chapterId: number,
  bookmarked: boolean,
): Promise<void> {
  const db = await getDb();
  const bookmarkFlag = bookmarked ? 1 : 0;
  await db.execute(
    `UPDATE chapter
     SET bookmark = $2, updated_at = unixepoch()
     WHERE id = $1`,
    [chapterId, bookmarkFlag],
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
       content_bytes  = $3,
       is_downloaded  = 1,
       updated_at     = unixepoch()
     WHERE id = $1`,
    [chapterId, html, getUtf8ByteLength(html)],
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
       content_bytes  = 0,
       is_downloaded  = 0,
       updated_at     = unixepoch()
     WHERE id = $1`,
    [chapterId],
  );
}

/**
 * One unread chapter for a novel that's currently in the library.
 * This is the row shape powering the Updates tab.
 */
export interface LibraryUpdateEntry {
  chapterId: number;
  chapterPath: string;
  novelId: number;
  pluginId: string;
  chapterName: string;
  position: number;
  foundAt: number;
  isDownloaded: boolean;
  novelName: string;
  novelCover: string | null;
}

interface RawLibraryUpdate extends Omit<LibraryUpdateEntry, "isDownloaded"> {
  isDownloaded: number;
}

const DEFAULT_UPDATES_LIMIT = 100;

export interface LibraryUpdatesPage {
  hasMore: boolean;
  nextCursor: LibraryUpdatesCursor | null;
  updates: LibraryUpdateEntry[];
}

export interface LibraryUpdatesCursor {
  chapterId: number;
  foundAt: number;
  position: number;
}

function getUpdatesCursor(
  entry: LibraryUpdateEntry | undefined,
): LibraryUpdatesCursor | null {
  if (!entry) return null;
  return {
    chapterId: entry.chapterId,
    foundAt: entry.foundAt,
    position: entry.position,
  };
}

/**
 * Unread chapters currently indexed for novels in the library.
 * The Updates tab calls a user-triggered source refresh; this query
 * only reads the resulting local index.
 */
export async function listLibraryUpdates(
  limit: number = DEFAULT_UPDATES_LIMIT,
  cursor: LibraryUpdatesCursor | null = null,
): Promise<LibraryUpdateEntry[]> {
  const db = await getDb();
  const normalizedLimit = Math.max(1, Math.floor(limit));
  const cursorClause = cursor
    ? `AND (
         c.found_at < $1
         OR (c.found_at = $1 AND c.position < $2)
         OR (c.found_at = $1 AND c.position = $2 AND c.id < $3)
       )`
    : "";
  const params = cursor
    ? [cursor.foundAt, cursor.position, cursor.chapterId, normalizedLimit]
    : [normalizedLimit];
  const limitParam = cursor ? "$4" : "$1";
  const rows = await db.select<RawLibraryUpdate[]>(
    `SELECT
       c.id              AS chapterId,
       c.path            AS chapterPath,
       c.novel_id        AS novelId,
       n.plugin_id       AS pluginId,
       c.name            AS chapterName,
       c.position,
       c.found_at        AS foundAt,
       c.is_downloaded   AS isDownloaded,
       n.name            AS novelName,
       n.cover           AS novelCover
     FROM chapter c
     JOIN novel n ON n.id = c.novel_id
     WHERE
       n.in_library = 1
       AND c.unread = 1
       ${cursorClause}
      ORDER BY foundAt DESC, c.position DESC, c.id DESC
      LIMIT ${limitParam}`,
    params,
  );
  return rows.map((row) => ({
    ...row,
    isDownloaded: !!row.isDownloaded,
  }));
}

export async function listLibraryUpdatesPage(
  limit: number = DEFAULT_UPDATES_LIMIT,
  cursor: LibraryUpdatesCursor | null = null,
): Promise<LibraryUpdatesPage> {
  const normalizedLimit = Math.max(1, Math.floor(limit));
  const rows = await listLibraryUpdates(
    normalizedLimit + 1,
    cursor,
  );
  const updates = rows.slice(0, normalizedLimit);
  const hasMore = rows.length > normalizedLimit;
  return {
    hasMore,
    nextCursor: hasMore ? getUpdatesCursor(updates.at(-1)) : null,
    updates,
  };
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
 * Latest read chapter per novel, sorted by read timestamp descending.
 * Excludes novels with no recorded reading history.
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
     WHERE c.id = (
       SELECT c2.id
       FROM chapter c2
       WHERE c2.novel_id = c.novel_id AND c2.read_at IS NOT NULL
       ORDER BY c2.read_at DESC, c2.position DESC, c2.id DESC
       LIMIT 1
     )
     ORDER BY c.read_at DESC, c.position DESC, c.id DESC
     LIMIT $1`,
    [Math.max(1, Math.floor(limit))],
  );
}

export async function getAdjacentChapter(
  novelId: number,
  position: number,
  direction: 1 | -1,
): Promise<ChapterListRow | null> {
  const db = await getDb();
  const sql =
    direction === 1
      ? `SELECT ${CHAPTER_LIST_SELECT_FIELDS}
         FROM chapter
         WHERE novel_id = $1 AND position > $2
         ORDER BY position ASC
         LIMIT 1`
      : `SELECT ${CHAPTER_LIST_SELECT_FIELDS}
         FROM chapter
         WHERE novel_id = $1 AND position < $2
         ORDER BY position DESC
         LIMIT 1`;
  const rows = await db.select<ChapterListRow[]>(sql, [novelId, position]);
  return rows[0] ?? null;
}
