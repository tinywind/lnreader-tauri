import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { pluginFetch } from "./http";
import { isTauriRuntime } from "./tauri-runtime";

const LOCAL_MEDIA_SRC_PREFIX = "norea-media://chapter/";
const MEDIA_SRC_ATTRIBUTES = [
  "src",
  "data-src",
  "data-original",
  "data-lazy-src",
  "data-orig-src",
] as const;
const MEDIA_SOURCE_SELECTOR = [
  ...MEDIA_SRC_ATTRIBUTES.map((attribute) => `img[${attribute}]`),
  "img[srcset]",
  "source[srcset]",
].join(",");
const DEFAULT_MEDIA_EXTENSION = "bin";
type MediaSrcAttribute = (typeof MEDIA_SRC_ATTRIBUTES)[number];

interface CacheChapterMediaOptions {
  baseUrl: string;
  chapterId: number;
  contextUrl?: string;
  html: string;
  onProgress?: (progress: { current: number; total: number }) => void;
  signal?: AbortSignal;
}

interface CacheChapterMediaResult {
  cacheKey: string | null;
  html: string;
}

interface ChapterMediaStoreInput {
  body: number[];
  cacheKey: string;
  chapterId: number;
  fileName: string;
}

interface MediaSrcTarget {
  attribute: MediaSrcAttribute;
  element: Element;
  url: string;
}

interface SrcsetCandidate {
  descriptor: string;
  source: string;
}

interface MediaSrcsetTarget {
  candidates: SrcsetCandidate[];
  element: Element;
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
  fileName,
}: ChapterMediaStoreInput): Promise<string> {
  return invoke<string>("chapter_media_store", {
    body,
    cacheKey,
    chapterId,
    fileName,
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

function collectMediaTargets(
  root: DocumentFragment,
  baseUrl: string,
): {
  srcTargets: MediaSrcTarget[];
  srcsetTargets: MediaSrcsetTarget[];
  urls: string[];
} {
  const srcTargets: MediaSrcTarget[] = [];
  const srcsetTargets: MediaSrcsetTarget[] = [];
  const urls: string[] = [];

  for (const element of root.querySelectorAll<Element>(MEDIA_SOURCE_SELECTOR)) {
    for (const attribute of MEDIA_SRC_ATTRIBUTES) {
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

  return { srcTargets, srcsetTargets, urls };
}

export async function cacheHtmlChapterMedia({
  baseUrl,
  chapterId,
  contextUrl,
  html,
  onProgress,
  signal,
}: CacheChapterMediaOptions): Promise<CacheChapterMediaResult> {
  if (!isTauriRuntime() || typeof document === "undefined") {
    return { cacheKey: null, html };
  }

  const template = document.createElement("template");
  template.innerHTML = html;
  const { srcTargets, srcsetTargets, urls } = collectMediaTargets(
    template.content,
    baseUrl,
  );

  if (urls.length === 0) {
    return { cacheKey: null, html: template.innerHTML };
  }

  const cacheKey = makeCacheKey();
  const localSources = new Map<string, string>();
  for (let index = 0; index < urls.length; index += 1) {
    throwIfAborted(signal);
    const url = urls[index]!;
    const response = await pluginFetch(url, {
      contextUrl: contextUrl ?? baseUrl,
      signal,
    });
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText} on ${url}`,
      );
    }
    const body = bytesFromArrayBuffer(await response.arrayBuffer());
    const src = await storeChapterMedia({
      body,
      cacheKey,
      chapterId,
      fileName: mediaFileName(
        index,
        url,
        response.headers.get("content-type"),
      ),
    });
    localSources.set(url, src);
    onProgress?.({ current: index + 1, total: urls.length });
  }

  for (const target of srcTargets) {
    const src = localSources.get(target.url);
    if (!src) continue;
    target.element.setAttribute("src", src);
    if (target.attribute !== "src") {
      target.element.removeAttribute(target.attribute);
    }
  }

  for (const target of srcsetTargets) {
    const candidates = target.candidates.map((candidate) => {
      const url = absoluteMediaUrl(candidate.source, baseUrl);
      return {
        ...candidate,
        source: url ? (localSources.get(url) ?? candidate.source) : candidate.source,
      };
    });
    target.element.setAttribute("srcset", formatSrcset(candidates));
  }

  return {
    cacheKey,
    html: template.innerHTML,
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

  const resolveMediaSrc = async (src: string): Promise<string | null> => {
    if (!src.startsWith(LOCAL_MEDIA_SRC_PREFIX)) return src;
    try {
      const localPath = await invoke<string>("chapter_media_path", {
        mediaSrc: src,
      });
      return convertFileSrc(localPath);
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
        if (src) {
          element.setAttribute("src", src);
        } else if (attribute === "src") {
          element.removeAttribute("src");
        }
        if (attribute !== "src") {
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

  return template.innerHTML;
}

export async function pruneChapterMedia(
  chapterId: number,
  keepCacheKey: string,
): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("chapter_media_prune", { chapterId, keepCacheKey });
}

export async function clearChapterMedia(chapterId: number): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("chapter_media_clear", { chapterId });
}

export async function clearAllChapterMedia(): Promise<void> {
  if (!isTauriRuntime()) return;
  await invoke("chapter_media_clear_all");
}
