import { getDb } from "../client";

function debugRepositoryQuery(message: string, data?: unknown): void {
  console.debug(`[repository-db] ${message}`, data);
}

export interface PluginRepository {
  id: number;
  url: string;
  name: string | null;
  addedAt: number;
}

export async function listRepositories(): Promise<PluginRepository[]> {
  const db = await getDb();
  const rows = await db.select<PluginRepository[]>(`
    SELECT
      id,
      url,
      name,
      added_at AS addedAt
    FROM repository
    ORDER BY id
  `);
  debugRepositoryQuery("list complete", { count: rows.length, rows });
  return rows;
}

export interface UpsertRepositoryInput {
  url: string;
  name?: string | null;
}

export async function upsertRepository(
  input: UpsertRepositoryInput,
): Promise<void> {
  debugRepositoryQuery("upsert start", {
    url: input.url,
    name: input.name ?? null,
  });
  const db = await getDb();
  debugRepositoryQuery("upsert repository start", { url: input.url });
  await db.execute(
    `INSERT INTO repository (id, url, name)
     VALUES (1, $1, $2)
     ON CONFLICT(id) DO UPDATE SET
       url = excluded.url,
       name = excluded.name,
       added_at = unixepoch()`,
    [input.url, input.name ?? null],
  );
  debugRepositoryQuery("upsert repository complete", { url: input.url });
  debugRepositoryQuery("delete stale cache start", { url: input.url });
  await db.execute(`DELETE FROM repository_index_cache`);
  debugRepositoryQuery("delete stale cache complete", { url: input.url });
}

export async function removeRepository(id: number): Promise<void> {
  debugRepositoryQuery("remove start", { id });
  const db = await getDb();
  debugRepositoryQuery("delete cache start", { id });
  await db.execute(
    `DELETE FROM repository_index_cache
     WHERE repo_url = (SELECT url FROM repository WHERE id = $1)`,
    [id],
  );
  debugRepositoryQuery("delete cache complete", { id });
  debugRepositoryQuery("delete repository start", { id });
  await db.execute(`DELETE FROM repository WHERE id = $1`, [id]);
  debugRepositoryQuery("delete repository complete", { id });
}
