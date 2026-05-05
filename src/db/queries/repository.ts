import { getDb } from "../client";

export interface PluginRepository {
  id: number;
  url: string;
  name: string | null;
  addedAt: number;
}

export async function listRepositories(): Promise<PluginRepository[]> {
  const db = await getDb();
  return db.select<PluginRepository[]>(`
    SELECT
      id,
      url,
      name,
      added_at AS addedAt
    FROM repository
    ORDER BY added_at DESC, id DESC
  `);
}

export interface AddRepositoryInput {
  url: string;
  name?: string | null;
}

export async function addRepository(input: AddRepositoryInput): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT OR IGNORE INTO repository (url, name) VALUES ($1, $2)`,
    [input.url, input.name ?? null],
  );
}

export async function removeRepository(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(`DELETE FROM repository WHERE id = $1`, [id]);
}
