import { getDb } from "../../db/client";
import {
  BACKUP_FORMAT_VERSION,
  type BackupCategory,
  type BackupChapter,
  type BackupManifest,
  type BackupNovel,
  type BackupNovelCategory,
  type BackupRepository,
} from "./format";

/**
 * SQLite stores booleans as 0/1 integers; raw `select` returns those
 * verbatim. The format-side type guards (`isNovel`, `isChapter`, ...)
 * require strict booleans, so gather coerces every flag column on
 * the way out. Insert callers pass real `boolean` values back in —
 * `tauri-plugin-sql` handles the 0/1 round trip.
 */

interface RawNovelRow {
  id: number;
  pluginId: string;
  path: string;
  name: string;
  cover: string | null;
  summary: string | null;
  author: string | null;
  artist: string | null;
  status: string | null;
  genres: string | null;
  inLibrary: number;
  isLocal: number;
  createdAt: number;
  updatedAt: number;
  lastReadAt: number | null;
}

interface RawChapterRow {
  id: number;
  novelId: number;
  path: string;
  name: string;
  chapterNumber: string | null;
  position: number;
  page: string;
  bookmark: number;
  unread: number;
  progress: number;
  isDownloaded: number;
  content: string | null;
  releaseTime: string | null;
  readAt: number | null;
  updatedAt: number;
}

interface RawCategoryRow {
  id: number;
  name: string;
  sort: number;
  isSystem: number;
}

const SELECT_NOVELS = `
  SELECT
    id,
    plugin_id      AS pluginId,
    path,
    name,
    cover,
    summary,
    author,
    artist,
    status,
    genres,
    in_library     AS inLibrary,
    is_local       AS isLocal,
    created_at     AS createdAt,
    updated_at     AS updatedAt,
    last_read_at   AS lastReadAt
  FROM novel
  ORDER BY id
`;

const SELECT_CHAPTERS = `
  SELECT
    id,
    novel_id       AS novelId,
    path,
    name,
    chapter_number AS chapterNumber,
    position,
    page,
    bookmark,
    unread,
    progress,
    is_downloaded  AS isDownloaded,
    content,
    release_time   AS releaseTime,
    read_at        AS readAt,
    updated_at     AS updatedAt
  FROM chapter
  ORDER BY id
`;

const SELECT_CATEGORIES = `
  SELECT id, name, sort, is_system AS isSystem
  FROM category
  ORDER BY id
`;

const SELECT_NOVEL_CATEGORIES = `
  SELECT id, novel_id AS novelId, category_id AS categoryId
  FROM novel_category
  ORDER BY id
`;

const SELECT_REPOSITORIES = `
  SELECT id, url, name, added_at AS addedAt
  FROM repository
  ORDER BY id
`;

const INSERT_NOVEL = `
  INSERT INTO novel (
    id, plugin_id, path, name, cover, summary, author, artist,
    status, genres, in_library, is_local,
    created_at, updated_at, last_read_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
`;

const INSERT_CHAPTER = `
  INSERT INTO chapter (
    id, novel_id, path, name, chapter_number, position, page,
    bookmark, unread, progress, is_downloaded, content,
    release_time, read_at, updated_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
`;

const INSERT_CATEGORY = `
  INSERT INTO category (id, name, sort, is_system) VALUES ($1, $2, $3, $4)
`;

const INSERT_NOVEL_CATEGORY = `
  INSERT INTO novel_category (id, novel_id, category_id) VALUES ($1, $2, $3)
`;

const INSERT_REPOSITORY = `
  INSERT INTO repository (id, url, name, added_at) VALUES ($1, $2, $3, $4)
`;

function toNovel(row: RawNovelRow): BackupNovel {
  return {
    id: row.id,
    pluginId: row.pluginId,
    path: row.path,
    name: row.name,
    cover: row.cover,
    summary: row.summary,
    author: row.author,
    artist: row.artist,
    status: row.status,
    genres: row.genres,
    inLibrary: !!row.inLibrary,
    isLocal: !!row.isLocal,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastReadAt: row.lastReadAt,
  };
}

