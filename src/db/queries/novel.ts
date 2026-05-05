import { getDb } from "../client";

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
  inLibrary: boolean;
  lastReadAt: number | null;
}

export interface LibraryFilter {
  /** Case-insensitive substring match against `name`. Empty/blank → ignored. */
  search?: string;
  /** Restrict to novels assigned to this category. `null`/undefined → all. */
  categoryId?: number | null;
}

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

  const sql = `
    SELECT
      n.id,
      n.plugin_id    AS pluginId,
      n.path,
      n.name,
      n.cover,
      n.in_library   AS inLibrary,
      n.last_read_at AS lastReadAt
    FROM novel n
    WHERE ${conditions.join(" AND ")}
    ORDER BY COALESCE(n.last_read_at, 0) DESC, n.name
  `;

  return db.select<LibraryNovel[]>(sql, params);
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
     SET in_library = $2, updated_at = unixepoch()
     WHERE id = $1`,
    [id, inLibrary],
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
  await db.execute(
    `INSERT OR IGNORE INTO novel (plugin_id, path, name, cover, in_library)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      input.pluginId,
      input.path,
      input.name,
      input.cover ?? null,
      input.inLibrary ?? true,
    ],
  );
}
