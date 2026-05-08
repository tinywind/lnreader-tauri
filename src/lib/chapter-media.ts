import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { pluginFetch } from "./http";
import { isTauriRuntime } from "./tauri-runtime";

const LOCAL_MEDIA_SRC_PREFIX = "norea-media://chapter/";
const IMAGE_SOURCE_SELECTOR = "img[src]";
const DEFAULT_MEDIA_EXTENSION = "bin";

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
  const targets = [...template.content.querySelectorAll<HTMLImageElement>(
    IMAGE_SOURCE_SELECTOR,
  )]
    .map((element) => ({
      element,
      url: absoluteMediaUrl(element.getAttribute("src") ?? "", baseUrl),
    }))
    .filter(
      (target): target is { element: HTMLImageElement; url: string } =>
        target.url !== null,
    );

  if (targets.length === 0) {
    return { cacheKey: null, html: template.innerHTML };
  }

  const cacheKey = makeCacheKey();
  for (let index = 0; index < targets.length; index += 1) {
    throwIfAborted(signal);
    const target = targets[index]!;
    const response = await pluginFetch(target.url, {
      contextUrl: contextUrl ?? baseUrl,
      signal,
    });
    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} ${response.statusText} on ${target.url}`,
      );
    }
    const body = bytesFromArrayBuffer(await response.arrayBuffer());
    const src = await storeChapterMedia({
      body,
      cacheKey,
      chapterId,
      fileName: mediaFileName(
        index,
        target.url,
        response.headers.get("content-type"),
      ),
    });
    target.element.setAttribute("src", src);
    onProgress?.({ current: index + 1, total: targets.length });
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
    ...template.content.querySelectorAll<HTMLImageElement>(
      IMAGE_SOURCE_SELECTOR,
    ),
  ].filter((element) =>
    (element.getAttribute("src") ?? "").startsWith(LOCAL_MEDIA_SRC_PREFIX),
  );

  await Promise.all(
    mediaElements.map(async (element) => {
      const src = element.getAttribute("src");
      if (!src) return;
      try {
        const localPath = await invoke<string>("chapter_media_path", {
          mediaSrc: src,
        });
        element.setAttribute("src", convertFileSrc(localPath));
      } catch {
        element.removeAttribute("src");
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
