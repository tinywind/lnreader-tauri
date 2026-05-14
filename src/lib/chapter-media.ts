import { invoke } from "@tauri-apps/api/core";
import { getChapterById } from "../db/queries/chapter";
import { getNovelById } from "../db/queries/novel";
import {
  androidStorageZipEntryExists,
  archiveAndroidStorageDirectory,
  androidStoragePathSize,
  clearAndroidStorageRoot,
  deleteAndroidStorageChildrenExcept,
  deleteAndroidStoragePath,
  readAndroidStorageDataUrl,
  readAndroidStorageText,
  readAndroidStorageZipEntryDataUrl,
  writeAndroidStorageBytes,
  writeAndroidStorageText,
} from "./android-storage";
import {
  chapterMediaDirectoryRelativePath,
  chapterMediaRelativePath,
  chapterStorageRelativeDir,
  type ChapterStorageChapterPathInput,
  type ChapterStorageNovelPathInput,
} from "./chapter-storage-path";
import { pluginMediaFetch, type HttpInit } from "./http";
import type { ScraperExecutorId } from "./tasks/scraper-queue";
import { isAndroidRuntime, isTauriRuntime } from "./tauri-runtime";

const LOCAL_MEDIA_SRC_PREFIX = "norea-media://chapter/";
const LOCAL_CHAPTER_MEDIA_SRC_PATTERN =
  /norea-media:\/\/chapter\/\d+\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+/g;
const LOCAL_CHAPTER_MEDIA_SRC_DETAIL_PATTERN =
  /^norea-media:\/\/chapter\/(\d+)\/([A-Za-z0-9._-]+)\/([A-Za-z0-9._-]+)$/;
const MEDIA_SOURCE_URL_ATTRIBUTE = "data-norea-media-source-url";
const MEDIA_SRCSET_SOURCE_ATTRIBUTE = "data-norea-media-srcset-source";
const MEDIA_LAZY_SRC_ATTRIBUTES = [
  "data-src",
  "data-original",
  "data-lazy-src",
  "data-orig-src",
] as const;
const MEDIA_SRC_ATTRIBUTES = [
  "src",
  "poster",
  "data",
  "href",
  ...MEDIA_LAZY_SRC_ATTRIBUTES,
] as const;
type MediaSrcAttribute = (typeof MEDIA_SRC_ATTRIBUTES)[number];
const MEDIA_PRIMARY_SOURCE_ELEMENTS = [
  "img",
  "video",
  "audio",
  "source",
  "embed",
  "track",
] as const;
const MEDIA_LAZY_SOURCE_ELEMENTS = ["img", "video", "audio", "source"] as const;
const MEDIA_SOURCE_TARGETS: Array<{
  attribute: MediaSrcAttribute;
  selector: string;
}> = [
  ...MEDIA_PRIMARY_SOURCE_ELEMENTS.map((element) => ({
    attribute: "src" as const,
    selector: `${element}[src]`,
  })),
  ...MEDIA_LAZY_SOURCE_ELEMENTS.flatMap((element) =>
    MEDIA_LAZY_SRC_ATTRIBUTES.map((attribute) => ({
      attribute,
      selector: `${element}[${attribute}]`,
    })),
  ),
  { attribute: "poster", selector: "video[poster]" },
  { attribute: "data", selector: "object[data]" },
  { attribute: "href", selector: 'link[href][rel~="preload"][as="image"]' },
  { attribute: "href", selector: 'link[href][rel~="preload"][as="video"]' },
  { attribute: "href", selector: 'link[href][rel~="preload"][as="audio"]' },
];
const MEDIA_SOURCE_SELECTOR = [
  ...MEDIA_SOURCE_TARGETS.map((target) => target.selector),
  "img[srcset]",
  "source[srcset]",
].join(",");
const MEDIA_STYLE_SELECTOR = "[style]";
const MEDIA_PATCH_SELECTOR = [MEDIA_SOURCE_SELECTOR, MEDIA_STYLE_SELECTOR].join(
  ",",
);
const MEDIA_PATCH_ATTRIBUTES = [
  "src",
  "srcset",
  "poster",
  "data",
  "href",
  "data-src",
  "data-original",
  "data-lazy-src",
  "data-orig-src",
  "style",
] as const;
const STYLE_URL_PATTERN =
  /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")]*?))\s*\)/gi;
const DEFAULT_MEDIA_EXTENSION = "bin";
const DEFAULT_MEDIA_ACCEPT =
  "image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,audio/*,*/*;q=0.8";
const CHAPTER_MEDIA_MANIFEST_FILE = "media-manifest.json";
type ChapterMediaRequestInit = Pick<HttpInit, "body" | "headers" | "method">;

interface CacheChapterMediaOptions {
  baseUrl: string;
  chapterId: number;
  chapterName?: string | null;
  chapterNumber?: string | null;
  chapterPosition?: number | null;
  contextUrl?: string;
  html: string;
  novelId?: number;
  novelName?: string | null;
  novelPath?: string | null;
  onHtmlUpdate?: (html: string) => Promise<void> | void;
  onMediaPatch?: (patches: ChapterMediaElementPatch[]) => Promise<void> | void;
  onProgress?: (progress: { current: number; total: number }) => void;
  previousHtml?: string | null;
  requestInit?: ChapterMediaRequestInit;
  scraperExecutor?: ScraperExecutorId;
  signal?: AbortSignal;
  sourceId?: string;
}

export interface ChapterMediaElementPatch {
  attributes: Record<string, string>;
  index: number;
}

export interface ChapterMediaFailure {
  message: string;
  status?: number;
  url: string;
}

interface CacheChapterMediaResult {
  cacheKey: string | null;
  html: string;
  mediaFailures: ChapterMediaFailure[];
  mediaBytes: number;
  storedMediaCount: number;
}

interface ChapterMediaStoreInput {
  body: number[];
  cacheKey: string;
  chapterId: number;
  chapterName?: string | null;
  chapterNumber?: string | null;
  chapterPosition?: number | null;
  contentType?: string | null;
  fileName: string;
  novelId?: number;
  novelName?: string | null;
  novelPath?: string | null;
  sourceId?: string;
  sourceUrl?: string;
}

interface ChapterMediaArchiveInput {
  cacheKey: string;
  chapterId: number;
  chapterName?: string | null;
  chapterNumber?: string | null;
  chapterPosition?: number | null;
  novelId?: number;
  novelName?: string | null;
  novelPath?: string | null;
  sourceId?: string;
}

export interface ChapterMediaStorageContext {
  chapterId: number;
  chapterName?: string | null;
  chapterNumber?: string | null;
  chapterPosition?: number | null;
  novelId?: number | null;
  novelName?: string | null;
  novelPath?: string | null;
  sourceId?: string | null;
}

interface ChapterMediaManifestFile {
  archivePath: string;
  cacheKey: string;
  contentType?: string;
  fileName: string;
  path: string;
  sourceUrl: string;
  updatedAt: number;
}

interface ChapterMediaManifest {
  files: ChapterMediaManifestFile[];
  updatedAt: number;
  version: 1;
}

interface MediaSrcTarget {
  attribute: MediaSrcAttribute;
  element: Element;
  url: string;
}

interface MediaStyleUrl {
  source: string;
  url: string;
}

