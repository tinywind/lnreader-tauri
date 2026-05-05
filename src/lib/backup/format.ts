/**
 * Backup file format v1.
 *
 * The on-disk artifact is a `.zip` whose entries are written and
 * read by `pack.ts` and `unpack.ts` in later iterations. This
 * module owns the envelope: the JSON payload that lives in
 * `manifest.json` inside the zip. Keeping the format self-describing
 * lets v0.2 evolve without breaking older backups.
 *
 * There is no upstream-compat constraint per `prd.md` sections 3
 * and 8 Sprint 5.
 */

export const BACKUP_FORMAT_VERSION = 1 as const;

export interface BackupNovel {
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
  inLibrary: boolean;
  isLocal: boolean;
  createdAt: number;
  updatedAt: number;
  libraryAddedAt: number | null;
  lastReadAt: number | null;
}

export interface BackupChapter {
  id: number;
  novelId: number;
  path: string;
  name: string;
  chapterNumber: string | null;
  position: number;
  page: string;
  bookmark: boolean;
  unread: boolean;
  progress: number;
  isDownloaded: boolean;
  /** Inline HTML body. Null when the chapter wasn't downloaded yet. */
  content: string | null;
  releaseTime: string | null;
  readAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface BackupCategory {
  id: number;
  name: string;
  sort: number;
  isSystem: boolean;
}

export interface BackupNovelCategory {
  id: number;
  novelId: number;
  categoryId: number;
}

export interface BackupRepository {
  id: number;
  url: string;
  name: string | null;
  addedAt: number;
}

export interface BackupManifest {
  version: typeof BACKUP_FORMAT_VERSION;
  /** Unix-epoch seconds when the backup was created. */
  exportedAt: number;
  novels: BackupNovel[];
  chapters: BackupChapter[];
  categories: BackupCategory[];
  novelCategories: BackupNovelCategory[];
  /** The app stores at most one configured plugin repository. */
  repositories: BackupRepository[];
}

export class BackupFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupFormatError";
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asArray<T>(
  value: unknown,
  field: string,
  guard: (item: unknown) => item is T,
): T[] {
  if (!Array.isArray(value)) {
    throw new BackupFormatError(`${field} is not an array.`);
  }
  for (const item of value) {
    if (!guard(item)) {
      throw new BackupFormatError(`${field} contains a malformed entry.`);
    }
  }
  return value;
}

function isNovel(value: unknown): value is BackupNovel {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "number" &&
    typeof value.pluginId === "string" &&
    typeof value.path === "string" &&
    typeof value.name === "string" &&
    typeof value.inLibrary === "boolean" &&
    typeof value.isLocal === "boolean" &&
    typeof value.createdAt === "number" &&
    typeof value.updatedAt === "number" &&
    (value.libraryAddedAt === null ||
      value.libraryAddedAt === undefined ||
      typeof value.libraryAddedAt === "number")
  );
}

function isChapter(value: unknown): value is BackupChapter {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "number" &&
    typeof value.novelId === "number" &&
    typeof value.path === "string" &&
    typeof value.name === "string" &&
    typeof value.position === "number" &&
    typeof value.page === "string" &&
    typeof value.bookmark === "boolean" &&
    typeof value.unread === "boolean" &&
    typeof value.progress === "number" &&
    typeof value.isDownloaded === "boolean" &&
    typeof value.updatedAt === "number" &&
    (value.createdAt === undefined || typeof value.createdAt === "number")
  );
}

function normalizeNovel(novel: BackupNovel): BackupNovel {
  return {
    ...novel,
    libraryAddedAt: novel.libraryAddedAt ?? null,
  };
}

function normalizeChapter(chapter: BackupChapter): BackupChapter {
  return {
    ...chapter,
    createdAt: chapter.createdAt ?? chapter.updatedAt,
  };
}

function isCategory(value: unknown): value is BackupCategory {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "number" &&
    typeof value.name === "string" &&
    typeof value.sort === "number" &&
    typeof value.isSystem === "boolean"
  );
}

function isNovelCategory(value: unknown): value is BackupNovelCategory {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "number" &&
    typeof value.novelId === "number" &&
    typeof value.categoryId === "number"
  );
}

function isRepository(value: unknown): value is BackupRepository {
  if (!isObject(value)) return false;
  return (
    typeof value.id === "number" &&
    typeof value.url === "string" &&
    typeof value.addedAt === "number"
  );
}

export function encodeBackupManifest(manifest: BackupManifest): string {
  return JSON.stringify(manifest);
}

export function parseBackupManifest(json: string): BackupManifest {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (error) {
    throw new BackupFormatError(
      `Backup manifest is not valid JSON: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!isObject(parsed)) {
    throw new BackupFormatError("Backup manifest is not a JSON object.");
  }
  if (parsed.version !== BACKUP_FORMAT_VERSION) {
    throw new BackupFormatError(
      `Unsupported backup version ${String(parsed.version)}; expected ${BACKUP_FORMAT_VERSION}.`,
    );
  }
  if (typeof parsed.exportedAt !== "number") {
    throw new BackupFormatError("Backup manifest is missing exportedAt.");
  }

  return {
    version: BACKUP_FORMAT_VERSION,
    exportedAt: parsed.exportedAt,
    novels: asArray(parsed.novels, "novels", isNovel).map(normalizeNovel),
    chapters: asArray(
      parsed.chapters,
      "chapters",
      isChapter,
    ).map(normalizeChapter),
    categories: asArray(parsed.categories, "categories", isCategory),
    novelCategories: asArray(
      parsed.novelCategories,
      "novelCategories",
      isNovelCategory,
    ),
    repositories: asArray(
      parsed.repositories,
      "repositories",
      isRepository,
    ),
  };
}
