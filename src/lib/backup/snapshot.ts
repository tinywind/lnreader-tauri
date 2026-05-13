import { invoke } from "@tauri-apps/api/core";
import { getDb, runExclusiveDatabaseOperation } from "../../db/client";
import { normalizeChapterContentType } from "../chapter-content";
import { isTauriRuntime } from "../tauri-runtime";
import {
  BACKUP_FORMAT_VERSION,
  encodeBackupManifest,
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
 * SQLite stores booleans as 0/1 integers; some older app paths also wrote
 * string boolean values. The format-side type guards (`isNovel`, `isChapter`,
 * ...) require strict booleans, so gather coerces every flag column on the way
 * out.
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
  inLibrary: unknown;
  isLocal: unknown;
  createdAt: number;
  updatedAt: number;
  libraryAddedAt: number | null;
  lastReadAt: number | null;
}

const LOCAL_PLUGIN_ID = "local";

function sqliteBoolean(value: unknown): boolean {
  if (value === true || value === 1) return true;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true";
  }
  return false;
}

function isLocalNovel(pluginId: string, value: unknown): boolean {
  return pluginId === LOCAL_PLUGIN_ID && sqliteBoolean(value);
}

interface RawChapterRow {
  id: number;
  novelId: number;
  path: string;
  name: string;
  chapterNumber: string | null;
  position: number;
  page: string;
  bookmark: unknown;
  unread: unknown;
  progress: number;
  isDownloaded: unknown;
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
    lang,
    version,
    icon_url    AS iconUrl,
    source_url  AS sourceUrl,
    source_code AS sourceCode,
    installed_at AS installedAt
  FROM installed_plugin
  ORDER BY installed_at DESC, id ASC
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
    inLibrary: sqliteBoolean(row.inLibrary),
    isLocal: isLocalNovel(row.pluginId, row.isLocal),
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
    bookmark: sqliteBoolean(row.bookmark),
    unread: sqliteBoolean(row.unread),
    progress: row.progress,
    isDownloaded: sqliteBoolean(row.isDownloaded),
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
  manifest: BackupManifest,
  files: readonly BackupChapterMediaFile[],
): Promise<void> {
  if (files.length === 0) return;
  if (!isTauriRuntime()) return;

  const chaptersById = new Map(
    manifest.chapters.map((chapter) => [chapter.id, chapter]),
  );
  const novelsById = new Map(manifest.novels.map((novel) => [novel.id, novel]));

  await invoke("chapter_media_clear_all");
  for (const file of files) {
    const { cacheKey, chapterId, fileName } = parseBackupChapterMediaSource(
      file.mediaSrc,
    );
    const chapter = chaptersById.get(chapterId);
    const novel = chapter ? novelsById.get(chapter.novelId) : undefined;
    await invoke("chapter_media_store", {
      body: file.body,
      cacheKey,
      chapterId,
      ...(chapter?.name ? { chapterName: chapter.name } : {}),
      ...(chapter?.chapterNumber
        ? { chapterNumber: chapter.chapterNumber }
        : {}),
      ...(chapter ? { chapterPosition: chapter.position } : {}),
      fileName,
      ...(chapter ? { novelId: chapter.novelId } : {}),
      ...(novel ? { novelName: novel.name } : {}),
      ...(novel ? { novelPath: novel.path } : {}),
      ...(novel ? { sourceId: novel.pluginId } : {}),
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
    lang: row.lang,
    version: row.version,
    iconUrl: row.iconUrl,
    sourceUrl: row.sourceUrl,
    sourceCode: row.sourceCode,
    installedAt: row.installedAt,
  };
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
  const mediaBytesByChapterId = hasBackupChapterMediaFiles(manifest)
    ? getBackupChapterMediaBytesByChapterId(
        getBackupChapterMediaFiles(manifest),
      )
    : new Map<number, number>();

  await getDb();
  await runExclusiveDatabaseOperation(() =>
    invoke("backup_restore_snapshot", {
      manifestJson: encodeBackupManifest(manifest),
      mediaBytesByChapterId: Object.fromEntries(mediaBytesByChapterId),
    }),
  );

  if (hasBackupChapterMediaFiles(manifest)) {
    await restoreBackupChapterMediaFiles(
      manifest,
      getBackupChapterMediaFiles(manifest),
    );
  }

  if (manifest.settings !== undefined) {
    writeBackupSettings(manifest.settings);
  }
}
