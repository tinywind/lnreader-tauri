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

export async function listLibraryNovels(): Promise<LibraryNovel[]> {
  const db = await getDb();
  return db.select<LibraryNovel[]>(`
    SELECT
      id,
      plugin_id    AS pluginId,
      path,
      name,
      cover,
      in_library   AS inLibrary,
      last_read_at AS lastReadAt
    FROM novel
    WHERE in_library = 1
    ORDER BY COALESCE(last_read_at, 0) DESC, name
  `);
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
