import { getDb } from "../client";
import { UNCATEGORIZED_CATEGORY_ID } from "./category";
import {
  normalizeChapterContentType,
  type ChapterContentType,
} from "../../lib/chapter-content";
import { isLocalCoverSource } from "../../lib/local-cover";
import type { LibrarySortOrder } from "../../store/library";

export const LOCAL_PLUGIN_ID = "local";

/**
 * Shape returned by the Library list query.
 *
 * SQL aliases the snake_case columns into camelCase so consumers
 * can treat rows as plain TS records without a separate mapping
 * layer.
 */
export interface LibraryNovel {
  id: number;
  pluginId: string;
  path: string;
  name: string;
  cover: string | null;
  author: string | null;
  inLibrary: boolean;
  isLocal: boolean;
  totalChapters: number;
  chaptersDownloaded: number;
  chaptersUnread: number;
  readingProgress: number;
  lastReadAt: number | null;
  lastUpdatedAt: number;
}

export interface LibraryFilter {
  /** Case-insensitive substring match against `name`. Empty and blank values are ignored. */
  search?: string;
  /** Restrict to an assigned category, or to uncategorized novels with the sentinel id. */
  categoryId?: number | null;
  downloadedOnly?: boolean;
  unreadOnly?: boolean;
  sortOrder?: LibrarySortOrder;
}

interface RawLibraryNovel extends Omit<LibraryNovel, "inLibrary" | "isLocal"> {
  inLibrary: number;
  isLocal: number;
}

export interface LibraryNovelRefreshTarget {
  id: number;
  pluginId: string;
  path: string;
  name: string;
  cover: string | null;
  isLocal: boolean;
}

interface RawLibraryNovelRefreshTarget
  extends Omit<LibraryNovelRefreshTarget, "isLocal"> {
  isLocal: number;
}

const LIBRARY_SORT_SQL: Record<LibrarySortOrder, string> = {
  nameAsc: "n.name COLLATE NOCASE ASC",
  nameDesc: "n.name COLLATE NOCASE DESC",
  downloadedAsc: "chaptersDownloaded ASC",
  downloadedDesc: "chaptersDownloaded DESC",
  totalChaptersAsc: "totalChapters ASC",
  totalChaptersDesc: "totalChapters DESC",
  unreadChaptersAsc: "chaptersUnread ASC",
  unreadChaptersDesc: "chaptersUnread DESC",
  dateAddedAsc: "n.id ASC",
  dateAddedDesc: "n.id DESC",
  lastReadAsc: "COALESCE(n.last_read_at, 0) ASC",
  lastReadDesc: "COALESCE(n.last_read_at, 0) DESC",
  lastUpdatedAsc: "lastUpdatedAt ASC",
  lastUpdatedDesc: "lastUpdatedAt DESC",
};

