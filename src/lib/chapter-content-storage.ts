import { invoke } from "@tauri-apps/api/core";
import { getDb } from "../db/client";
import {
  deleteAndroidStoragePath,
  readAndroidStorageText,
  writeAndroidStorageText,
} from "./android-storage";
import {
  DEFAULT_CHAPTER_CONTENT_TYPE,
  normalizeChapterContentType,
} from "./chapter-content";
import { getStoredChapterMediaBytes } from "./chapter-media";
import {
  chapterContentRelativePath as buildChapterContentRelativePath,
  type ChapterStorageChapterPathInput,
  type ChapterStorageNovelPathInput,
} from "./chapter-storage-path";
import { isAndroidRuntime, isTauriRuntime } from "./tauri-runtime";

interface ChapterStorageRow {
  artist: string | null;
  author: string | null;
  bookmark: unknown;
  chapterCreatedAt: number | null;
  chapterFoundAt: number;
  chapterId: number;
  chapterName: string;
  chapterNumber: string | null;
  chapterPath: string;
  chapterUpdatedAt: number;
  content: string | null;
  contentBytes: number;
  contentType: string;
  cover: string | null;
  genres: string | null;
  inLibrary: unknown;
  isLocal: unknown;
  lastReadAt: number | null;
  libraryAddedAt: number | null;
  mediaBytes: number;
  novelCreatedAt: number;
  novelId: number;
  novelName: string;
  novelPath: string;
  novelUpdatedAt: number;
  page: string;
  pluginId: string;
  position: number;
  progress: number;
  readAt: number | null;
  releaseTime: string | null;
  status: string | null;
  summary: string | null;
  unread: unknown;
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

interface MirroredNovel {
  artist: string | null;
  author: string | null;
  cover: string | null;
  createdAt: number;
  genres: string | null;
  id: number;
  inLibrary: boolean;
  isLocal: boolean;
  lastReadAt: number | null;
  libraryAddedAt: number | null;
  name: string;
  path: string;
  pluginId: string;
  status: string | null;
  summary: string | null;
  updatedAt: number;
}

interface MirroredChapter {
  bookmark: boolean;
  chapterNumber: string | null;
  content?: string;
  contentBytes: number;
  contentFile?: string;
  contentType?: string;
  createdAt: number | null;
  foundAt: number;
  id: number;
  isDownloaded: boolean;
  mediaBytes: number;
  name: string;
  novelId: number;
  page: string;
  path: string;
  position: number;
  progress: number;
  readAt: number | null;
  releaseTime: string | null;
  unread: boolean;
  updatedAt: number;
}

interface MirroredStorageManifest {
  chapters?: Record<string, MirroredChapter>;
  novels?: Record<string, MirroredNovel>;
}

export interface ChapterStorageRestoreResult {
  chapters: number;
  novels: number;
}

export interface ChapterStorageRestoreOptions {
  chapterIds?: ReadonlySet<number>;
  contentOnly?: boolean;
}

const SELECT_CHAPTER_STORAGE_ROW = `
  SELECT
    c.id             AS chapterId,
    c.novel_id       AS novelId,
    c.path           AS chapterPath,
    c.name           AS chapterName,
    c.chapter_number AS chapterNumber,
    c.position,
    c.page,
    c.bookmark,
    c.unread,
    c.progress,
    c.content,
    c.content_type   AS contentType,
    c.content_bytes  AS contentBytes,
    c.media_bytes    AS mediaBytes,
    c.release_time   AS releaseTime,
    c.read_at        AS readAt,
    c.created_at     AS chapterCreatedAt,
    c.found_at       AS chapterFoundAt,
    c.updated_at     AS chapterUpdatedAt,
    n.plugin_id      AS pluginId,
    n.path           AS novelPath,
    n.name           AS novelName,
    n.cover,
    n.summary,
    n.author,
    n.artist,
    n.status,
    n.genres,
    n.in_library     AS inLibrary,
    n.is_local       AS isLocal,
    n.created_at     AS novelCreatedAt,
    n.updated_at     AS novelUpdatedAt,
    n.library_added_at AS libraryAddedAt,
    n.last_read_at   AS lastReadAt
  FROM chapter c
  JOIN novel n ON n.id = c.novel_id
`;

const SELECT_DOWNLOADED_CHAPTER_STORAGE_ROW = `
  ${SELECT_CHAPTER_STORAGE_ROW}
  WHERE c.id = $1
    AND c.is_downloaded = 1
    AND c.content IS NOT NULL
`;

const SELECT_CHAPTER_STORAGE_METADATA_ROW = `
  ${SELECT_CHAPTER_STORAGE_ROW}
  WHERE c.id = $1
`;

const SELECT_RESTORABLE_CHAPTER_STORAGE_ROWS = `
  ${SELECT_CHAPTER_STORAGE_ROW}
  WHERE c.content IS NULL
  ORDER BY c.novel_id, c.position, c.id
`;

const SELECT_DOWNLOADED_CHAPTER_IDS_BY_NOVEL = `
  SELECT id
  FROM chapter
  WHERE novel_id = $1
    AND is_downloaded = 1
    AND content IS NOT NULL
  ORDER BY position, id
`;

const SELECT_DOWNLOADED_CHAPTER_IDS = `
  SELECT id
  FROM chapter
  WHERE is_downloaded = 1
    AND content IS NOT NULL
  ORDER BY novel_id, position, id
`;

const INSERT_MIRRORED_NOVEL = `
  INSERT INTO novel (
    id, plugin_id, path, name, cover, summary, author, artist,
    status, genres, in_library, is_local,
    created_at, updated_at, library_added_at, last_read_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
  ON CONFLICT(id) DO UPDATE SET
    plugin_id        = excluded.plugin_id,
    path             = excluded.path,
    name             = excluded.name,
    cover            = excluded.cover,
    summary          = excluded.summary,
    author           = excluded.author,
    artist           = excluded.artist,
    status           = excluded.status,
    genres           = excluded.genres,
    in_library       = excluded.in_library,
    is_local         = excluded.is_local,
    updated_at       = excluded.updated_at,
    library_added_at = excluded.library_added_at,
    last_read_at     = excluded.last_read_at
`;

const INSERT_MIRRORED_CHAPTER = `
  INSERT INTO chapter (
    id, novel_id, path, name, chapter_number, position, page,
    bookmark, unread, progress, is_downloaded, content, content_bytes,
    media_bytes, content_type, release_time, read_at, created_at, found_at, updated_at
  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, $11, $12, $13, $14, $15, $16, $17, $18, $19)
  ON CONFLICT(id) DO UPDATE SET
    novel_id       = excluded.novel_id,
    path           = excluded.path,
    name           = excluded.name,
    chapter_number = excluded.chapter_number,
    position       = excluded.position,
    page           = excluded.page,
    bookmark       = excluded.bookmark,
    unread         = excluded.unread,
    progress       = excluded.progress,
    is_downloaded  = 1,
    content        = excluded.content,
    content_bytes  = excluded.content_bytes,
    media_bytes    = excluded.media_bytes,
    content_type   = excluded.content_type,
    release_time   = excluded.release_time,
    read_at        = excluded.read_at,
    found_at       = excluded.found_at,
    updated_at     = excluded.updated_at
`;

const UPDATE_MIRRORED_CHAPTER_CONTENT = `
  UPDATE chapter
     SET is_downloaded = 1,
         content = $1,
         content_bytes = $2,
         media_bytes = $3,
         content_type = $4
   WHERE id = $5
`;

const LEGACY_STORAGE_MANIFEST_FILE = "storage-manifest.json";
let legacyAndroidStorageManifestCleanup: Promise<void> | null = null;

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function chapterContentExtension(contentType: string | undefined): string {
  if (contentType === "pdf") return "pdf";
  if (contentType === "text") return "txt";
  return "html";
}

function chapterContentRelativePath(
  novel: ChapterStorageNovelPathInput,
  chapter: ChapterStorageChapterPathInput & { contentType?: string },
): string {
  const extension = chapterContentExtension(chapter.contentType);
  return buildChapterContentRelativePath(novel, chapter, extension);
}

async function deleteLegacyAndroidStorageManifest(): Promise<void> {
  legacyAndroidStorageManifestCleanup ??= deleteAndroidStoragePath(
    LEGACY_STORAGE_MANIFEST_FILE,
  ).catch(() => {
    legacyAndroidStorageManifestCleanup = null;
  });
  await legacyAndroidStorageManifestCleanup;
}

function storageMetadata(row: ChapterStorageRow) {
  return {
    novel: {
      id: row.novelId,
      pluginId: row.pluginId,
      path: row.novelPath,
      name: row.novelName,
      cover: row.cover,
      summary: row.summary,
      author: row.author,
      artist: row.artist,
      status: row.status,
      genres: row.genres,
      inLibrary: sqliteBoolean(row.inLibrary),
      isLocal: isLocalNovel(row.pluginId, row.isLocal),
      createdAt: row.novelCreatedAt,
      updatedAt: row.novelUpdatedAt,
      libraryAddedAt: row.libraryAddedAt,
      lastReadAt: row.lastReadAt,
    },
    chapter: {
      id: row.chapterId,
      novelId: row.novelId,
      path: row.chapterPath,
      name: row.chapterName,
      chapterNumber: row.chapterNumber,
      position: row.position,
      page: row.page,
      bookmark: sqliteBoolean(row.bookmark),
      unread: sqliteBoolean(row.unread),
      progress: row.progress,
      isDownloaded: true,
      contentType: normalizeChapterContentType(
        row.contentType ?? DEFAULT_CHAPTER_CONTENT_TYPE,
      ),
      contentBytes: row.contentBytes,
      mediaBytes: row.mediaBytes,
      releaseTime: row.releaseTime,
      readAt: row.readAt,
      createdAt: row.chapterCreatedAt,
      foundAt: row.chapterFoundAt,
      updatedAt: row.chapterUpdatedAt,
    },
  };
}

async function readStoredChapterContentFile(
  contentFile: string,
): Promise<string | null> {
  if (isAndroidRuntime()) {
    return readAndroidStorageText(contentFile);
  }
  return invoke<string | null>("chapter_content_mirror_read_file", {
    contentFile,
  });
}

async function restoreStoredChapterContentRows(
  options: ChapterStorageRestoreOptions,
): Promise<ChapterStorageRestoreResult> {
  const db = await getDb();
  const rows = await db.select<ChapterStorageRow[]>(
    SELECT_RESTORABLE_CHAPTER_STORAGE_ROWS,
  );
  const candidates = options.chapterIds
    ? rows.filter((row) => options.chapterIds?.has(row.chapterId) === true)
    : rows;
  let restoredChapters = 0;

  if (isAndroidRuntime()) await deleteLegacyAndroidStorageManifest();

  for (const row of candidates) {
    const metadata = storageMetadata(row);
    const contentFile = chapterContentRelativePath(
      metadata.novel,
      metadata.chapter,
    );
    const content = await readStoredChapterContentFile(contentFile);
    if (content === null) continue;
    const contentType = normalizeChapterContentType(
      metadata.chapter.contentType ?? DEFAULT_CHAPTER_CONTENT_TYPE,
    );
    const mediaBytes = await getStoredChapterMediaBytes(content, {
      chapterId: row.chapterId,
      chapterName: row.chapterName,
      chapterNumber: row.chapterNumber,
      chapterPosition: row.position,
      novelId: row.novelId,
      novelName: row.novelName,
      novelPath: row.novelPath,
      sourceId: row.pluginId,
    });
    await db.execute(UPDATE_MIRRORED_CHAPTER_CONTENT, [
      content,
      utf8ByteLength(content),
      mediaBytes,
      contentType,
      row.chapterId,
    ]);
    restoredChapters += 1;
  }

  return { chapters: restoredChapters, novels: 0 };
}

export async function mirrorStoredChapterContent(
  chapterId: number,
): Promise<void> {
  if (!isTauriRuntime()) return;

  const db = await getDb();
  const rows = await db.select<ChapterStorageRow[]>(
    SELECT_DOWNLOADED_CHAPTER_STORAGE_ROW,
    [chapterId],
  );
  const row = rows[0];
  if (!row?.content) return;
  const content = row.content;

  if (isAndroidRuntime()) {
    const metadata = storageMetadata(row);
    const novel = metadata.novel;
    const chapter = metadata.chapter;
    const contentFile = chapterContentRelativePath(novel, chapter);
    await deleteLegacyAndroidStorageManifest();
    await writeAndroidStorageText(contentFile, content);
    return;
  }

  await invoke("chapter_content_mirror_store", {
    chapterId,
    content: row.content,
    metadata: storageMetadata(row),
  });
}

export async function mirrorStoredNovelChapters(
  novelId: number,
): Promise<void> {
  if (!isTauriRuntime()) return;

  const db = await getDb();
  const rows = await db.select<Array<{ id: number }>>(
    SELECT_DOWNLOADED_CHAPTER_IDS_BY_NOVEL,
    [novelId],
  );
  for (const row of rows) {
    await mirrorStoredChapterContent(row.id);
  }
}

export async function mirrorAllStoredChapterContent(): Promise<number> {
  if (!isTauriRuntime()) return 0;

  const db = await getDb();
  const rows = await db.select<Array<{ id: number }>>(
    SELECT_DOWNLOADED_CHAPTER_IDS,
  );
  for (const row of rows) {
    await mirrorStoredChapterContent(row.id);
  }
  return rows.length;
}

export async function clearStoredChapterContentMirror(
  chapterId: number,
): Promise<void> {
  if (!isTauriRuntime()) return;
  if (isAndroidRuntime()) {
    const db = await getDb();
    const rows = await db.select<ChapterStorageRow[]>(
      SELECT_CHAPTER_STORAGE_METADATA_ROW,
      [chapterId],
    );
    const row = rows[0];
    if (!row) return;
    const metadata = storageMetadata(row);
    await deleteLegacyAndroidStorageManifest();
    await deleteAndroidStoragePath(
      chapterContentRelativePath(metadata.novel, metadata.chapter),
    );
    return;
  }
  await invoke("chapter_content_mirror_clear", { chapterId });
}

export async function restoreChapterContentStorageMirror(
  options: ChapterStorageRestoreOptions = {},
): Promise<ChapterStorageRestoreResult> {
  if (!isTauriRuntime()) return { chapters: 0, novels: 0 };
  const restoredRows = await restoreStoredChapterContentRows(options);
  if (isAndroidRuntime()) {
    return restoredRows;
  }
  if (options.contentOnly) {
    return restoredRows;
  }

  const manifest = await invoke<MirroredStorageManifest>(
    "chapter_content_mirror_read",
  );
  const chapterValues = Object.values(manifest.chapters ?? {});
  const chapters = options.chapterIds
    ? chapterValues.filter(
        (chapter) => options.chapterIds?.has(chapter.id) === true,
      )
    : chapterValues;
  const restoredNovelIds = new Set(chapters.map((chapter) => chapter.novelId));
  const novels = options.contentOnly
    ? []
    : Object.values(manifest.novels ?? {}).filter(
        (novel) => !options.chapterIds || restoredNovelIds.has(novel.id),
      );
  const db = await getDb();
  for (const novel of novels) {
    await db.execute(INSERT_MIRRORED_NOVEL, [
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
      sqliteBoolean(novel.inLibrary) ? 1 : 0,
      isLocalNovel(novel.pluginId, novel.isLocal) ? 1 : 0,
      novel.createdAt,
      novel.updatedAt,
      novel.libraryAddedAt,
      novel.lastReadAt,
    ]);
  }
  for (const chapter of chapters) {
    const content = chapter.content ?? "";
    const contentBytes = chapter.contentBytes || utf8ByteLength(content);
    const contentType = normalizeChapterContentType(
      chapter.contentType ?? DEFAULT_CHAPTER_CONTENT_TYPE,
    );
    if (options.contentOnly) {
      await db.execute(UPDATE_MIRRORED_CHAPTER_CONTENT, [
        content,
        contentBytes,
        chapter.mediaBytes,
        contentType,
        chapter.id,
      ]);
      continue;
    }
    await db.execute(INSERT_MIRRORED_CHAPTER, [
      chapter.id,
      chapter.novelId,
      chapter.path,
      chapter.name,
      chapter.chapterNumber,
      chapter.position,
      chapter.page,
      sqliteBoolean(chapter.bookmark) ? 1 : 0,
      sqliteBoolean(chapter.unread) ? 1 : 0,
      chapter.progress,
      content,
      contentBytes,
      chapter.mediaBytes,
      contentType,
      chapter.releaseTime,
      chapter.readAt,
      chapter.createdAt,
      chapter.foundAt,
      chapter.updatedAt,
    ]);
  }

  return {
    chapters: restoredRows.chapters + chapters.length,
    novels: restoredRows.novels + novels.length,
  };
}
