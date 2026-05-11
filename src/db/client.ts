import Database from "@tauri-apps/plugin-sql";

const DB_URL = "sqlite:norea.db";
const DB_BUSY_TIMEOUT_MS = 5000;
const DB_LOCK_RETRY_DELAYS_MS = [50, 100, 200, 400, 800, 1200, 1600];
const DB_LOCK_ERROR_PATTERN = /database is locked|SQLITE_BUSY|code:\s*5/i;

let dbPromise: Promise<Database> | null = null;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}

function isDatabaseLockedError(error: unknown): boolean {
  if (error instanceof Error) {
    return DB_LOCK_ERROR_PATTERN.test(error.message);
  }
  return DB_LOCK_ERROR_PATTERN.test(String(error));
}

async function configureDb(db: Database): Promise<Database> {
  await db.execute(`PRAGMA busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);
  return db;
}

/**
 * Singleton accessor for the SQLite database.
 *
 * The Rust-side `tauri-plugin-sql` registration in
 * `src-tauri/src/lib.rs` runs the bootstrap schema migration the first
 * time this URL is loaded.
 */
export function getDb(): Promise<Database> {
  if (!dbPromise) {
    dbPromise = Database.load(DB_URL).then(configureDb);
  }
  return dbPromise;
}

export async function beginImmediateTransaction(db: Database): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await db.execute("BEGIN IMMEDIATE");
      return;
    } catch (error) {
      const retryDelayMs = DB_LOCK_RETRY_DELAYS_MS[attempt];
      if (!isDatabaseLockedError(error) || retryDelayMs === undefined) {
        throw error;
      }
      await delay(retryDelayMs);
    }
  }
}
