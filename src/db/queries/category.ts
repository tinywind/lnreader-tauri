import { getDb } from "../client";

export const UNCATEGORIZED_CATEGORY_ID = -1;

export interface LibraryCategory {
  id: number;
  name: string;
  sort: number;
  isSystem: boolean;
  novelCount: number;
}

export async function listCategories(): Promise<LibraryCategory[]> {
  const db = await getDb();
  const rows = await db.select<
    Array<Omit<LibraryCategory, "isSystem"> & { isSystem: number }>
  >(`
    SELECT
      c.id,
      c.name,
      c.sort,
      c.is_system AS isSystem,
      COUNT(DISTINCT n.id) AS novelCount
    FROM category c
    LEFT JOIN novel_category nc ON nc.category_id = c.id
    LEFT JOIN novel n ON n.id = nc.novel_id AND n.in_library = 1
    GROUP BY c.id, c.name, c.sort, c.is_system
    ORDER BY c.sort, c.name
  `);
  return rows.map((row) => ({
    ...row,
    isSystem: !!row.isSystem,
    novelCount: Number(row.novelCount),
  }));
}

export interface LibraryCategoryCounts {
  total: number;
  uncategorized: number;
}

export async function getLibraryCategoryCounts(): Promise<LibraryCategoryCounts> {
  const db = await getDb();
  const totalRows = await db.select<{ count: number }[]>(
    "SELECT COUNT(*) AS count FROM novel WHERE in_library = 1",
  );
  const uncategorizedRows = await db.select<{ count: number }[]>(`
    SELECT COUNT(*) AS count
    FROM novel n
    WHERE
      n.in_library = 1
      AND NOT EXISTS (
        SELECT 1
        FROM novel_category nc
        WHERE nc.novel_id = n.id
      )
  `);

  return {
    total: totalRows[0]?.count ?? 0,
    uncategorized: uncategorizedRows[0]?.count ?? 0,
  };
}

export interface InsertCategoryInput {
  name: string;
  sort?: number;
}

export async function insertCategory(input: InsertCategoryInput): Promise<void> {
  const db = await getDb();
  const name = normalizeCategoryName(input.name);
  await db.execute(
    `INSERT INTO category (name, sort, is_system)
     VALUES (
       $1,
       COALESCE($2, (SELECT COALESCE(MAX(sort), -1) + 1 FROM category)),
       0
     )`,
    [name, input.sort ?? null],
  );
}

export interface UpdateCategoryInput {
  name: string;
}

export async function updateCategory(
  id: number,
  input: UpdateCategoryInput,
): Promise<void> {
  assertManualCategoryId(id);
  const db = await getDb();
  const name = normalizeCategoryName(input.name);
  await db.execute(
    `UPDATE category
     SET name = $2
     WHERE id = $1 AND is_system = 0`,
    [id, name],
  );
}

export async function deleteCategory(id: number): Promise<void> {
  assertManualCategoryId(id);
  const db = await getDb();
  await db.execute("DELETE FROM category WHERE id = $1 AND is_system = 0", [
    id,
  ]);
}

export async function addNovelsToCategory(
  novelIds: readonly number[],
  categoryId: number,
): Promise<void> {
  assertManualCategoryId(categoryId);
  const uniqueNovelIds = Array.from(new Set(novelIds)).filter(
    (id) => Number.isInteger(id) && id > 0,
  );
  if (uniqueNovelIds.length === 0) return;

  const db = await getDb();
  const params = uniqueNovelIds.flatMap((novelId) => [novelId, categoryId]);
  const values = uniqueNovelIds
    .map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`)
    .join(", ");

  await db.execute(
    `INSERT OR IGNORE INTO novel_category (novel_id, category_id)
     VALUES ${values}`,
    params,
  );
}

function normalizeCategoryName(name: string): string {
  const trimmed = name.trim();
  if (trimmed === "") {
    throw new Error("Category name is required.");
  }
  return trimmed;
}

function assertManualCategoryId(id: number): void {
  if (!Number.isInteger(id) || id <= 0) {
    throw new Error("Select a manual category.");
  }
}
