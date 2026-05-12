import { invoke } from "@tauri-apps/api/core";
import {
  androidStoragePathSize,
  clearAndroidStorageRoot,
  deleteAndroidStorageChildrenExcept,
  deleteAndroidStoragePath,
  readAndroidStorageDataUrl,
  writeAndroidStorageBytes,
} from "./android-storage";
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
const STYLE_URL_PATTERN =
  /url\(\s*(?:"([^"]*)"|'([^']*)'|([^'")]*?))\s*\)/gi;
const DEFAULT_MEDIA_EXTENSION = "bin";
const DEFAULT_MEDIA_ACCEPT =
  "image/avif,image/webp,image/apng,image/svg+xml,image/*,video/*,audio/*,*/*;q=0.8";

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
  onHtmlUpdate?: (html: string) => Promise<void> | void;
  onProgress?: (progress: { current: number; total: number }) => void;
  previousHtml?: string | null;
  requestInit?: ChapterMediaRequestInit;
  scraperExecutor?: ScraperExecutorId;
  signal?: AbortSignal;
  sourceId?: string;
}

interface CacheChapterMediaResult {
  cacheKey: string | null;
  html: string;
  mediaBytes: number;
}

interface ChapterMediaStoreInput {
  body: number[];
  cacheKey: string;
  chapterId: number;
  chapterName?: string | null;
  chapterNumber?: string | null;
  chapterPosition?: number | null;
  fileName: string;
  novelId?: number;
  novelName?: string | null;
  sourceId?: string;
}

