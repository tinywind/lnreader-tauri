import { getDb } from "../client";
import type { LibrarySortOrder } from "../../store/library";

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
  /** Restrict to novels assigned to this category. `null` and undefined include all. */
  categoryId?: number | null;
  downloadedOnly?: boolean;
  sortOrder?: LibrarySortOrder;
}

interface RawLibraryNovel extends Omit<LibraryNovel, "inLibrary" | "isLocal"> {
  inLibrary: number;
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
  if (filter.categoryId != null) {
    params.push(filter.categoryId);
    conditions.push(
      `EXISTS (SELECT 1 FROM novel_category nc WHERE nc.novel_id = n.id AND nc.category_id = $${params.length})`,
    );
  }
  if (filter.downloadedOnly) {
    conditions.push(
      `(n.is_local = 1 OR EXISTS (SELECT 1 FROM chapter dc WHERE dc.novel_id = n.id AND dc.is_downloaded = 1))`,
    );
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
      COUNT(c.id) AS totalChapters,
      COALESCE(SUM(CASE WHEN c.is_downloaded = 1 THEN 1 ELSE 0 END), 0)
        AS chaptersDownloaded,
      COALESCE(SUM(CASE WHEN c.unread = 1 THEN 1 ELSE 0 END), 0)
        AS chaptersUnread,
      COALESCE(
        ROUND(AVG(
          CASE
            WHEN c.id IS NULL THEN NULL
            WHEN c.progress >= 100 THEN 100
            WHEN c.progress < 0 THEN 0
            WHEN c.progress > 100 THEN 100
            ELSE c.progress
          END
        )),
        0
      ) AS readingProgress,
      n.last_read_at AS lastReadAt,
      MAX(COALESCE(c.updated_at, n.updated_at)) AS lastUpdatedAt
    FROM novel n
    LEFT JOIN chapter c ON c.novel_id = n.id
    WHERE ${conditions.join(" AND ")}
    GROUP BY
      n.id,
      n.plugin_id,
      n.path,
      n.name,
      n.cover,
      n.author,
      n.in_library,
      n.is_local,
      n.last_read_at,
      n.updated_at
    ORDER BY ${orderBy}, n.name COLLATE NOCASE ASC
  `;

  const rows = await db.select<RawLibraryNovel[]>(sql, params);
  return rows.map((row) => ({
    ...row,
    inLibrary: !!row.inLibrary,
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

const SELECT_NOVEL_DETAIL = `
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
  WHERE id = $1
`;

export async function getNovelById(
  id: number,
): Promise<NovelDetailRecord | null> {
  const db = await getDb();
  const rows = await db.select<RawNovelDetail[]>(SELECT_NOVEL_DETAIL, [id]);
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    inLibrary: !!row.inLibrary,
    isLocal: !!row.isLocal,
  };
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
  await db.execute(
    `UPDATE novel
     SET
       in_library = $2,
       library_added_at = CASE WHEN $2 = 1 THEN unixepoch() ELSE NULL END,
       updated_at = unixepoch()
     WHERE id = $1`,
    [id, inLibrary ? 1 : 0],
  );
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

export async function insertNovel(input: InsertNovelInput): Promise<void> {
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
