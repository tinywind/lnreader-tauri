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
import { isAndroidRuntime, isTauriRuntime } from "./tauri-runtime";

interface ChapterStorageRow {
  artist: string | null;
  author: string | null;
  bookmark: number;
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
  inLibrary: number;
  isLocal: number;
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
  unread: number;
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
  WHERE c.id = $1
    AND c.is_downloaded = 1
    AND c.content IS NOT NULL
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

const CONTENTS_ROOT_DIR = "contents";
const STORAGE_MANIFEST_FILE = "storage-manifest.json";

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function defaultStorageManifest(): MirroredStorageManifest & {
  contentRoot: string;
  version: number;
} {
  return {
    version: 1,
    contentRoot: CONTENTS_ROOT_DIR,
    novels: {},
    chapters: {},
  };
}

function safeSegment(value: string, fallback: string): string {
  const sanitized = value
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 96);
  return sanitized === "" || sanitized === "." || sanitized === ".."
    ? fallback
    : sanitized;
}

function isUnsafeUnicodeFormat(ch: string): boolean {
  const code = ch.codePointAt(0) ?? 0;
  return (
    code === 0x180e ||
    (code >= 0x200b && code <= 0x200f) ||
    (code >= 0x202a && code <= 0x202e) ||
    (code >= 0x2060 && code <= 0x206f) ||
    code === 0xfeff
  );
}

function safeLabelSegment(value: string | null | undefined, fallback: string) {
  const raw = value?.trim() || fallback;
  const sanitized = [...raw]
    .map((ch) =>
      /[\s/:*?"<>|\\]/.test(ch) || isUnsafeUnicodeFormat(ch) ? "-" : ch,
    )
    .join("")
    .replace(/^[.-]+|[.-]+$/g, "")
    .slice(0, 96);
  return sanitized === "" || sanitized === "." || sanitized === ".."
    ? fallback
    : sanitized;
}

function labelWithId(value: string | null | undefined, fallback: string, id: number) {
  return `${safeLabelSegment(value, fallback)}-${id}`;
}

function chapterFolderLabel(chapter: Pick<MirroredChapter, "chapterNumber" | "id" | "name" | "position">) {
  if (chapter.chapterNumber?.trim()) return `chapter${chapter.chapterNumber.trim()}`;
  if (chapter.name.trim()) return chapter.name;
  return chapter.position > 0 ? `chapter${chapter.position}` : `chapter${chapter.id}`;
}

function contentChapterRelativeDir(novel: MirroredNovel, chapter: MirroredChapter): string {
  const sourceId = safeSegment(novel.pluginId, "source");
  const novelSegment = labelWithId(novel.name, "novel", novel.id);
  const chapterSegment = labelWithId(
    chapterFolderLabel(chapter),
    "chapter",
    chapter.id,
  );
  return `${CONTENTS_ROOT_DIR}/${sourceId}/${novelSegment}/${chapterSegment}`;
}

function chapterFileStem(chapter: Pick<MirroredChapter, "chapterNumber" | "id" | "position">): string {
  const fallback = chapter.position > 0 ? String(chapter.position) : String(chapter.id);
  const raw = chapter.chapterNumber?.trim() || fallback;
  return `chapter${safeSegment(raw, fallback)}`;
}

function chapterContentExtension(contentType: string | undefined): string {
  if (contentType === "pdf") return "pdf";
  if (contentType === "text") return "txt";
  return "html";
}

function chapterContentRelativePath(
  novel: MirroredNovel,
  chapter: MirroredChapter,
): string {
  const extension = chapterContentExtension(chapter.contentType);
  return `${contentChapterRelativeDir(novel, chapter)}/${chapterFileStem(
    chapter,
  )}.${extension}`;
}

async function readAndroidStorageManifest(): Promise<MirroredStorageManifest> {
  const raw = await readAndroidStorageText(STORAGE_MANIFEST_FILE);
  if (!raw) return defaultStorageManifest();
  const manifest = JSON.parse(raw) as MirroredStorageManifest;
  return {
    ...defaultStorageManifest(),
    ...manifest,
    chapters: manifest.chapters ?? {},
    novels: manifest.novels ?? {},
  };
}

async function writeAndroidStorageManifest(
  manifest: MirroredStorageManifest,
): Promise<void> {
  await writeAndroidStorageText(
    STORAGE_MANIFEST_FILE,
    JSON.stringify(
      {
        ...manifest,
        version: 1,
        contentRoot: CONTENTS_ROOT_DIR,
        updatedAt: Math.floor(Date.now() / 1000),
      },
      null,
      2,
    ),
  );
}

async function readAndroidStorageManifestWithContent(): Promise<MirroredStorageManifest> {
  const manifest = await readAndroidStorageManifest();
  for (const chapter of Object.values(manifest.chapters ?? {})) {
    if (!chapter.contentFile) {
      throw new Error(`Mirrored chapter ${chapter.id} is missing a content file.`);
    }
    const content = await readAndroidStorageText(chapter.contentFile);
    if (content === null) {
      throw new Error(`Mirrored chapter content is missing: ${chapter.contentFile}`);
    }
    chapter.content = content;
  }
  return manifest;
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
      inLibrary: !!row.inLibrary,
      isLocal: !!row.isLocal,
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
      bookmark: !!row.bookmark,
      unread: !!row.unread,
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

export async function mirrorStoredChapterContent(
  chapterId: number,
): Promise<void> {
  if (!isTauriRuntime()) return;

  const db = await getDb();
  const rows = await db.select<ChapterStorageRow[]>(
    SELECT_CHAPTER_STORAGE_ROW,
    [chapterId],
  );
  const row = rows[0];
  if (!row?.content) return;

  if (isAndroidRuntime()) {
    const metadata = storageMetadata(row);
    const novel = metadata.novel;
    const chapter = metadata.chapter;
    const contentFile = chapterContentRelativePath(novel, chapter);
    const manifest = await readAndroidStorageManifest();
    const previousContentFile =
      manifest.chapters?.[String(chapterId)]?.contentFile;

    await writeAndroidStorageText(contentFile, row.content);
    manifest.novels ??= {};
    manifest.chapters ??= {};
    manifest.novels[String(novel.id)] = novel;
    manifest.chapters[String(chapterId)] = {
      ...chapter,
      contentFile,
    };
    if (previousContentFile && previousContentFile !== contentFile) {
      await deleteAndroidStoragePath(previousContentFile);
    }
    await writeAndroidStorageManifest(manifest);
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
    const manifest = await readAndroidStorageManifest();
    const chapter = manifest.chapters?.[String(chapterId)];
    if (chapter?.contentFile) {
      await deleteAndroidStoragePath(chapter.contentFile);
    }
    if (manifest.chapters) {
      delete manifest.chapters[String(chapterId)];
      await writeAndroidStorageManifest(manifest);
    }
    return;
  }
  await invoke("chapter_content_mirror_clear", { chapterId });
}

export async function restoreChapterContentStorageMirror(
  options: ChapterStorageRestoreOptions = {},
): Promise<ChapterStorageRestoreResult> {
  if (!isTauriRuntime()) return { chapters: 0, novels: 0 };

  const manifest = isAndroidRuntime()
    ? await readAndroidStorageManifestWithContent()
    : await invoke<MirroredStorageManifest>("chapter_content_mirror_read");
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
      novel.inLibrary,
      novel.isLocal,
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
      chapter.bookmark,
      chapter.unread,
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

  return { chapters: chapters.length, novels: novels.length };
}
