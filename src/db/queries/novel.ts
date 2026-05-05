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