export async function listLibraryNovels(
  filter: LibraryFilter = {},
): Promise<LibraryNovel[]> {
  const db = await getDb();

  const conditions: string[] = ["n.in_library = 1"];
  const params: unknown[] = [];

  const trimmedSearch = filter.search?.trim() ?? "";
  if (trimmedSearch !== "") {
    params.push(trimmedSearch);
    conditions.push(
      `n.name LIKE '%' || $${params.length} || '%' COLLATE NOCASE`,
    );
  }
  if (filter.categoryId === UNCATEGORIZED_CATEGORY_ID) {
    conditions.push(
      "NOT EXISTS (SELECT 1 FROM novel_category nc WHERE nc.novel_id = n.id)",
    );
  } else if (filter.categoryId != null) {
    params.push(filter.categoryId);
    conditions.push(
      `EXISTS (SELECT 1 FROM novel_category nc WHERE nc.novel_id = n.id AND nc.category_id = $${params.length})`,
    );
  }
  if (filter.downloadedOnly) {
    conditions.push(
      "(n.is_local = 1 OR COALESCE(s.chapters_downloaded, 0) > 0)",
    );
  }
  if (filter.unreadOnly) {
    conditions.push("COALESCE(s.chapters_unread, 0) > 0");
  }

  const orderBy = LIBRARY_SORT_SQL[filter.sortOrder ?? "dateAddedDesc"];

  const sql = `
    SELECT
      n.id,
      n.plugin_id    AS pluginId,
      n.path,
      n.name,
      n.cover,
      n.author,
      n.in_library   AS inLibrary,
      n.is_local     AS isLocal,
      COALESCE(s.total_chapters, 0) AS totalChapters,
      COALESCE(s.chapters_downloaded, 0) AS chaptersDownloaded,
      COALESCE(s.chapters_unread, 0) AS chaptersUnread,
      COALESCE(s.reading_progress, 0) AS readingProgress,
      n.last_read_at AS lastReadAt,
      CASE
        WHEN COALESCE(s.total_chapters, 0) > 0
          THEN COALESCE(s.last_chapter_updated_at, n.updated_at)
        ELSE n.updated_at
      END AS lastUpdatedAt
    FROM novel n
    LEFT JOIN novel_stats s ON s.novel_id = n.id
    WHERE ${conditions.join(" AND ")}
    ORDER BY ${orderBy}, n.name COLLATE NOCASE ASC
  `;

  const rows = await db.select<RawLibraryNovel[]>(sql, params);
  return rows.map((row) => {
    const isLocal = !!row.isLocal;
    return {
      ...row,
      cover: isLocal ? displayLocalCover(row.cover) : row.cover,
      inLibrary: !!row.inLibrary,
      isLocal,
    };
  });
}

export async function listLibraryNovelRefreshTargets(
  filter: Pick<LibraryFilter, "categoryId"> = {},
): Promise<LibraryNovelRefreshTarget[]> {
  const db = await getDb();
  const conditions: string[] = ["n.in_library = 1"];
  const params: unknown[] = [];

  if (filter.categoryId === UNCATEGORIZED_CATEGORY_ID) {
    conditions.push(
      "NOT EXISTS (SELECT 1 FROM novel_category nc WHERE nc.novel_id = n.id)",
    );
  } else if (filter.categoryId != null) {
    params.push(filter.categoryId);
    conditions.push(
      `EXISTS (SELECT 1 FROM novel_category nc WHERE nc.novel_id = n.id AND nc.category_id = $${params.length})`,
    );
  }

  const rows = await db.select<RawLibraryNovelRefreshTarget[]>(
    `SELECT
       n.id,
       n.plugin_id AS pluginId,
       n.path,
       n.name,
       n.cover,
       n.is_local AS isLocal
     FROM novel n
     WHERE ${conditions.join(" AND ")}
     ORDER BY n.name COLLATE NOCASE ASC`,
    params,
  );

  return rows.map((row) => ({
    ...row,
    isLocal: !!row.isLocal,
  }));
}

/**
 * Full row shape used by the novel detail screen. Booleans are
 * coerced from SQLite's 0/1 ints so consumers can use strict
 * `=== true` comparisons.
 */
export interface NovelDetailRecord {
  id: number;
  pluginId: string;
  path: string;
  name: string;
  cover: string | null;
  summary: string | null;
  author: string | null;
  artist: string | null;
  status: string | null;
  genres: string | null;
  inLibrary: boolean;
  isLocal: boolean;
  createdAt: number;
  updatedAt: number;
  libraryAddedAt: number | null;
  lastReadAt: number | null;
}

interface RawNovelDetail extends Omit<NovelDetailRecord, "inLibrary" | "isLocal"> {
  inLibrary: number;
  isLocal: number;
}

