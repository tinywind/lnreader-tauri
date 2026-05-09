import { invoke } from "@tauri-apps/api/core";
import { getDb } from "../../db/client";
import {
  DEFAULT_CHAPTER_CONTENT_TYPE,
  normalizeChapterContentType,
} from "../chapter-content";
import { isTauriRuntime } from "../tauri-runtime";
import {
  BACKUP_FORMAT_VERSION,
  type BackupCategory,
  type BackupChapter,
  type BackupInstalledPlugin,
  type BackupManifest,
  type BackupNovel,
  type BackupNovelCategory,
  type BackupRepository,
  type BackupSetting,
} from "./format";
import {
  getBackupChapterMediaFiles,
  hasBackupChapterMediaFiles,
  type BackupChapterMediaFile,
} from "./unpack";

/**
 * SQLite stores booleans as 0/1 integers; raw `select` returns those
 * verbatim. The format-side type guards (`isNovel`, `isChapter`, ...)
 * require strict booleans, so gather coerces every flag column on
 * the way out. Insert callers pass real `boolean` values back in;
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
  libraryAddedAt: number | null;
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
  contentType: string;
  content: string | null;
  mediaBytes: number;
  releaseTime: string | null;
  readAt: number | null;
  createdAt: number;
  foundAt: number;
  updatedAt: number;
}

interface RawCategoryRow {
  id: number;
  name: string;
  sort: number;
  isSystem: number;
}

interface RawInstalledPluginRow {
  id: string;
  name: string;
  site: string;
  lang: string;
  version: string;
  iconUrl: string;
  sourceUrl: string;
  sourceCode: string;
  installedAt: number;
}

const BACKUP_SETTING_KEYS = new Set([
  "app-appearance-settings",
  "app-notification-settings",
  "browse-plugin-settings",
  "http-user-agent",
  "norea-library-settings",
  "reader-settings",
]);

const BACKUP_SETTING_PREFIXES = ["plugin:", "source-filters:"];
const LOCAL_CHAPTER_MEDIA_SRC_PATTERN =
  /^norea-media:\/\/chapter\/([1-9]\d*)\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/;

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
    library_added_at AS libraryAddedAt,
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
    content_type   AS contentType,
    content,
    media_bytes    AS mediaBytes,
    release_time   AS releaseTime,
    read_at        AS readAt,
    COALESCE(created_at, updated_at) AS createdAt,
    found_at       AS foundAt,
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

const SELECT_INSTALLED_PLUGINS = `
  SELECT
    id,
    name,
    site,
    lang,
    version,
    icon_url    AS iconUrl,
    source_url  AS sourceUrl,
    source_code AS sourceCode,
    installed_at AS installedAt
  FROM installed_plugin
  ORDER BY installed_at DESC, id ASC
`;

const INSERT_NOVEL = `
  INSERT INTO novel (
    id, plugin_id, path, name, cover, summary, author, artist,
    status, genres, in_library, is_local,
    created_at, updated_at, library_added_at, last_read_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
`;

const INSERT_CHAPTER = `
  INSERT INTO chapter (
    id, novel_id, path, name, chapter_number, position, page,
    bookmark, unread, progress, is_downloaded, content, content_bytes,
    media_bytes, content_type, release_time, read_at, created_at, found_at, updated_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
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

const INSERT_INSTALLED_PLUGIN = `
  INSERT INTO installed_plugin (
    id, name, site, lang, version, icon_url, source_url, source_code, installed_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
`;

function browserLocalStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function isBackupSettingKey(key: string): boolean {
  return (
    BACKUP_SETTING_KEYS.has(key) ||
    BACKUP_SETTING_PREFIXES.some((prefix) => key.startsWith(prefix))
  );
}

function readBackupSettings(): BackupSetting[] {
  const storage = browserLocalStorage();
  if (!storage) return [];

  const settings: BackupSetting[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key || !isBackupSettingKey(key)) continue;
    const value = storage.getItem(key);
    if (value !== null) settings.push({ key, value });
  }
  return settings.sort((left, right) => left.key.localeCompare(right.key));
}

function clearBackupSettings(storage: Storage): void {
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && isBackupSettingKey(key)) keys.push(key);
  }
  for (const key of keys) storage.removeItem(key);
}

function writeBackupSettings(settings: readonly BackupSetting[]): void {
  const storage = browserLocalStorage();
  if (!storage) return;

  clearBackupSettings(storage);
  for (const setting of settings) {
    if (isBackupSettingKey(setting.key)) {
      storage.setItem(setting.key, setting.value);
    }
  }
}

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
    libraryAddedAt: row.libraryAddedAt,
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
    contentType: normalizeChapterContentType(row.contentType),
    content: row.content,
    mediaBytes: row.mediaBytes,
    releaseTime: row.releaseTime,
    readAt: row.readAt,
    createdAt: row.createdAt,
    foundAt: row.foundAt,
    updatedAt: row.updatedAt,
  };
}

function getUtf8ByteLength(value: string | null): number {
  return value === null ? 0 : new TextEncoder().encode(value).byteLength;
}

function getBackupChapterMediaBytesByChapterId(
  files: readonly BackupChapterMediaFile[],
): Map<number, number> {
  const bytesByChapterId = new Map<number, number>();
  for (const file of files) {
    const { chapterId } = parseBackupChapterMediaSource(file.mediaSrc);
    bytesByChapterId.set(
      chapterId,
      (bytesByChapterId.get(chapterId) ?? 0) + file.body.length,
    );
  }
  return bytesByChapterId;
}

function parseBackupChapterMediaSource(mediaSrc: string): {
  cacheKey: string;
  chapterId: number;
  fileName: string;
} {
  const match = LOCAL_CHAPTER_MEDIA_SRC_PATTERN.exec(mediaSrc);
  if (!match) {
    throw new Error(`Invalid backup chapter media reference: ${mediaSrc}`);
  }
  return {
    chapterId: Number.parseInt(match[1]!, 10),
    cacheKey: match[2]!,
    fileName: match[3]!,
  };
}

async function restoreBackupChapterMediaFiles(
  files: readonly BackupChapterMediaFile[],
): Promise<void> {
  if (!isTauriRuntime()) return;

  await invoke("chapter_media_clear_all");
  for (const file of files) {
    const { cacheKey, chapterId, fileName } = parseBackupChapterMediaSource(
      file.mediaSrc,
    );
    await invoke("chapter_media_store", {
      body: file.body,
      cacheKey,
      chapterId,
      fileName,
    });
  }
}

function toCategory(row: RawCategoryRow): BackupCategory {
  return {
    id: row.id,
    name: row.name,
    sort: row.sort,
    isSystem: !!row.isSystem,
  };
}

function toInstalledPlugin(row: RawInstalledPluginRow): BackupInstalledPlugin {
  return {
    id: row.id,
    name: row.name,
    site: row.site,
    lang: row.lang,
    version: row.version,
    iconUrl: row.iconUrl,
    sourceUrl: row.sourceUrl,
    sourceCode: row.sourceCode,
    installedAt: row.installedAt,
  };
}

function selectBackupRepository(
  repositories: readonly BackupRepository[],
): BackupRepository | null {
  return (
    [...repositories].sort(
      (a, b) => b.addedAt - a.addedAt || b.id - a.id,
    )[0] ?? null
  );
}

/**
 * Read every row from the backup-relevant tables and return a
 * fresh `BackupManifest` ready to feed `encodeBackupManifest` and
 * `packBackup`.
 */
