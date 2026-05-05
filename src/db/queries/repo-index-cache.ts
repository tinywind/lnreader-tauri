import { getDb } from "../client";
import type { PluginItem } from "../../lib/plugins/types";

export interface RepositoryIndexCacheRow {
  repoUrl: string;
  fetchedAt: number;
  items: PluginItem[];
}

interface RawRow {
  repoUrl: string;
  fetchedAt: number;
  itemsJson: string;
}

const SELECT_ONE = `
  SELECT
    repo_url    AS repoUrl,
    fetched_at  AS fetchedAt,
    items_json  AS itemsJson
  FROM repository_index_cache
  WHERE repo_url = $1
`;

const SELECT_ALL = `
  SELECT
    repo_url    AS repoUrl,
    fetched_at  AS fetchedAt,
    items_json  AS itemsJson
  FROM repository_index_cache
`;

function parseRow(row: RawRow): RepositoryIndexCacheRow {
  let items: PluginItem[];
  try {
    const parsed = JSON.parse(row.itemsJson);
    items = Array.isArray(parsed) ? (parsed as PluginItem[]) : [];
  } catch {
    items = [];
  }
  return {
    repoUrl: row.repoUrl,
    fetchedAt: row.fetchedAt,
    items,
  };
}

/** Returns the cached index for `repoUrl`, or null on miss. */
export async function getCachedRepoIndex(
  repoUrl: string,
): Promise<RepositoryIndexCacheRow | null> {
  const db = await getDb();
  const rows = await db.select<RawRow[]>(SELECT_ONE, [repoUrl]);
  const row = rows[0];
  return row ? parseRow(row) : null;
}

export async function listAllCachedRepoIndexes(): Promise<
  RepositoryIndexCacheRow[]
> {
  const db = await getDb();
  const rows = await db.select<RawRow[]>(SELECT_ALL);
  return rows.map(parseRow);
}

/** Upsert `items` under `repoUrl`, bumping fetched_at to now. */
export async function setCachedRepoIndex(
  repoUrl: string,
  items: readonly PluginItem[],
): Promise<void> {
  const db = await getDb();
  await db.execute(
    `INSERT INTO repository_index_cache (repo_url, items_json)
     VALUES ($1, $2)
     ON CONFLICT(repo_url) DO UPDATE SET
       items_json = excluded.items_json,
       fetched_at = unixepoch()`,
    [repoUrl, JSON.stringify(items)],
  );
}

export async function deleteCachedRepoIndex(repoUrl: string): Promise<void> {
  const db = await getDb();
  await db.execute(
    `DELETE FROM repository_index_cache WHERE repo_url = $1`,
    [repoUrl],
  );
}