const SELECT_NOVEL_DETAIL_FIELDS = `
  SELECT
    id,
    plugin_id      AS pluginId,
    path,
    name,
    cover,
    summary,
    author,
    artist,
    status,
    genres,
    in_library     AS inLibrary,
    is_local       AS isLocal,
    created_at     AS createdAt,
    updated_at     AS updatedAt,
    library_added_at AS libraryAddedAt,
    last_read_at   AS lastReadAt
  FROM novel
`;

function mapNovelDetail(row: RawNovelDetail): NovelDetailRecord {
  const isLocal = !!row.isLocal;
  return {
    ...row,
    cover: isLocal ? displayLocalCover(row.cover) : row.cover,
    inLibrary: !!row.inLibrary,
    isLocal,
  };
}

export async function getNovelById(
  id: number,
): Promise<NovelDetailRecord | null> {
  const db = await getDb();
  const rows = await db.select<RawNovelDetail[]>(
    `${SELECT_NOVEL_DETAIL_FIELDS}
     WHERE id = $1`,
    [id],
  );
  const row = rows[0];
  return row ? mapNovelDetail(row) : null;
}

export async function findLocalNovelByPath(
  path: string,
): Promise<NovelDetailRecord | null> {
  const db = await getDb();
  const rows = await db.select<RawNovelDetail[]>(
    `${SELECT_NOVEL_DETAIL_FIELDS}
     WHERE plugin_id = $1
       AND path = $2
       AND is_local = 1`,
    [LOCAL_PLUGIN_ID, path],
  );
  const row = rows[0];
  return row ? mapNovelDetail(row) : null;
}

/**
 * Toggle a novel's library membership. Touches `updated_at` so
 * Library reorders the row on the next paint.
 */
export async function setNovelInLibrary(
  id: number,
  inLibrary: boolean,
): Promise<void> {
  const db = await getDb();
  const inLibraryFlag = inLibrary ? 1 : 0;
  await db.execute(
    `UPDATE novel
     SET
       in_library = $2,
       library_added_at = CASE WHEN $2 = 1 THEN unixepoch() ELSE NULL END,
       updated_at = unixepoch()
     WHERE id = $1`,
    [id, inLibraryFlag],
  );
  if (inLibrary) {
    await db.execute(
      `UPDATE chapter
       SET found_at = MAX(COALESCE(found_at, 0), unixepoch())
       WHERE novel_id = $1`,
      [id],
    );
  }
}

export async function countNovels(): Promise<number> {
  const db = await getDb();
  const rows = await db.select<{ count: number }[]>(
    "SELECT COUNT(*) AS count FROM novel",
  );
  return rows[0]?.count ?? 0;
}

export interface InsertNovelInput {
  pluginId: string;
  path: string;
  name: string;
  cover?: string | null;
  inLibrary?: boolean;
}

export async function insertNovelIfAbsent(
  input: InsertNovelInput,
): Promise<void> {
  const db = await getDb();
  const inLibrary = (input.inLibrary ?? true) ? 1 : 0;
  await db.execute(
    `INSERT OR IGNORE INTO novel
       (plugin_id, path, name, cover, in_library, library_added_at)
     VALUES ($1, $2, $3, $4, $5, CASE WHEN $5 = 1 THEN unixepoch() ELSE NULL END)`,
    [
      input.pluginId,
      input.path,
      input.name,
      input.cover ?? null,
      inLibrary,
    ],
  );
}

export interface LocalNovelImportChapterInput {
  path: string;
  name: string;
  position: number;
  content: string;
  contentType?: ChapterContentType;
  contentBytes: number;
  chapterNumber?: string | null;
  page?: string;
  releaseTime?: string | null;
}

export interface LocalNovelImportInput {
  path: string;
  name: string;
  cover?: string | null;
  summary?: string | null;
  author?: string | null;
  artist?: string | null;
  status?: string | null;
  genres?: string | null;
  chapters: LocalNovelImportChapterInput[];
}

export interface LocalNovelImportResult {
  changed: boolean;
  changedChapters: number;
  novelId: number;
  chapterCount: number;
}