export async function gatherBackupSnapshot(): Promise<BackupManifest> {
  const db = await getDb();
  const [
    novels,
    chapters,
    categories,
    novelCategories,
    repositories,
    installedPlugins,
  ] =
    await Promise.all([
      db.select<RawNovelRow[]>(SELECT_NOVELS),
      db.select<RawChapterRow[]>(SELECT_CHAPTERS),
      db.select<RawCategoryRow[]>(SELECT_CATEGORIES),
      db.select<BackupNovelCategory[]>(SELECT_NOVEL_CATEGORIES),
      db.select<BackupRepository[]>(SELECT_REPOSITORIES),
      db.select<RawInstalledPluginRow[]>(SELECT_INSTALLED_PLUGINS),
    ]);

  return {
    version: BACKUP_FORMAT_VERSION,
    exportedAt: Math.floor(Date.now() / 1000),
    novels: novels.map(toNovel),
    chapters: chapters.map(toChapter),
    categories: categories.map(toCategory),
    novelCategories,
    repositories,
    installedPlugins: installedPlugins.map(toInstalledPlugin),
    settings: readBackupSettings(),
  };
}

/**
 * Replace every row in the backup-relevant tables with the values
 * carried by `manifest`. Destructive; call only after the user has
 * confirmed restore. Database changes are wrapped in a transaction,
 * then browser settings are replaced after the commit succeeds.
 */
