import Database from "@tauri-apps/plugin-sql";
import type { QueryResult } from "@tauri-apps/plugin-sql";

const DB_URL = "sqlite:norea.db";
const DB_BUSY_TIMEOUT_MS = 5000;

let dbPromise: Promise<Database> | null = null;
let rawDbPromise: Promise<Database> | null = null;
let dbOperationQueue: Promise<void> = Promise.resolve();

async function configureDb(db: Database): Promise<Database> {
  await db.execute(`PRAGMA busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);
  return db;
}

async function queueDbOperation<T>(run: () => Promise<T>): Promise<T> {
  let releaseQueue: () => void = () => undefined;
  const previousQueue = dbOperationQueue;
  const currentQueue = new Promise<void>((resolve) => {
    releaseQueue = resolve;
  });
  dbOperationQueue = previousQueue
    .catch(() => undefined)
    .then(() => currentQueue);

  await previousQueue.catch(() => undefined);
  try {
    return await run();
  } finally {
    releaseQueue();
  }
}

function serializedDb(rawDb: Database): Database {
  return {
    path: rawDb.path,
    execute(query: string, bindValues?: unknown[]): Promise<QueryResult> {
      return queueDbOperation(() => rawDb.execute(query, bindValues));
    },
    select<T>(query: string, bindValues?: unknown[]): Promise<T> {
      return queueDbOperation(() => rawDb.select<T>(query, bindValues));
    },
    close(db?: string): Promise<boolean> {
      return queueDbOperation(() => rawDb.close(db));
    },
  } as Database;
}

function getRawDb(): Promise<Database> {
  if (!rawDbPromise) {
    rawDbPromise = Database.load(DB_URL).then(configureDb);
  }
  return rawDbPromise;
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
    dbPromise = getRawDb().then(serializedDb);
  }
  return dbPromise;
}

export function runExclusiveDatabaseOperation<T>(
  run: () => Promise<T>,
): Promise<T> {
  return queueDbOperation(run);
}