export interface LocalNovelMetadataInput {
  name: string;
  cover?: string | null;
  summary?: string | null;
  author?: string | null;
  artist?: string | null;
  status?: string | null;
  genres?: string | null;
}

function nullableText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

function nullableLocalCover(value: string | null | undefined): string | null {
  const trimmed = nullableText(value);
  if (!trimmed) return null;
  if (isLocalCoverSource(trimmed)) return trimmed;
  return null;
}

function displayLocalCover(value: string | null): string | null {
  return isLocalCoverSource(value) ? value : null;
}

export async function upsertLocalNovelMetadata(
  input: LocalNovelMetadataInput & { path: string },
): Promise<number> {
  const db = await getDb();
  const name = input.name.trim();
  if (!name) throw new Error("local novel: name is required");

  await db.execute(
    `INSERT INTO novel
       (plugin_id, path, name, cover, summary, author, artist, status, genres, in_library, is_local, library_added_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, 1, unixepoch())
     ON CONFLICT(plugin_id, path) DO UPDATE SET
       name             = excluded.name,
       cover            = excluded.cover,
       summary          = excluded.summary,
       author           = excluded.author,
       artist           = excluded.artist,
       status           = excluded.status,
       genres           = excluded.genres,
       in_library       = 1,
       is_local         = 1,
       library_added_at = COALESCE(library_added_at, unixepoch()),
       updated_at       = unixepoch()`,
    [
      LOCAL_PLUGIN_ID,
      input.path,
      name,
      nullableLocalCover(input.cover),
      nullableText(input.summary),
      nullableText(input.author),
      nullableText(input.artist),
      nullableText(input.status),
      nullableText(input.genres),
    ],
  );

  const rows = await db.select<{ id: number }[]>(
    `SELECT id FROM novel WHERE plugin_id = $1 AND path = $2 AND is_local = 1`,
    [LOCAL_PLUGIN_ID, input.path],
  );
  const novelId = rows[0]?.id;
  if (!novelId) {
    throw new Error("local novel: failed to resolve local novel id");
  }
  return novelId;
}

export async function updateLocalNovelMetadata(
  novelId: number,
  input: LocalNovelMetadataInput,
): Promise<void> {
  const db = await getDb();
  const name = input.name.trim();
  if (!name) throw new Error("local novel: name is required");

  const novelRows = await db.select<{ id: number }[]>(
    `SELECT id FROM novel WHERE id = $1 AND plugin_id = $2 AND is_local = 1`,
    [novelId, LOCAL_PLUGIN_ID],
  );
  if (!novelRows[0]) {
    throw new Error("local novel: target novel is not local");
  }

  await db.execute(
    `UPDATE novel
     SET
       name       = $2,
       cover      = $3,
       summary    = $4,
       author     = $5,
       artist     = $6,
       status     = $7,
       genres     = $8,
       updated_at = unixepoch()
     WHERE id = $1
       AND plugin_id = $9
       AND is_local = 1`,
    [
      novelId,
      name,
      nullableLocalCover(input.cover),
      nullableText(input.summary),
      nullableText(input.author),
      nullableText(input.artist),
      nullableText(input.status),
      nullableText(input.genres),
      LOCAL_PLUGIN_ID,
    ],
  );
}