export async function applyBackupSnapshot(
  manifest: BackupManifest,
): Promise<void> {
  const db = await getDb();
  const mediaBytesByChapterId = hasBackupChapterMediaFiles(manifest)
    ? getBackupChapterMediaBytesByChapterId(
        getBackupChapterMediaFiles(manifest),
      )
    : new Map<number, number>();

  await db.execute("BEGIN IMMEDIATE");
  try {
    // Wipe in dependent-first order so foreign-key cascades stay quiet.
    await db.execute("DELETE FROM novel_category");
    await db.execute("DELETE FROM chapter");
    await db.execute("DELETE FROM novel_stats");
    await db.execute("DELETE FROM novel");
    await db.execute("DELETE FROM category");
    await db.execute("DELETE FROM repository");
    await db.execute("DELETE FROM repository_index_cache");
    if (manifest.installedPlugins !== undefined) {
      await db.execute("DELETE FROM installed_plugin");
    }

    // Insert in parent-first order so foreign keys resolve.
    for (const cat of manifest.categories) {
      await db.execute(INSERT_CATEGORY, [
        cat.id,
        cat.name,
        cat.sort,
        cat.isSystem,
      ]);
    }
    const repo = selectBackupRepository(manifest.repositories);
    if (repo) {
      await db.execute(INSERT_REPOSITORY, [
        1,
        repo.url,
        repo.name,
        repo.addedAt,
      ]);
    }
    if (manifest.installedPlugins !== undefined) {
      for (const plugin of manifest.installedPlugins) {
        await db.execute(INSERT_INSTALLED_PLUGIN, [
          plugin.id,
          plugin.name,
          plugin.site,
          plugin.lang,
          plugin.version,
          plugin.iconUrl,
          plugin.sourceUrl,
          plugin.sourceCode,
          plugin.installedAt,
        ]);
      }
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
        novel.libraryAddedAt,
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
        getUtf8ByteLength(chapter.content),
        mediaBytesByChapterId.get(chapter.id) ?? chapter.mediaBytes ?? 0,
        normalizeChapterContentType(
          chapter.contentType ?? DEFAULT_CHAPTER_CONTENT_TYPE,
        ),
        chapter.releaseTime,
        chapter.readAt,
        chapter.createdAt,
        chapter.foundAt,
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
    await db.execute("COMMIT");
  } catch (error) {
    await db.execute("ROLLBACK").catch(() => undefined);
    throw error;
  }

  if (hasBackupChapterMediaFiles(manifest)) {
    await restoreBackupChapterMediaFiles(getBackupChapterMediaFiles(manifest));
  }

  if (manifest.settings !== undefined) {
    writeBackupSettings(manifest.settings);
  }
}
