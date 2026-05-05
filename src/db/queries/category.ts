import { getDb } from "../client";

export interface LibraryCategory {
  id: number;
  name: string;
  sort: number;
  isSystem: boolean;
}

export async function listCategories(): Promise<LibraryCategory[]> {
  const db = await getDb();
  return db.select<LibraryCategory[]>(`
    SELECT
      id,
      name,
      sort,
      is_system AS isSystem
    FROM category
    ORDER BY sort, name
  `);
}

export interface InsertCategoryInput {
  name: string;
  sort?: number;
}

export async function insertCategory(input: InsertCategoryInput): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO category (name, sort, is_system) VALUES ($1, $2, 0)`,
    [input.name, input.sort ?? 0],
  );
}