export async function upsertLocalNovelChapters(
  novelId: number,
  chapters: LocalNovelImportChapterInput[],
): Promise<LocalNovelImportResult> {
  const db = await getDb();
  const novelRows = await db.select<{ id: number }[]>(
    `SELECT id FROM novel WHERE id = $1 AND plugin_id = $2 AND is_local = 1`,
    [novelId, LOCAL_PLUGIN_ID],
  );
  if (!novelRows[0]) {
    throw new Error("local novel: target novel is not local");
  }

  let changedChapters = 0;
  for (const chapter of chapters) {
    const chapterResult = await db.execute(
      `INSERT INTO chapter
           (novel_id, path, name, position, chapter_number, page, release_time, content_type, content, content_bytes, is_downloaded, created_at, found_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, unixepoch(), unixepoch())
         ON CONFLICT(novel_id, path) DO UPDATE SET
           name           = excluded.name,
           position       = excluded.position,
           chapter_number = excluded.chapter_number,
           page           = excluded.page,
           release_time   = excluded.release_time,
           content_type   = excluded.content_type,
           content        = excluded.content,
           content_bytes  = excluded.content_bytes,
           is_downloaded  = 1,
           updated_at     = unixepoch()
          WHERE
            name IS NOT excluded.name
            OR position IS NOT excluded.position
            OR chapter_number IS NOT excluded.chapter_number
            OR page IS NOT excluded.page
            OR release_time IS NOT excluded.release_time
            OR content_type IS NOT excluded.content_type
            OR content IS NOT excluded.content
            OR content_bytes IS NOT excluded.content_bytes
            OR is_downloaded IS NOT 1`,
      [
        novelId,
        chapter.path,
        chapter.name,
        chapter.position,
        chapter.chapterNumber ?? null,
        chapter.page ?? "1",
        chapter.releaseTime ?? null,
        normalizeChapterContentType(chapter.contentType),
        chapter.content,
        chapter.contentBytes,
      ],
    );
    if (chapterResult.rowsAffected > 0) changedChapters += 1;
  }

  await db.execute(
    `UPDATE novel
       SET updated_at = unixepoch()
       WHERE id = $1`,
    [novelId],
  );
  return {
    changed: changedChapters > 0,
    changedChapters,
    novelId,
    chapterCount: chapters.length,
  };
}

export async function reorderLocalNovelChapters(
  novelId: number,
  chapterIds: number[],
): Promise<void> {
  const db = await getDb();
  const novelRows = await db.select<{ id: number }[]>(
    `SELECT id FROM novel WHERE id = $1 AND plugin_id = $2 AND is_local = 1`,
    [novelId, LOCAL_PLUGIN_ID],
  );
  if (!novelRows[0]) {
    throw new Error("local novel: target novel is not local");
  }

  const chapterRows = await db.select<{ id: number }[]>(
    `SELECT id FROM chapter
     WHERE novel_id = $1
     ORDER BY position`,
    [novelId],
  );
  const existingChapterIds = chapterRows.map((chapter) => chapter.id);
  const requestedChapterIds = new Set(chapterIds);
  if (
    requestedChapterIds.size !== chapterIds.length ||
    existingChapterIds.length !== chapterIds.length ||
    existingChapterIds.some((chapterId) => !requestedChapterIds.has(chapterId))
  ) {
    throw new Error("local novel: reorder ids must match existing chapters");
  }

  const existingPositionById = new Map(
    existingChapterIds.map((chapterId, index) => [chapterId, index + 1]),
  );
  const changedEntries = chapterIds
    .map((chapterId, index) => ({ chapterId, position: index + 1 }))
    .filter(
      ({ chapterId, position }) =>
        existingPositionById.get(chapterId) !== position,
    );
  if (changedEntries.length === 0) return;

  const requestedValuesSql = changedEntries
    .map((_, index) => {
      const idParam = index * 2 + 1;
      const positionParam = idParam + 1;
      return `($${idParam}, $${positionParam})`;
    })
    .join(", ");
  const novelIdParam = changedEntries.length * 2 + 1;
  const params = changedEntries.flatMap(({ chapterId, position }) => [
    chapterId,
    position,
  ]);
  const result = await db.execute(
    `WITH requested(id, position) AS (VALUES ${requestedValuesSql})
     UPDATE chapter
     SET
       position = (
         SELECT requested.position
         FROM requested
         WHERE requested.id = chapter.id
       ),
       updated_at = unixepoch()
     WHERE novel_id = $${novelIdParam}
       AND id IN (SELECT id FROM requested)
       AND position IS NOT (
         SELECT requested.position
         FROM requested
         WHERE requested.id = chapter.id
       )`,
    [...params, novelId],
  );
  if (result.rowsAffected !== changedEntries.length) {
    throw new Error("local novel: failed to update chapter order");
  }
}