function toChapter(row: RawChapterRow): BackupChapter {
  return {
    id: row.id,
    novelId: row.novelId,
    path: row.path,
    name: row.name,
    chapterNumber: row.chapterNumber,
    position: row.position,
    page: row.page,
    bookmark: !!row.bookmark,
    unread: !!row.unread,
    progress: row.progress,
    isDownloaded: !!row.isDownloaded,
    content: row.content,
    releaseTime: row.releaseTime,
    readAt: row.readAt,
    updatedAt: row.updatedAt,
  };
}

function toCategory(row: RawCategoryRow): BackupCategory {
  return {
    id: row.id,
    name: row.name,
    sort: row.sort,
    isSystem: !!row.isSystem,
  };
}

/**
 * Read every row from the 5 backup-relevant tables and return a
 * fresh `BackupManifest` ready to feed `encodeBackupManifest` and
 * `packBackup`.
 */
export async function gatherBackupSnapshot(): Promise<BackupManifest> {
  const db = await getDb();
  const [novels, chapters, categories, novelCategories, repositories] =
    await Promise.all([
      db.select<RawNovelRow[]>(SELECT_NOVELS),
      db.select<RawChapterRow[]>(SELECT_CHAPTERS),
      db.select<RawCategoryRow[]>(SELECT_CATEGORIES),
      db.select<BackupNovelCategory[]>(SELECT_NOVEL_CATEGORIES),
      db.select<BackupRepository[]>(SELECT_REPOSITORIES),
    ]);

  return {
    version: BACKUP_FORMAT_VERSION,
    exportedAt: Math.floor(Date.now() / 1000),
    novels: novels.map(toNovel),
    chapters: chapters.map(toChapter),
    categories: categories.map(toCategory),
    novelCategories,
    repositories,
  };
}

/**
 * Replace every row in the 5 backup-relevant tables with the values
 * carried by `manifest`. Destructive — call only after the user has
 * confirmed restore. v0.1 keeps it simple: delete all + insert all,
 * one statement at a time. v0.2 may wrap it in a transaction.
 */
export async function applyBackupSnapshot(
  manifest: BackupManifest,
): Promise<void> {
  const db = await getDb();

  // Wipe in dependent-first order so foreign-key cascades stay quiet.
  await db.execute("DELETE FROM novel_category");
  await db.execute("DELETE FROM chapter");
  await db.execute("DELETE FROM novel");
  await db.execute("DELETE FROM category");
  await db.execute("DELETE FROM repository");

  // Insert in parent-first order so foreign keys resolve.
  for (const cat of manifest.categories) {
    await db.execute(INSERT_CATEGORY, [
      cat.id,
      cat.name,
      cat.sort,
      cat.isSystem,
    ]);
  }
  for (const repo of manifest.repositories) {
    await db.execute(INSERT_REPOSITORY, [
      repo.id,
      repo.url,
      repo.name,
      repo.addedAt,
    ]);
  }
  for (const novel of manifest.novels) {
    await db.execute(INSERT_NOVEL, [
      novel.id,
      novel.pluginId,
      novel.path,
      novel.name,
      novel.cover,
      novel.summary,
      novel.author,
      novel.artist,
      novel.status,
      novel.genres,
      novel.inLibrary,
      novel.isLocal,
      novel.createdAt,
      novel.updatedAt,
      novel.lastReadAt,
    ]);
  }
  for (const chapter of manifest.chapters) {
    await db.execute(INSERT_CHAPTER, [
      chapter.id,
      chapter.novelId,
      chapter.path,
      chapter.name,
      chapter.chapterNumber,
      chapter.position,
      chapter.page,
      chapter.bookmark,
      chapter.unread,
      chapter.progress,
      chapter.isDownloaded,
      chapter.content,
      chapter.releaseTime,
      chapter.readAt,
      chapter.updatedAt,
    ]);
  }
  for (const link of manifest.novelCategories) {
    await db.execute(INSERT_NOVEL_CATEGORY, [
      link.id,
      link.novelId,
      link.categoryId,
    ]);
  }
}
