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
    ORDER BY id
  `);
}

export interface AddRepositoryInput {
  url: string;
  name?: string | null;
}

export async function addRepository(input: AddRepositoryInput): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO repository (id, url, name)
     VALUES (1, $1, $2)
     ON CONFLICT(id) DO UPDATE SET
       url = excluded.url,
       name = excluded.name,
       added_at = unixepoch()`,
    [input.url, input.name ?? null],
  );
  await db.execute(
    `DELETE FROM repository_index_cache WHERE repo_url <> $1`,
    [input.url],
  );
}

export async function removeRepository(id: number): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM repository_index_cache
     WHERE repo_url = (SELECT url FROM repository WHERE id = $1)`,
    [id],
  );
  await db.execute(`DELETE FROM repository WHERE id = $1`, [id]);
}