export async function upsertLocalNovel(
  input: LocalNovelImportInput,
): Promise<LocalNovelImportResult> {
  const db = await getDb();
  const novelResult = await db.execute(
    `INSERT INTO novel
         (plugin_id, path, name, cover, summary, author, artist, status, genres, in_library, is_local, library_added_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1, 1, unixepoch())
       ON CONFLICT(plugin_id, path) DO UPDATE SET
         name             = excluded.name,
         cover            = excluded.cover,
         summary          = excluded.summary,
         author           = excluded.author,
         artist           = excluded.artist,
         status           = excluded.status,
         genres           = excluded.genres,
         in_library       = 1,
         is_local         = 1,
         library_added_at = COALESCE(library_added_at, unixepoch()),
         updated_at       = unixepoch()
        WHERE
          name IS NOT excluded.name
          OR cover IS NOT excluded.cover
          OR summary IS NOT excluded.summary
          OR author IS NOT excluded.author
          OR artist IS NOT excluded.artist
          OR status IS NOT excluded.status
          OR genres IS NOT excluded.genres
          OR in_library IS NOT 1
          OR is_local IS NOT 1
          OR library_added_at IS NULL`,
    [
      LOCAL_PLUGIN_ID,
      input.path,
      input.name,
      nullableLocalCover(input.cover),
      input.summary ?? null,
      input.author ?? null,
      input.artist ?? null,
      input.status ?? null,
      input.genres ?? null,
    ],
  );

  const rows = await db.select<{ id: number }[]>(
    `SELECT id FROM novel WHERE plugin_id = $1 AND path = $2`,
    [LOCAL_PLUGIN_ID, input.path],
  );
  const novelId = rows[0]?.id;
  if (!novelId) {
    throw new Error("local import: failed to resolve local novel id");
  }

  let changedChapters = 0;
  for (const chapter of input.chapters) {
    const chapterResult = await db.execute(
      `INSERT INTO chapter
           (novel_id, path, name, position, chapter_number, page, release_time, content_type, content, content_bytes, is_downloaded, created_at, found_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, unixepoch(), unixepoch())
         ON CONFLICT(novel_id, path) DO UPDATE SET
           name           = excluded.name,
           position       = excluded.position,
           chapter_number = excluded.chapter_number,
           page           = excluded.page,
           release_time   = excluded.release_time,
           content_type   = excluded.content_type,
           content        = excluded.content,
           content_bytes  = excluded.content_bytes,
           is_downloaded  = 1,
           updated_at     = unixepoch()
          WHERE
            name IS NOT excluded.name
            OR position IS NOT excluded.position
            OR chapter_number IS NOT excluded.chapter_number
            OR page IS NOT excluded.page
            OR release_time IS NOT excluded.release_time
            OR content_type IS NOT excluded.content_type
            OR content IS NOT excluded.content
            OR content_bytes IS NOT excluded.content_bytes
            OR is_downloaded IS NOT 1`,
      [
        novelId,
        chapter.path,
        chapter.name,
        chapter.position,
        chapter.chapterNumber ?? null,
        chapter.page ?? "1",
        chapter.releaseTime ?? null,
        normalizeChapterContentType(chapter.contentType),
        chapter.content,
        chapter.contentBytes,
      ],
    );
    if (chapterResult.rowsAffected > 0) changedChapters += 1;
  }

  return {
    changed: novelResult.rowsAffected > 0 || changedChapters > 0,
    changedChapters,
    novelId,
    chapterCount: input.chapters.length,
  };
}