interface ChapterMediaArchiveInput {
  cacheKey: string;
  chapterId: number;
  chapterName?: string | null;
  chapterNumber?: string | null;
  chapterPosition?: number | null;
  novelId?: number;
  novelName?: string | null;
  sourceId?: string;
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
  srcsetSlots: string[][];
  styleSlots: string[][];
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
  return [...style.matchAll(STYLE_URL_PATTERN)]
    .map((match) => (match[1] ?? match[2] ?? match[3] ?? "").trim())
    .filter((source) => source.startsWith(LOCAL_MEDIA_SRC_PREFIX));
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
    .slice(0, 80);
  return stem === "" || stem === "." || stem === ".." ? fallback : stem;
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
  return `${safeFileStem(leaf, `image-${index + 1}`)}-${index + 1}.${extension}`;
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

function androidRelativePathFromLocalMediaSrc(src: string): string | null {
  const match = src.match(LOCAL_CHAPTER_MEDIA_SRC_DETAIL_PATTERN);
  if (!match) return null;
  return androidChapterMediaRelativePath(Number(match[1]), match[2]!, match[3]!);
}

export function localChapterMediaSources(html: string): string[] {
  return [...new Set(html.match(LOCAL_CHAPTER_MEDIA_SRC_PATTERN) ?? [])];
}

export async function getStoredChapterMediaBytes(html: string): Promise<number> {
  if (!isTauriRuntime()) return 0;
  const mediaSrcs = localChapterMediaSources(html);
  if (mediaSrcs.length === 0) return 0;
  if (isAndroidRuntime()) {
    let total = 0;
    const paths = [
      ...new Set(
        mediaSrcs
          .map(androidRelativePathFromLocalMediaSrc)
          .filter((path): path is string => path !== null),
      ),
    ];
    for (const path of paths) {
      total += await androidStoragePathSize(path);
    }
    return total;
  }
  return invoke<number>("chapter_media_total_size", { mediaSrcs });
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
  fileName,
  novelId,
  novelName,
  sourceId,
}: ChapterMediaStoreInput): Promise<string> {
  if (isAndroidRuntime()) {
    const src = localChapterMediaSrc(chapterId, cacheKey, fileName);
    await writeAndroidStorageBytes(
      androidChapterMediaRelativePath(chapterId, cacheKey, fileName),
      body,
      mimeTypeFromFileName(fileName),
    );
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
    ...(sourceId ? { sourceId } : {}),
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
  sourceId,
}: ChapterMediaArchiveInput): Promise<number> {
  if (isAndroidRuntime()) {
    return androidStoragePathSize(androidChapterMediaRelativePath(chapterId, cacheKey));
  }
  return invoke<number>("chapter_media_archive_cache", {
    chapterId,
    ...(chapterName ? { chapterName } : {}),
    ...(chapterNumber ? { chapterNumber } : {}),
    ...(chapterPosition ? { chapterPosition } : {}),
    cacheKey,
    ...(novelId ? { novelId } : {}),
    ...(novelName ? { novelName } : {}),
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
  const srcsetSlots: string[][] = [];
  const styleSlots: string[][] = [];

  for (const element of root.querySelectorAll<Element>(MEDIA_SOURCE_SELECTOR)) {
    for (const attribute of MEDIA_SRC_ATTRIBUTES) {
      const rawSource = element.getAttribute(attribute);
      if (rawSource === null) continue;
      srcSlots.push(localMediaSrc(rawSource));
    }

    const rawSrcset = element.getAttribute("srcset");
    if (rawSrcset === null) continue;
    srcsetSlots.push(
      parseSrcset(rawSrcset)
        .map((candidate) => localMediaSrc(candidate.source))
        .filter((src): src is string => src !== null),
    );
  }

  for (const element of root.querySelectorAll<Element>(MEDIA_STYLE_SELECTOR)) {
    styleSlots.push(localStyleMediaSources(element.getAttribute("style") ?? ""));
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

function blankCollectedMediaTargets(
  baseUrl: string,
  srcTargets: MediaSrcTarget[],
  srcsetTargets: MediaSrcsetTarget[],
  styleTargets: MediaStyleTarget[],
): void {
  for (const target of srcTargets) {
    target.element.setAttribute(target.attribute, "");
  }
  for (const target of srcsetTargets) {
    target.element.setAttribute("srcset", "");
  }
  for (const target of styleTargets) {
    target.element.setAttribute(
      "style",
      rewriteStyleMediaUrls(target.style, baseUrl, () => ""),
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
    const localCandidates = parseSrcset(element.getAttribute("srcset") ?? "")
      .map((candidate) => localMediaSrc(candidate.source))
      .filter((src): src is string => src !== null);
    for (
      let index = 0;
      index < sourceCandidates.length && index < localCandidates.length;
      index += 1
    ) {
      const sourceUrl = absoluteMediaUrl(
        sourceCandidates[index]!.source,
        baseUrl,
      );
      if (sourceUrl && urls.has(sourceUrl)) {
        reusable.set(sourceUrl, localCandidates[index]!);
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

function applyLocalMediaSource({
  baseUrl,
  localSources,
  src,
  srcTargets,
  srcsetTargets,
  styleTargets,
  url,
}: {
  baseUrl: string;
  localSources: Map<string, string>;
  src: string;
  srcTargets: MediaSrcTarget[];
  srcsetTargets: MediaSrcsetTarget[];
  styleTargets: MediaStyleTarget[];
  url: string;
}): void {
  for (const target of srcTargets) {
    if (target.url !== url) continue;
    const outputAttribute = mediaOutputAttribute(target.attribute);
    target.element.setAttribute(outputAttribute, src);
    if (target.attribute !== outputAttribute) {
      target.element.removeAttribute(target.attribute);
    }
  }

  for (const target of srcsetTargets) {
    const candidates = target.candidates
      .map((candidate) => {
        const candidateUrl = absoluteMediaUrl(candidate.source, baseUrl);
        if (!candidateUrl) return candidate;
        return {
          ...candidate,
          source: localSources.get(candidateUrl) ?? "",
        };
      })
      .filter((candidate) => candidate.source !== "");
    target.element.setAttribute("srcset", formatSrcset(candidates));
  }

  for (const target of styleTargets) {
    if (!target.urls.some((styleUrl) => styleUrl.url === url)) continue;
    target.element.setAttribute(
      "style",
      rewriteStyleMediaUrls(
        target.style,
        baseUrl,
        (styleUrl) => localSources.get(styleUrl) ?? "",
      ),
    );
  }
}

async function emitHtmlUpdate(
  onHtmlUpdate: CacheChapterMediaOptions["onHtmlUpdate"],
  template: HTMLTemplateElement,
): Promise<void> {
  await onHtmlUpdate?.(template.innerHTML);
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
  onHtmlUpdate,
  onProgress,
  previousHtml,
  requestInit,
  scraperExecutor,
  signal,
  sourceId,
}: CacheChapterMediaOptions): Promise<CacheChapterMediaResult> {
  if (!isTauriRuntime() || typeof document === "undefined") {
    return { cacheKey: null, html, mediaBytes: 0 };
  }

  const template = document.createElement("template");
  template.innerHTML = html;
  const { srcTargets, srcsetTargets, styleTargets, urls } = collectMediaTargets(
    template.content,
    baseUrl,
  );

  if (urls.length === 0) {
    return { cacheKey: null, html: template.innerHTML, mediaBytes: 0 };
  }

  const reusableSources = collectReusableMediaSources({
    baseUrl,
    chapterId,
    previousHtml,
    srcTargets,
    srcsetTargets,
    styleTargets,
    urls,
  });
  const cacheKey = chooseCacheKey(chapterId, reusableSources.values());
  const localSources = new Map<string, string>(reusableSources);
  tagCollectedMediaTargets(srcTargets, srcsetTargets);
  blankCollectedMediaTargets(baseUrl, srcTargets, srcsetTargets, styleTargets);
  for (const [url, src] of localSources) {
    applyLocalMediaSource({
      baseUrl,
      localSources,
      src,
      srcTargets,
      srcsetTargets,
      styleTargets,
      url,
    });
  }
  await emitHtmlUpdate(onHtmlUpdate, template);

  for (let index = 0; index < urls.length; index += 1) {
    throwIfAborted(signal);
    const url = urls[index]!;
    if (localSources.has(url)) {
      onProgress?.({ current: index + 1, total: urls.length });
      continue;
    }
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
      throw new Error(
        `HTTP ${response.status} ${response.statusText} on ${url}`,
      );
    }
    throwIfAborted(signal);
    const body = bytesFromArrayBuffer(await response.arrayBuffer());
    throwIfAborted(signal);
    const src = await storeChapterMedia({
      body,
      cacheKey,
      chapterId,
      fileName: mediaFileName(
        index,
        url,
        response.headers.get("content-type"),
      ),
      chapterName,
      chapterNumber,
      chapterPosition,
      novelId,
      novelName,
      sourceId,
    });
    localSources.set(url, src);
    applyLocalMediaSource({
      baseUrl,
      localSources,
      src,
      srcTargets,
      srcsetTargets,
      styleTargets,
      url,
    });
    await emitHtmlUpdate(onHtmlUpdate, template);
    onProgress?.({ current: index + 1, total: urls.length });
  }

  const mediaBytes = await archiveChapterMediaCache({
    chapterId,
    cacheKey,
    chapterName,
    chapterNumber,
    chapterPosition,
    novelId,
    novelName,
    sourceId,
  });
  clearMediaSourceMetadata(template.content);

  return {
    cacheKey,
    html: template.innerHTML,
    mediaBytes,
  };
}

export async function resolveLocalChapterMedia(html: string): Promise<string> {
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

  const resolveMediaSrc = async (src: string): Promise<string | null> => {
    if (!src.startsWith(LOCAL_MEDIA_SRC_PREFIX)) return src;
    if (isAndroidRuntime()) {
      const relativePath = androidRelativePathFromLocalMediaSrc(src);
      return relativePath ? readAndroidStorageDataUrl(relativePath) : null;
    }
    try {
      return await invoke<string>("chapter_media_data_url", {
        mediaSrc: src,
      });
    } catch {
      return null;
    }
  };

  await Promise.all(
    mediaElements.map(async (element) => {
      for (const attribute of MEDIA_SRC_ATTRIBUTES) {
        const rawSource = element.getAttribute(attribute);
        if (!rawSource?.startsWith(LOCAL_MEDIA_SRC_PREFIX)) continue;
        const src = await resolveMediaSrc(rawSource);
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
            const src = await resolveMediaSrc(candidate.source);
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
            resolvedSources.set(source, await resolveMediaSrc(source));
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
): Promise<void> {
  if (!isTauriRuntime()) return;
  if (isAndroidRuntime()) {
    await deleteAndroidStorageChildrenExcept(
      `chapter-media/${chapterId}`,
      keepCacheKey,
    );
    return;
  }
  await invoke("chapter_media_prune", { chapterId, keepCacheKey });
}

export async function clearChapterMedia(chapterId: number): Promise<void> {
  if (!isTauriRuntime()) return;
  if (isAndroidRuntime()) {
    await deleteAndroidStoragePath(`chapter-media/${chapterId}`);
    return;
  }
  await invoke("chapter_media_clear", { chapterId });
}

export async function clearAllChapterMedia(): Promise<void> {
  if (!isTauriRuntime()) return;
  if (isAndroidRuntime()) {
    await clearAndroidStorageRoot();
    return;
  }
  await invoke("chapter_media_clear_all");
}