interface MediaStyleTarget {
  element: Element;
  style: string;
  urls: MediaStyleUrl[];
}

interface SrcsetCandidate {
  descriptor: string;
  source: string;
}

interface MediaSrcsetTarget {
  candidates: SrcsetCandidate[];
  element: Element;
}

interface ExistingMediaSlots {
  srcSlots: Array<string | null>;
  srcsetSlots: Array<Array<string | null>>;
  styleSlots: Array<Array<string | null>>;
}

function isSkippableMediaSource(src: string): boolean {
  return (
    src === "" ||
    src.startsWith("#") ||
    src.startsWith(LOCAL_MEDIA_SRC_PREFIX) ||
    /^(?:data|blob|file|asset):/i.test(src)
  );
}

function absoluteMediaUrl(src: string, baseUrl: string): string | null {
  const trimmed = src.trim();
  if (isSkippableMediaSource(trimmed)) return null;

  try {
    const url = new URL(trimmed, baseUrl);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function mediaOutputAttribute(attribute: MediaSrcAttribute): string {
  return attribute.startsWith("data-") ? "src" : attribute;
}

function shouldCollectMediaAttribute(
  element: Element,
  attribute: MediaSrcAttribute,
): boolean {
  if (typeof element.matches !== "function") return true;
  return MEDIA_SOURCE_TARGETS.some(
    (target) =>
      target.attribute === attribute && element.matches(target.selector),
  );
}

function collectStyleMediaUrls(style: string, baseUrl: string): MediaStyleUrl[] {
  const urls: MediaStyleUrl[] = [];

  for (const match of style.matchAll(STYLE_URL_PATTERN)) {
    const source = (match[1] ?? match[2] ?? match[3] ?? "").trim();
    const url = absoluteMediaUrl(source, baseUrl);
    if (!url) continue;
    urls.push({ source, url });
  }

  return urls;
}

function localStyleMediaSources(style: string): string[] {
  return styleMediaSlots(style).filter((src): src is string => src !== null);
}

function styleMediaSlots(style: string): Array<string | null> {
  return [...style.matchAll(STYLE_URL_PATTERN)]
    .map((match) => (match[1] ?? match[2] ?? match[3] ?? "").trim())
    .map((source) => localMediaSrc(source));
}

function rewriteStyleMediaUrls(
  style: string,
  baseUrl: string,
  replacementForUrl: (url: string) => string | null,
): string {
  return style.replace(
    STYLE_URL_PATTERN,
    (match, doubleQuoted, singleQuoted, unquoted) => {
      const source = String(
        doubleQuoted ?? singleQuoted ?? unquoted ?? "",
      ).trim();
      const url = absoluteMediaUrl(source, baseUrl);
      if (!url) return match;
      const replacement = replacementForUrl(url);
      return replacement === null ? match : `url("${replacement}")`;
    },
  );
}

function extensionFromContentType(contentType: string | null): string | null {
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase();
  switch (mediaType) {
    case "image/avif":
      return "avif";
    case "image/bmp":
      return "bmp";
    case "image/gif":
      return "gif";
    case "image/jpeg":
    case "image/jpg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/svg+xml":
      return "svg";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}

function extensionFromUrl(url: string): string | null {
  try {
    const extension = new URL(url).pathname.match(
      /\.([a-z0-9]{1,8})$/i,
    )?.[1];
    return extension?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function mimeTypeFromFileName(fileName: string): string {
  const extension = fileName.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toLowerCase();
  switch (extension) {
    case "avif":
      return "image/avif";
    case "bmp":
      return "image/bmp";
    case "gif":
      return "image/gif";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "svg":
      return "image/svg+xml";
    case "webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function safeFileStem(value: string, fallback: string): string {
  const stem = value
    .replace(/\.[^.]*$/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 56);
  return stem === "" || stem === "." || stem === ".." ? fallback : stem;
}

function shortUrlHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function mediaFileName(index: number, url: string, contentType: string | null) {
  let leaf = "";
  try {
    const segments = new URL(url).pathname.split("/");
    leaf = decodeURIComponent(segments[segments.length - 1] ?? "");
  } catch {
    leaf = "";
  }

  const extension =
    extensionFromUrl(url) ??
    extensionFromContentType(contentType) ??
    DEFAULT_MEDIA_EXTENSION;
  const order = String(index + 1).padStart(4, "0");
  const stem = safeFileStem(leaf, `image-${index + 1}`);
  return `${order}-${stem}-${shortUrlHash(url)}.${extension}`;
}

function makeCacheKey(): string {
  return `${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function bytesFromArrayBuffer(buffer: ArrayBuffer): number[] {
  return Array.from(new Uint8Array(buffer));
}

function localChapterMediaSrc(
  chapterId: number,
  cacheKey: string,
  fileName: string,
): string {
  return `${LOCAL_MEDIA_SRC_PREFIX}${chapterId}/${cacheKey}/${fileName}`;
}

function androidChapterMediaRelativePath(
  chapterId: number,
  cacheKey: string,
  fileName?: string,
): string {
  const base = `chapter-media/${chapterId}/${cacheKey}`;
  return fileName ? `${base}/${fileName}` : base;
}

function parseLocalChapterMediaSrc(src: string): {
  cacheKey: string;
  chapterId: number;
  fileName: string;
} | null {
  const match = src.match(LOCAL_CHAPTER_MEDIA_SRC_DETAIL_PATTERN);
  if (!match) return null;
  return {
    chapterId: Number(match[1]),
    cacheKey: match[2]!,
    fileName: match[3]!,
  };
}

function hasStorageContext(
  context: ChapterMediaStorageContext | null | undefined,
): context is ChapterMediaStorageContext & {
  novelPath: string;
  sourceId: string;
} {
  return !!context?.novelPath?.trim() && !!context.sourceId?.trim();
}

function storageNovelPathInput(
  context: ChapterMediaStorageContext,
): ChapterStorageNovelPathInput {
  return {
    id: context.novelId,
    name: context.novelName,
    path: context.novelPath,
    pluginId: context.sourceId,
  };
}

function storageChapterPathInput(
  context: ChapterMediaStorageContext,
): ChapterStorageChapterPathInput {
  return {
    chapterNumber: context.chapterNumber,
    id: context.chapterId,
    name: context.chapterName,
    position: context.chapterPosition,
  };
}

async function storageContextForChapter(
  chapterId: number,
): Promise<ChapterMediaStorageContext | null> {
  const chapter = await getChapterById(chapterId);
  if (!chapter) return null;
  const novel = await getNovelById(chapter.novelId);
  if (!novel) return null;
  return {
    chapterId,
    chapterName: chapter.name,
    chapterNumber: chapter.chapterNumber,
    chapterPosition: chapter.position,
    novelId: novel.id,
    novelName: novel.name,
    novelPath: novel.path,
    sourceId: novel.pluginId,
  };
}

function androidChapterMediaRelativePathForContext(
  context: ChapterMediaStorageContext | null | undefined,
  cacheKey: string,
  fileName?: string,
): string {
  if (!hasStorageContext(context)) {
    return androidChapterMediaRelativePath(
      context?.chapterId ?? 0,
      cacheKey,
      fileName,
    );
  }
  return chapterMediaRelativePath(
    storageNovelPathInput(context),
    storageChapterPathInput(context),
    cacheKey,
    fileName,
  );
}

function androidChapterMediaArchiveRelativePathForContext(
  context: ChapterMediaStorageContext | null | undefined,
  cacheKey: string,
): string {
  if (!hasStorageContext(context)) {
    return `chapter-media/${context?.chapterId ?? 0}/${cacheKey}.zip`;
  }
  return `${chapterStorageRelativeDir(
    storageNovelPathInput(context),
    storageChapterPathInput(context),
  )}/${cacheKey}.zip`;
}

function androidChapterMediaManifestRelativePath(
  context: ChapterMediaStorageContext | null | undefined,
): string {
  if (!hasStorageContext(context)) {
    return `chapter-media/${context?.chapterId ?? 0}/${CHAPTER_MEDIA_MANIFEST_FILE}`;
  }
  return `${chapterStorageRelativeDir(
    storageNovelPathInput(context),
    storageChapterPathInput(context),
  )}/${CHAPTER_MEDIA_MANIFEST_FILE}`;
}

function emptyChapterMediaManifest(): ChapterMediaManifest {
  return {
    files: [],
    updatedAt: 0,
    version: 1,
  };
}

function parseChapterMediaManifest(raw: string | null): ChapterMediaManifest {
  if (!raw) return emptyChapterMediaManifest();
  try {
    const parsed = JSON.parse(raw) as Partial<ChapterMediaManifest>;
    return {
      files: Array.isArray(parsed.files)
        ? parsed.files.filter(
            (file): file is ChapterMediaManifestFile =>
              typeof file === "object" &&
              file !== null &&
              typeof file.archivePath === "string" &&
              typeof file.cacheKey === "string" &&
              typeof file.fileName === "string" &&
              typeof file.path === "string" &&
              typeof file.sourceUrl === "string" &&
              typeof file.updatedAt === "number",
          )
        : [],
      updatedAt:
        typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
      version: 1,
    };
  } catch {
    return emptyChapterMediaManifest();
  }
}

async function writeAndroidChapterMediaManifest({
  cacheKey,
  context,
  contentType,
  fileName,
  sourceUrl,
}: {
  cacheKey: string;
  context: ChapterMediaStorageContext;
  contentType?: string | null;
  fileName: string;
  sourceUrl?: string;
}): Promise<void> {
  if (!sourceUrl) return;
  const manifestPath = androidChapterMediaManifestRelativePath(context);
  const now = Date.now();
  const manifest = parseChapterMediaManifest(
    await readAndroidStorageText(manifestPath),
  );
  const nextFile: ChapterMediaManifestFile = {
    archivePath: `${cacheKey}.zip`,
    cacheKey,
    ...(contentType ? { contentType } : {}),
    fileName,
    path: `media/${cacheKey}/${fileName}`,
    sourceUrl,
    updatedAt: now,
  };
  manifest.files = [
    ...manifest.files.filter((file) => file.sourceUrl !== sourceUrl),
    nextFile,
  ].sort((left, right) => left.fileName.localeCompare(right.fileName));
  manifest.updatedAt = now;
  manifest.version = 1;
  await writeAndroidStorageText(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

async function pruneAndroidChapterMediaManifest(
  context: ChapterMediaStorageContext,
  keepCacheKey: string,
): Promise<void> {
  const manifestPath = androidChapterMediaManifestRelativePath(context);
  const raw = await readAndroidStorageText(manifestPath);
  if (!raw) return;
  const manifest = parseChapterMediaManifest(raw);
  manifest.files = manifest.files.filter(
    (file) => file.cacheKey === keepCacheKey,
  );
  manifest.updatedAt = Date.now();
  await writeAndroidStorageText(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

function androidArchiveRelativePathFromMediaRelativePath(
  relativePath: string,
  cacheKey: string,
): string | null {
  const normalized = relativePath.replace(/\\/g, "/");
  const mediaCacheSegment = `/media/${cacheKey}/`;
  const mediaCacheIndex = normalized.lastIndexOf(mediaCacheSegment);
  if (mediaCacheIndex >= 0) {
    return `${normalized.slice(0, mediaCacheIndex)}/${cacheKey}.zip`;
  }

  const legacyCacheSegment = `/${cacheKey}/`;
  const legacyCacheIndex = normalized.lastIndexOf(legacyCacheSegment);
  if (normalized.startsWith("chapter-media/") && legacyCacheIndex >= 0) {
    return `${normalized.slice(0, legacyCacheIndex)}/${cacheKey}.zip`;
  }

  return null;
}

async function androidRelativePathFromLocalMediaSrc(
  src: string,
  context?: ChapterMediaStorageContext,
): Promise<string | null> {
  const parsed = parseLocalChapterMediaSrc(src);
  if (!parsed) return null;
  const resolvedContext =
    context?.chapterId === parsed.chapterId
      ? context
      : await storageContextForChapter(parsed.chapterId);
  if (hasStorageContext(resolvedContext)) {
    return chapterMediaRelativePath(
      storageNovelPathInput(resolvedContext),
      storageChapterPathInput(resolvedContext),
      parsed.cacheKey,
      parsed.fileName,
    );
  }
  return androidChapterMediaRelativePath(
    parsed.chapterId,
    parsed.cacheKey,
    parsed.fileName,
  );
}

export function localChapterMediaSources(html: string): string[] {
  return [...new Set(html.match(LOCAL_CHAPTER_MEDIA_SRC_PATTERN) ?? [])];
}

export function localChapterMediaCacheKeys(
  html: string,
  chapterId: number,
): string[] {
  const cacheKeys = new Set<string>();
  for (const src of localChapterMediaSources(html)) {
    const cacheKey = cacheKeyFromLocalMediaSrc(src, chapterId);
    if (cacheKey) cacheKeys.add(cacheKey);
  }
  return [...cacheKeys];
}

export function hasRemoteChapterMedia(html: string, baseUrl: string): boolean {
  if (typeof document === "undefined") return false;
  const template = document.createElement("template");
  template.innerHTML = html;
  return collectMediaTargets(template.content, baseUrl).urls.length > 0;
}

export async function getStoredChapterMediaBytes(
  html: string,
  context?: ChapterMediaStorageContext,
): Promise<number> {
  if (!isTauriRuntime()) return 0;
  const mediaSrcs = localChapterMediaSources(html);
  if (mediaSrcs.length === 0) return 0;
  const firstMedia = mediaSrcs[0]
    ? parseLocalChapterMediaSrc(mediaSrcs[0])
    : null;
  const resolvedContext =
    context ??
    (firstMedia
      ? await storageContextForChapter(firstMedia.chapterId)
      : undefined);
  if (isAndroidRuntime()) {
    let total = 0;
    const paths = new Map<string, string>();
    const countedArchives = new Set<string>();
    for (const source of mediaSrcs) {
      const path = await androidRelativePathFromLocalMediaSrc(
        source,
        resolvedContext ?? undefined,
      );
      if (path) paths.set(path, source);
    }
    for (const [path, source] of paths) {
      const directSize = await androidStoragePathSize(path);
      if (directSize > 0) {
        total += directSize;
        continue;
      }

      const parsed = parseLocalChapterMediaSrc(source);
      if (!parsed) continue;
      const archivePath = androidArchiveRelativePathFromMediaRelativePath(
        path,
        parsed.cacheKey,
      );
      if (!archivePath) continue;
      if (
        countedArchives.has(archivePath) ||
        !(await androidStorageZipEntryExists(archivePath, parsed.fileName))
      ) {
        continue;
      }
      total += await androidStoragePathSize(archivePath);
      countedArchives.add(archivePath);
    }
    return total;
  }
  return invoke<number>("chapter_media_total_size", {
    mediaSrcs,
    ...(resolvedContext?.chapterName
      ? { chapterName: resolvedContext.chapterName }
      : {}),
    ...(resolvedContext?.chapterNumber
      ? { chapterNumber: resolvedContext.chapterNumber }
      : {}),
    ...(resolvedContext?.chapterPosition
      ? { chapterPosition: resolvedContext.chapterPosition }
      : {}),
    ...(resolvedContext?.novelId ? { novelId: resolvedContext.novelId } : {}),
    ...(resolvedContext?.novelName
      ? { novelName: resolvedContext.novelName }
      : {}),
    ...(resolvedContext?.novelPath
      ? { novelPath: resolvedContext.novelPath }
      : {}),
    ...(resolvedContext?.sourceId ? { sourceId: resolvedContext.sourceId } : {}),
  });
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new DOMException(
      "Chapter media download was cancelled.",
      "AbortError",
    );
  }
}

async function storeChapterMedia({
  body,
  cacheKey,
  chapterId,
  chapterName,
  chapterNumber,
  chapterPosition,
  contentType,
  fileName,
  novelId,
  novelName,
  novelPath,
  sourceId,
  sourceUrl,
}: ChapterMediaStoreInput): Promise<string> {
  if (isAndroidRuntime()) {
    const src = localChapterMediaSrc(chapterId, cacheKey, fileName);
    const context = {
      chapterId,
      chapterName,
      chapterNumber,
      chapterPosition,
      novelId,
      novelName,
      novelPath,
      sourceId,
    };
    await writeAndroidStorageBytes(
      androidChapterMediaRelativePathForContext(context, cacheKey, fileName),
      body,
      mimeTypeFromFileName(fileName),
    );
    try {
      await writeAndroidChapterMediaManifest({
        cacheKey,
        context,
        contentType,
        fileName,
        sourceUrl,
      });
    } catch (error) {
      console.warn("[chapter-media] manifest update failed", error);
    }
    return src;
  }
  return invoke<string>("chapter_media_store", {
    body,
    cacheKey,
    chapterId,
    ...(chapterName ? { chapterName } : {}),
    ...(chapterNumber ? { chapterNumber } : {}),
    ...(chapterPosition ? { chapterPosition } : {}),
    fileName,
    ...(novelId ? { novelId } : {}),
    ...(novelName ? { novelName } : {}),
    ...(novelPath ? { novelPath } : {}),
    ...(sourceId ? { sourceId } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
  });
}

async function archiveChapterMediaCache({
  cacheKey,
  chapterId,
  chapterName,
  chapterNumber,
  chapterPosition,
  novelId,
  novelName,
  novelPath,
  sourceId,
}: ChapterMediaArchiveInput): Promise<number> {
  if (isAndroidRuntime()) {
    const context = {
      chapterId,
      chapterName,
      chapterNumber,
      chapterPosition,
      novelId,
      novelName,
      novelPath,
      sourceId,
    };
    return archiveAndroidStorageDirectory(
      androidChapterMediaRelativePathForContext(context, cacheKey),
      androidChapterMediaArchiveRelativePathForContext(context, cacheKey),
    );
  }
  return invoke<number>("chapter_media_archive_cache", {
    chapterId,
    ...(chapterName ? { chapterName } : {}),
    ...(chapterNumber ? { chapterNumber } : {}),
    ...(chapterPosition ? { chapterPosition } : {}),
    cacheKey,
    ...(novelId ? { novelId } : {}),
    ...(novelName ? { novelName } : {}),
    ...(novelPath ? { novelPath } : {}),
    ...(sourceId ? { sourceId } : {}),
  });
}

function parseSrcset(srcset: string): SrcsetCandidate[] {
  return srcset
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .map((candidate) => {
      const [source = "", ...descriptor] = candidate.split(/\s+/);
      return {
        source,
        descriptor: descriptor.join(" "),
      };
    })
    .filter((candidate) => candidate.source !== "");
}

function formatSrcset(candidates: SrcsetCandidate[]): string {
  return candidates
    .map((candidate) =>
      candidate.descriptor
        ? `${candidate.source} ${candidate.descriptor}`
        : candidate.source,
    )
    .join(", ");
}

function addUniqueUrl(urls: string[], url: string): void {
  if (!urls.includes(url)) {
    urls.push(url);
  }
}

function localMediaSrc(value: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed?.startsWith(LOCAL_MEDIA_SRC_PREFIX) ? trimmed : null;
}

function cacheKeyFromLocalMediaSrc(
  src: string,
  chapterId: number,
): string | null {
  const match = src.match(LOCAL_CHAPTER_MEDIA_SRC_DETAIL_PATTERN);
  if (!match || Number(match[1]) !== chapterId) return null;
  return match[2] ?? null;
}

function collectMediaTargets(
  root: DocumentFragment,
  baseUrl: string,
): {
  srcTargets: MediaSrcTarget[];
  srcsetTargets: MediaSrcsetTarget[];
  styleTargets: MediaStyleTarget[];
  urls: string[];
} {
  const srcTargets: MediaSrcTarget[] = [];
  const srcsetTargets: MediaSrcsetTarget[] = [];
  const styleTargets: MediaStyleTarget[] = [];
  const urls: string[] = [];

  for (const element of root.querySelectorAll<Element>(MEDIA_SOURCE_SELECTOR)) {
    for (const attribute of MEDIA_SRC_ATTRIBUTES) {
      if (!shouldCollectMediaAttribute(element, attribute)) continue;
      const rawSource = element.getAttribute(attribute);
      if (!rawSource) continue;
      const url = absoluteMediaUrl(rawSource, baseUrl);
      if (!url) continue;
      srcTargets.push({ attribute, element, url });
      addUniqueUrl(urls, url);
    }

    const rawSrcset = element.getAttribute("srcset");
    if (!rawSrcset) continue;
    const candidates = parseSrcset(rawSrcset);
    let hasRemoteCandidate = false;
    for (const candidate of candidates) {
      const url = absoluteMediaUrl(candidate.source, baseUrl);
      if (!url) continue;
      hasRemoteCandidate = true;
      addUniqueUrl(urls, url);
    }
    if (hasRemoteCandidate) {
      srcsetTargets.push({ candidates, element });
    }
  }

  for (const element of root.querySelectorAll<Element>(MEDIA_STYLE_SELECTOR)) {
    const style = element.getAttribute("style") ?? "";
    const styleUrls = collectStyleMediaUrls(style, baseUrl);
    if (styleUrls.length === 0) continue;
    styleTargets.push({ element, style, urls: styleUrls });
    for (const { url } of styleUrls) {
      addUniqueUrl(urls, url);
    }
  }

  return { srcTargets, srcsetTargets, styleTargets, urls };
}

function collectExistingMediaSlots(root: DocumentFragment): ExistingMediaSlots {
  const srcSlots: Array<string | null> = [];
  const srcsetSlots: Array<Array<string | null>> = [];
  const styleSlots: Array<Array<string | null>> = [];

  for (const element of root.querySelectorAll<Element>(MEDIA_SOURCE_SELECTOR)) {
    for (const attribute of MEDIA_SRC_ATTRIBUTES) {
      const rawSource = element.getAttribute(attribute);
      if (rawSource === null) continue;
      srcSlots.push(localMediaSrc(rawSource));
    }

    const rawSrcset = element.getAttribute("srcset");
    if (rawSrcset === null) continue;
    srcsetSlots.push(
      parseSrcset(rawSrcset).map((candidate) => localMediaSrc(candidate.source)),
    );
  }

  for (const element of root.querySelectorAll<Element>(MEDIA_STYLE_SELECTOR)) {
    styleSlots.push(styleMediaSlots(element.getAttribute("style") ?? ""));
  }

  return { srcSlots, srcsetSlots, styleSlots };
}

function tagCollectedMediaTargets(
  srcTargets: MediaSrcTarget[],
  srcsetTargets: MediaSrcsetTarget[],
): void {
  for (const target of srcTargets) {
    target.element.setAttribute(MEDIA_SOURCE_URL_ATTRIBUTE, target.url);
  }
  for (const target of srcsetTargets) {
    target.element.setAttribute(
      MEDIA_SRCSET_SOURCE_ATTRIBUTE,
      formatSrcset(target.candidates),
    );
  }
}

function clearMediaSourceMetadata(root: DocumentFragment): void {
  for (const element of root.querySelectorAll<Element>(
    `[${MEDIA_SOURCE_URL_ATTRIBUTE}],[${MEDIA_SRCSET_SOURCE_ATTRIBUTE}]`,
  )) {
    element.removeAttribute(MEDIA_SOURCE_URL_ATTRIBUTE);
    element.removeAttribute(MEDIA_SRCSET_SOURCE_ATTRIBUTE);
  }
}

function collectMetadataReusableMediaSources(
  root: DocumentFragment,
  baseUrl: string,
  urls: Set<string>,
): Map<string, string> {
  const reusable = new Map<string, string>();

  for (const element of root.querySelectorAll<Element>(
    `[${MEDIA_SOURCE_URL_ATTRIBUTE}]`,
  )) {
    const sourceUrl = absoluteMediaUrl(
      element.getAttribute(MEDIA_SOURCE_URL_ATTRIBUTE) ?? "",
      baseUrl,
    );
    const src = localMediaSrc(element.getAttribute("src"));
    if (sourceUrl && src && urls.has(sourceUrl)) {
      reusable.set(sourceUrl, src);
    }
  }

  for (const element of root.querySelectorAll<Element>(
    `[${MEDIA_SRCSET_SOURCE_ATTRIBUTE}]`,
  )) {
    const sourceCandidates = parseSrcset(
      element.getAttribute(MEDIA_SRCSET_SOURCE_ATTRIBUTE) ?? "",
    );
    const localCandidates = parseSrcset(
      element.getAttribute("srcset") ?? "",
    ).map((candidate) => localMediaSrc(candidate.source));
    for (
      let index = 0;
      index < sourceCandidates.length && index < localCandidates.length;
      index += 1
    ) {
      const sourceUrl = absoluteMediaUrl(
        sourceCandidates[index]!.source,
        baseUrl,
      );
      const src = localCandidates[index];
      if (sourceUrl && src && urls.has(sourceUrl)) {
        reusable.set(sourceUrl, src);
      }
    }
  }

  return reusable;
}

function collectSlotReusableMediaSources({
  baseUrl,
  root,
  srcTargets,
  srcsetTargets,
  styleTargets,
}: {
  baseUrl: string;
  root: DocumentFragment;
  srcTargets: MediaSrcTarget[];
  srcsetTargets: MediaSrcsetTarget[];
  styleTargets: MediaStyleTarget[];
}): Map<string, string> {
  const reusable = new Map<string, string>();
  const existingSlots = collectExistingMediaSlots(root);

  srcTargets.forEach((target, index) => {
    const src = existingSlots.srcSlots[index];
    if (src) reusable.set(target.url, src);
  });

  srcsetTargets.forEach((target, index) => {
    const localCandidates = existingSlots.srcsetSlots[index] ?? [];
    for (
      let candidateIndex = 0;
      candidateIndex < target.candidates.length &&
      candidateIndex < localCandidates.length;
      candidateIndex += 1
    ) {
      const sourceUrl = absoluteMediaUrl(
        target.candidates[candidateIndex]!.source,
        baseUrl,
      );
      const src = localCandidates[candidateIndex];
      if (sourceUrl && src) reusable.set(sourceUrl, src);
    }
  });

  styleTargets.forEach((target, index) => {
    const localSources = existingSlots.styleSlots[index] ?? [];
    for (
      let styleIndex = 0;
      styleIndex < target.urls.length && styleIndex < localSources.length;
      styleIndex += 1
    ) {
      const src = localSources[styleIndex];
      if (src) reusable.set(target.urls[styleIndex]!.url, src);
    }
  });

  return reusable;
}

function collectReusableMediaSources({
  baseUrl,
  chapterId,
  previousHtml,
  srcTargets,
  srcsetTargets,
  styleTargets,
  urls,
}: {
  baseUrl: string;
  chapterId: number;
  previousHtml: string | null | undefined;
  srcTargets: MediaSrcTarget[];
  srcsetTargets: MediaSrcsetTarget[];
  styleTargets: MediaStyleTarget[];
  urls: string[];
}): Map<string, string> {
  if (!previousHtml?.includes(LOCAL_MEDIA_SRC_PREFIX)) {
    return new Map();
  }

  const template = document.createElement("template");
  template.innerHTML = previousHtml;
  const urlSet = new Set(urls);
  const reusable = collectMetadataReusableMediaSources(
    template.content,
    baseUrl,
    urlSet,
  );
  const slotReusable = collectSlotReusableMediaSources({
    baseUrl,
    root: template.content,
    srcTargets,
    srcsetTargets,
    styleTargets,
  });
  for (const [url, src] of slotReusable) {
    if (!reusable.has(url)) reusable.set(url, src);
  }

  for (const [url, src] of reusable) {
    if (!urlSet.has(url) || !cacheKeyFromLocalMediaSrc(src, chapterId)) {
      reusable.delete(url);
    }
  }
  return reusable;
}

async function filterExistingReusableMediaSources(
  reusableSources: Map<string, string>,
  context: ChapterMediaStorageContext,
): Promise<Map<string, string>> {
  const existing = new Map<string, string>();
  for (const [url, src] of reusableSources) {
    if ((await getStoredChapterMediaBytes(src, context)) > 0) {
      existing.set(url, src);
    }
  }
  return existing;
}

function chooseCacheKey(
  chapterId: number,
  reusableSources: Iterable<string>,
): string {
  for (const src of reusableSources) {
    const cacheKey = cacheKeyFromLocalMediaSrc(src, chapterId);
    if (cacheKey) return cacheKey;
  }
  return makeCacheKey();
}

function outputMediaSourceForUrl(
  localSources: Map<string, string>,
  url: string,
): string {
  return localSources.get(url) ?? url;
}

function applyResolvedMediaSource({
  baseUrl,
  localSources,
  srcTargets,
  srcsetTargets,
  styleTargets,
  url,
}: {
  baseUrl: string;
  localSources: Map<string, string>;
  srcTargets: MediaSrcTarget[];
  srcsetTargets: MediaSrcsetTarget[];
  styleTargets: MediaStyleTarget[];
  url: string;
}): Set<Element> {
  const changedElements = new Set<Element>();
  for (const target of srcTargets) {
    if (target.url !== url) continue;
    const outputAttribute = mediaOutputAttribute(target.attribute);
    target.element.setAttribute(
      outputAttribute,
      outputMediaSourceForUrl(localSources, target.url),
    );
    if (target.attribute !== outputAttribute) {
      target.element.removeAttribute(target.attribute);
    }
    changedElements.add(target.element);
  }

  for (const target of srcsetTargets) {
    if (
      !target.candidates.some(
        (candidate) => absoluteMediaUrl(candidate.source, baseUrl) === url,
      )
    ) {
      continue;
    }
    const candidates = target.candidates
      .map((candidate) => {
        const candidateUrl = absoluteMediaUrl(candidate.source, baseUrl);
        if (!candidateUrl) return candidate;
        return {
          ...candidate,
          source: outputMediaSourceForUrl(localSources, candidateUrl),
        };
      })
      .filter((candidate) => candidate.source !== "");
    target.element.setAttribute("srcset", formatSrcset(candidates));
    changedElements.add(target.element);
  }

  for (const target of styleTargets) {
    if (!target.urls.some((styleUrl) => styleUrl.url === url)) continue;
    target.element.setAttribute(
      "style",
      rewriteStyleMediaUrls(
        target.style,
        baseUrl,
        (styleUrl) => outputMediaSourceForUrl(localSources, styleUrl),
      ),
    );
    changedElements.add(target.element);
  }
  return changedElements;
}

function safeChapterMediaHtml(template: HTMLTemplateElement): string {
  const safeTemplate = document.createElement("template");
  safeTemplate.innerHTML = template.innerHTML;
  clearMediaSourceMetadata(safeTemplate.content);
  return safeTemplate.innerHTML;
}

async function emitHtmlUpdate(
  onHtmlUpdate: CacheChapterMediaOptions["onHtmlUpdate"],
  template: HTMLTemplateElement,
): Promise<void> {
  await onHtmlUpdate?.(safeChapterMediaHtml(template));
}

function collectMediaElementPatches(
  root: DocumentFragment,
  changedElements: Set<Element>,
): ChapterMediaElementPatch[] {
  if (changedElements.size === 0) return [];
  const elements = [...root.querySelectorAll<Element>(MEDIA_PATCH_SELECTOR)];
  const patches: ChapterMediaElementPatch[] = [];
  elements.forEach((element, index) => {
    if (!changedElements.has(element)) return;
    const attributes: Record<string, string> = {};
    for (const attribute of MEDIA_PATCH_ATTRIBUTES) {
      const value = element.getAttribute(attribute);
      if (value?.trim()) attributes[attribute] = value;
    }
    if (Object.keys(attributes).length > 0) {
      patches.push({ index, attributes });
    }
  });
  return patches;
}

export function collectChapterMediaElementPatches(
  html: string,
): ChapterMediaElementPatch[] {
  if (typeof document === "undefined") return [];
  const template = document.createElement("template");
  template.innerHTML = html;
  return collectMediaElementPatches(
    template.content,
    collectAllMediaPatchElements(template.content),
  );
}

function collectAllMediaPatchElements(root: DocumentFragment): Set<Element> {
  const changedElements = new Set<Element>();
  for (const element of root.querySelectorAll<Element>(MEDIA_PATCH_SELECTOR)) {
    if (
      MEDIA_PATCH_ATTRIBUTES.some(
        (attribute) => (element.getAttribute(attribute) ?? "").trim() !== "",
      )
    ) {
      changedElements.add(element);
    }
  }
  return changedElements;
}

async function emitMediaPatchUpdate(
  onMediaPatch: CacheChapterMediaOptions["onMediaPatch"],
  template: HTMLTemplateElement,
  changedElements: Set<Element>,
): Promise<void> {
  const patches = collectMediaElementPatches(template.content, changedElements);
  if (patches.length > 0) {
    await onMediaPatch?.(patches);
  }
}

function isMediaAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function mediaFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sanitizedMediaUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return url.split(/[?#]/, 1)[0] ?? url;
  }
}

function mediaFailureHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

function mediaFailureContextHost(contextUrl: string): string {
  try {
    return new URL(contextUrl).host;
  } catch {
    return "";
  }
}

function recordChapterMediaFailure(
  failures: ChapterMediaFailure[],
  input: {
    contextUrl: string;
    error: unknown;
    scraperExecutor?: ScraperExecutorId;
    sourceId?: string;
    status?: number;
    url: string;
  },
): void {
  const message = mediaFailureMessage(input.error);
  failures.push({
    message,
    ...(input.status ? { status: input.status } : {}),
    url: input.url,
  });
  console.warn("[chapter-media] media asset using remote fallback", {
    contextHost: mediaFailureContextHost(input.contextUrl),
    error: message,
    host: mediaFailureHost(input.url),
    sanitizedUrl: sanitizedMediaUrl(input.url),
    scraperExecutor: input.scraperExecutor,
    sourceId: input.sourceId,
    status: input.status,
  });
}

export async function cacheHtmlChapterMedia({
  baseUrl,
  chapterId,
  chapterName,
  chapterNumber,
  chapterPosition,
  contextUrl,
  html,
  novelId,
  novelName,
  novelPath,
  onHtmlUpdate,
  onMediaPatch,
  onProgress,
  previousHtml,
  requestInit,
  scraperExecutor,
  signal,
  sourceId,
}: CacheChapterMediaOptions): Promise<CacheChapterMediaResult> {
  if (!isTauriRuntime() || typeof document === "undefined") {
    return {
      cacheKey: null,
      html,
      mediaBytes: 0,
      mediaFailures: [],
      storedMediaCount: 0,
    };
  }

  const template = document.createElement("template");
  template.innerHTML = html;
  const { srcTargets, srcsetTargets, styleTargets, urls } = collectMediaTargets(
    template.content,
    baseUrl,
  );

  if (urls.length === 0) {
    return {
      cacheKey: null,
      html: template.innerHTML,
      mediaBytes: 0,
      mediaFailures: [],
      storedMediaCount: 0,
    };
  }

  const storageContext: ChapterMediaStorageContext = {
    chapterId,
    chapterName,
    chapterNumber,
    chapterPosition,
    novelId,
    novelName,
    novelPath,
    sourceId,
  };
  const reusableSources = await filterExistingReusableMediaSources(
    collectReusableMediaSources({
      baseUrl,
      chapterId,
      previousHtml,
      srcTargets,
      srcsetTargets,
      styleTargets,
      urls,
    }),
    storageContext,
  );
  const cacheKey = chooseCacheKey(chapterId, reusableSources.values());
  const localSources = new Map<string, string>(reusableSources);
  const mediaFailures: ChapterMediaFailure[] = [];
  let storedMediaCount = 0;
  tagCollectedMediaTargets(srcTargets, srcsetTargets);
  const reusableChangedElements = new Set<Element>();
  for (const url of urls) {
    const changedElements = applyResolvedMediaSource({
      baseUrl,
      localSources,
      srcTargets,
      srcsetTargets,
      styleTargets,
      url,
    });
    for (const element of changedElements) {
      reusableChangedElements.add(element);
    }
  }
  await emitHtmlUpdate(onHtmlUpdate, template);
  await emitMediaPatchUpdate(onMediaPatch, template, reusableChangedElements);

  for (let index = 0; index < urls.length; index += 1) {
    throwIfAborted(signal);
    const url = urls[index]!;
    if (localSources.has(url)) {
      onProgress?.({ current: index + 1, total: urls.length });
      continue;
    }
    try {
      const response = await pluginMediaFetch(url, {
        ...requestInit,
        headers: {
          Accept: DEFAULT_MEDIA_ACCEPT,
          ...(requestInit?.headers ?? {}),
        },
        contextUrl: contextUrl ?? baseUrl,
        ...(scraperExecutor ? { scraperExecutor } : {}),
        signal,
        ...(sourceId ? { sourceId } : {}),
      });
      if (!response.ok) {
        recordChapterMediaFailure(mediaFailures, {
          contextUrl: contextUrl ?? baseUrl,
          error: `HTTP ${response.status} ${response.statusText}`,
          scraperExecutor,
          sourceId,
          status: response.status,
          url,
        });
      } else {
        throwIfAborted(signal);
        const body = bytesFromArrayBuffer(await response.arrayBuffer());
        throwIfAborted(signal);
        const contentType = response.headers.get("content-type");
        const src = await storeChapterMedia({
          body,
          cacheKey,
          chapterId,
          contentType,
          fileName: mediaFileName(index, url, contentType),
          chapterName,
          chapterNumber,
          chapterPosition,
          novelId,
          novelName,
          novelPath,
          sourceId,
          sourceUrl: url,
        });
        localSources.set(url, src);
        storedMediaCount += 1;
      }
    } catch (error) {
      if (signal?.aborted) {
        throw new DOMException("Task was cancelled.", "AbortError");
      }
      if (isMediaAbortError(error)) throw error;
      recordChapterMediaFailure(mediaFailures, {
        contextUrl: contextUrl ?? baseUrl,
        error,
        scraperExecutor,
        sourceId,
        url,
      });
    }
    throwIfAborted(signal);
    const changedElements = applyResolvedMediaSource({
      baseUrl,
      localSources,
      srcTargets,
      srcsetTargets,
      styleTargets,
      url,
    });
    await emitHtmlUpdate(onHtmlUpdate, template);
    await emitMediaPatchUpdate(onMediaPatch, template, changedElements);
    onProgress?.({ current: index + 1, total: urls.length });
  }

  if (localSources.size === 0) {
    clearMediaSourceMetadata(template.content);
    return {
      cacheKey: null,
      html: template.innerHTML,
      mediaBytes: 0,
      mediaFailures,
      storedMediaCount,
    };
  }

  const mediaBytes = await archiveChapterMediaCache({
    chapterId,
    cacheKey,
    chapterName,
    chapterNumber,
    chapterPosition,
    novelId,
    novelName,
    novelPath,
    sourceId,
  });
  clearMediaSourceMetadata(template.content);
  await emitMediaPatchUpdate(
    onMediaPatch,
    template,
    collectAllMediaPatchElements(template.content),
  );

  return {
    cacheKey,
    html: template.innerHTML,
    mediaFailures,
    mediaBytes,
    storedMediaCount,
  };
}

function chapterMediaInvokeArgs(
  mediaSrc: string,
  context?: ChapterMediaStorageContext,
): Record<string, unknown> {
  return {
    mediaSrc,
    ...(context?.chapterName ? { chapterName: context.chapterName } : {}),
    ...(context?.chapterNumber ? { chapterNumber: context.chapterNumber } : {}),
    ...(context?.chapterPosition
      ? { chapterPosition: context.chapterPosition }
      : {}),
    ...(context?.novelId ? { novelId: context.novelId } : {}),
    ...(context?.novelName ? { novelName: context.novelName } : {}),
    ...(context?.novelPath ? { novelPath: context.novelPath } : {}),
    ...(context?.sourceId ? { sourceId: context.sourceId } : {}),
  };
}

export async function resolveLocalChapterMediaSrc(
  src: string,
  context?: ChapterMediaStorageContext,
): Promise<string | null> {
  if (!src.startsWith(LOCAL_MEDIA_SRC_PREFIX)) return src;
  if (!isTauriRuntime()) return src;
  if (isAndroidRuntime()) {
    const relativePath = await androidRelativePathFromLocalMediaSrc(
      src,
      context,
    );
    if (!relativePath) return null;
    const directDataUrl = await readAndroidStorageDataUrl(relativePath);
    if (directDataUrl) return directDataUrl;

    const parsed = parseLocalChapterMediaSrc(src);
    const archivePath = parsed
      ? androidArchiveRelativePathFromMediaRelativePath(
          relativePath,
          parsed.cacheKey,
        )
      : null;
    return archivePath && parsed
      ? readAndroidStorageZipEntryDataUrl(archivePath, parsed.fileName)
      : null;
  }
  try {
    return await invoke<string>(
      "chapter_media_data_url",
      chapterMediaInvokeArgs(src, context),
    );
  } catch {
    return null;
  }
}

export async function resolveLocalChapterMediaPatches(
  patches: ChapterMediaElementPatch[],
  context?: ChapterMediaStorageContext,
): Promise<ChapterMediaElementPatch[]> {
  return Promise.all(
    patches.map(async (patch) => {
      const attributes: Record<string, string> = {};
      await Promise.all(
        Object.entries(patch.attributes).map(async ([attribute, value]) => {
          if (attribute === "srcset" && value.includes(LOCAL_MEDIA_SRC_PREFIX)) {
            const resolvedCandidates = (
              await Promise.all(
                parseSrcset(value).map(async (candidate) => {
                  const src = await resolveLocalChapterMediaSrc(
                    candidate.source,
                    context,
                  );
                  return src ? { ...candidate, source: src } : null;
                }),
              )
            ).filter(
              (candidate): candidate is SrcsetCandidate => candidate !== null,
            );
            if (resolvedCandidates.length > 0) {
              attributes[attribute] = formatSrcset(resolvedCandidates);
            }
            return;
          }
          if (attribute === "style" && value.includes(LOCAL_MEDIA_SRC_PREFIX)) {
            const localSources = localStyleMediaSources(value);
            const resolvedSources = new Map<string, string | null>();
            await Promise.all(
              localSources.map(async (source) => {
                if (!resolvedSources.has(source)) {
                  resolvedSources.set(
                    source,
                    await resolveLocalChapterMediaSrc(source, context),
                  );
                }
              }),
            );
            attributes[attribute] = value.replace(
              STYLE_URL_PATTERN,
              (match, doubleQuoted, singleQuoted, unquoted) => {
                const source = String(
                  doubleQuoted ?? singleQuoted ?? unquoted ?? "",
                ).trim();
                if (!source.startsWith(LOCAL_MEDIA_SRC_PREFIX)) return match;
                return `url("${resolvedSources.get(source) ?? ""}")`;
              },
            );
            return;
          }
          const src = await resolveLocalChapterMediaSrc(value, context);
          if (src) attributes[attribute] = src;
        }),
      );
      return { ...patch, attributes };
    }),
  );
}

export async function resolveLocalChapterMedia(
  html: string,
  context?: ChapterMediaStorageContext,
): Promise<string> {
  if (
    !isTauriRuntime() ||
    typeof document === "undefined" ||
    !html.includes(LOCAL_MEDIA_SRC_PREFIX)
  ) {
    return html;
  }

  const template = document.createElement("template");
  template.innerHTML = html;
  const mediaElements = [
    ...template.content.querySelectorAll<Element>(MEDIA_SOURCE_SELECTOR),
  ];
  const styleElements = [
    ...template.content.querySelectorAll<Element>(MEDIA_STYLE_SELECTOR),
  ];

  await Promise.all(
    mediaElements.map(async (element) => {
      for (const attribute of MEDIA_SRC_ATTRIBUTES) {
        const rawSource = element.getAttribute(attribute);
        if (!rawSource?.startsWith(LOCAL_MEDIA_SRC_PREFIX)) continue;
        const src = await resolveLocalChapterMediaSrc(rawSource, context);
        const outputAttribute = mediaOutputAttribute(attribute);
        if (src) {
          element.setAttribute(outputAttribute, src);
        } else {
          element.removeAttribute(outputAttribute);
        }
        if (attribute !== outputAttribute) {
          element.removeAttribute(attribute);
        }
      }

      const rawSrcset = element.getAttribute("srcset");
      if (!rawSrcset?.includes(LOCAL_MEDIA_SRC_PREFIX)) return;
      const resolvedCandidates = (
        await Promise.all(
          parseSrcset(rawSrcset).map(async (candidate) => {
            const src = await resolveLocalChapterMediaSrc(
              candidate.source,
              context,
            );
            return src ? { ...candidate, source: src } : null;
          }),
        )
      ).filter((candidate): candidate is SrcsetCandidate => candidate !== null);
      if (resolvedCandidates.length > 0) {
        element.setAttribute("srcset", formatSrcset(resolvedCandidates));
      } else {
        element.removeAttribute("srcset");
      }
    }),
  );

  await Promise.all(
    styleElements.map(async (element) => {
      const rawStyle = element.getAttribute("style");
      if (!rawStyle?.includes(LOCAL_MEDIA_SRC_PREFIX)) return;
      const localSources = localStyleMediaSources(rawStyle);
      const resolvedSources = new Map<string, string | null>();
      await Promise.all(
        localSources.map(async (source) => {
          if (!resolvedSources.has(source)) {
            resolvedSources.set(
              source,
              await resolveLocalChapterMediaSrc(source, context),
            );
          }
        }),
      );
      const resolvedStyle = rawStyle.replace(
        STYLE_URL_PATTERN,
        (match, doubleQuoted, singleQuoted, unquoted) => {
          const source = String(
            doubleQuoted ?? singleQuoted ?? unquoted ?? "",
          ).trim();
          if (!source.startsWith(LOCAL_MEDIA_SRC_PREFIX)) return match;
          return `url("${resolvedSources.get(source) ?? ""}")`;
        },
      );
      element.setAttribute("style", resolvedStyle);
    }),
  );

  return template.innerHTML;
}

export async function pruneChapterMedia(
  chapterId: number,
  keepCacheKey: string,
  context?: ChapterMediaStorageContext,
): Promise<void> {
  if (!isTauriRuntime()) return;
  const resolvedContext = context ?? (await storageContextForChapter(chapterId));
  if (isAndroidRuntime()) {
    if (hasStorageContext(resolvedContext)) {
      await deleteAndroidStorageChildrenExcept(
        chapterMediaDirectoryRelativePath(
          storageNovelPathInput(resolvedContext),
          storageChapterPathInput(resolvedContext),
        ),
        keepCacheKey,
      );
      try {
        await pruneAndroidChapterMediaManifest(resolvedContext, keepCacheKey);
      } catch (error) {
        console.warn("[chapter-media] manifest prune failed", error);
      }
    }
    await deleteAndroidStorageChildrenExcept(
      `chapter-media/${chapterId}`,
      keepCacheKey,
    );
    try {
      await pruneAndroidChapterMediaManifest({ chapterId }, keepCacheKey);
    } catch (error) {
      console.warn("[chapter-media] manifest prune failed", error);
    }
    return;
  }
  await invoke("chapter_media_prune", {
    chapterId,
    keepCacheKey,
    ...(resolvedContext?.chapterName
      ? { chapterName: resolvedContext.chapterName }
      : {}),
    ...(resolvedContext?.chapterNumber
      ? { chapterNumber: resolvedContext.chapterNumber }
      : {}),
    ...(resolvedContext?.chapterPosition
      ? { chapterPosition: resolvedContext.chapterPosition }
      : {}),
    ...(resolvedContext?.novelId ? { novelId: resolvedContext.novelId } : {}),
    ...(resolvedContext?.novelName
      ? { novelName: resolvedContext.novelName }
      : {}),
    ...(resolvedContext?.novelPath
      ? { novelPath: resolvedContext.novelPath }
      : {}),
    ...(resolvedContext?.sourceId
      ? { sourceId: resolvedContext.sourceId }
      : {}),
  });
}

export async function clearChapterMedia(
  chapterId: number,
  context?: ChapterMediaStorageContext,
): Promise<void> {
  if (!isTauriRuntime()) return;
  const resolvedContext = context ?? (await storageContextForChapter(chapterId));
  if (isAndroidRuntime()) {
    if (hasStorageContext(resolvedContext)) {
      await deleteAndroidStoragePath(
        chapterMediaDirectoryRelativePath(
          storageNovelPathInput(resolvedContext),
          storageChapterPathInput(resolvedContext),
        ),
      );
    }
    await deleteAndroidStoragePath(`chapter-media/${chapterId}`);
    return;
  }
  await invoke("chapter_media_clear", {
    chapterId,
    ...(resolvedContext?.chapterName
      ? { chapterName: resolvedContext.chapterName }
      : {}),
    ...(resolvedContext?.chapterNumber
      ? { chapterNumber: resolvedContext.chapterNumber }
      : {}),
    ...(resolvedContext?.chapterPosition
      ? { chapterPosition: resolvedContext.chapterPosition }
      : {}),
    ...(resolvedContext?.novelId ? { novelId: resolvedContext.novelId } : {}),
    ...(resolvedContext?.novelName
      ? { novelName: resolvedContext.novelName }
      : {}),
    ...(resolvedContext?.novelPath
      ? { novelPath: resolvedContext.novelPath }
      : {}),
    ...(resolvedContext?.sourceId
      ? { sourceId: resolvedContext.sourceId }
      : {}),
  });
}

export async function clearAllChapterMedia(): Promise<void> {
  if (!isTauriRuntime()) return;
  if (isAndroidRuntime()) {
    await clearAndroidStorageRoot();
    return;
  }
  await invoke("chapter_media_clear_all");
}
