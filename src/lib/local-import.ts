import { load } from "cheerio";
import {
  chapterContentToHtml,
  type ChapterContentType,
} from "./chapter-content";
import type { ChapterItem, SourceNovel } from "./plugins/types";

export const LOCAL_IMPORT_LIMITS = {
  fileBytes: 25 * 1024 * 1024,
  textBytes: 8 * 1024 * 1024,
  htmlBytes: 8 * 1024 * 1024,
  pdfBytes: 25 * 1024 * 1024,
  epubContainerBytes: 256 * 1024,
  epubOpfBytes: 2 * 1024 * 1024,
  epubChapterBytes: 4 * 1024 * 1024,
  epubImageBytes: 2 * 1024 * 1024,
  epubTotalImageBytes: 8 * 1024 * 1024,
} as const;

export type LocalImportFormat = "txt" | "html" | "epub" | "pdf";

interface SanitizableElement {
  attribs?: Record<string, string>;
  tagName: string;
}

export interface LocalImportDuplicateMetadata {
  strategy: "content-hash";
  key: string;
  pathKey: string;
  contentHash: string;
  fileName: string;
  fileSize: number;
  format: LocalImportFormat;
}

export interface LocalImportAnalysis {
  fileName: string;
  fileSize: number;
  mimeType: string;
  format: LocalImportFormat;
  title: string;
  contentHash: string;
  pathKey: string;
  duplicate: LocalImportDuplicateMetadata;
}

export interface LocalImportConvertedChapter extends ChapterItem {
  content: string;
  contentBytes: number;
}

export interface LocalImportConversion {
  analysis: LocalImportAnalysis;
  novel: SourceNovel;
  chapters: LocalImportConvertedChapter[];
  duplicate: LocalImportDuplicateMetadata;
}

interface ZipEntryInfo {
  name: string;
  compressed_size: number;
  uncompressed_size: number;
  is_file: boolean;
}

interface EpubManifestItem {
  id: string;
  href: string;
  mediaType: string;
}

interface EpubChapterSource {
  name: string;
  path: string;
  html: string;
}

const DATA_IMAGE_SOURCE_PATTERN =
  /^data:image\/(?:avif|gif|jpeg|jpg|png|webp);base64,[a-z\d+/]+=*$/i;

const UNSAFE_TAGS = new Set([
  "applet",
  "base",
  "button",
  "embed",
  "form",
  "frame",
  "frameset",
  "iframe",
  "input",
  "link",
  "meta",
  "object",
  "script",
  "select",
  "style",
  "textarea",
]);

const ALLOWED_TAGS = new Set([
  "a",
  "abbr",
  "article",
  "aside",
  "b",
  "blockquote",
  "body",
  "br",
  "caption",
  "cite",
  "code",
  "col",
  "colgroup",
  "dd",
  "del",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "head",
  "hr",
  "html",
  "i",
  "img",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "q",
  "rp",
  "rt",
  "ruby",
  "s",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "title",
  "tr",
  "u",
  "ul",
]);

const GLOBAL_ALLOWED_ATTRIBUTES = new Set([
  "aria-label",
  "dir",
  "lang",
  "title",
]);

const TAG_ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
  a: new Set(["href"]),
  img: new Set(["alt", "height", "src", "width"]),
  td: new Set(["colspan", "rowspan"]),
  th: new Set(["colspan", "rowspan", "scope"]),
};

const SUPPORTED_IMAGE_MEDIA_TYPES: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

const XHTML_MEDIA_TYPES = new Set([
  "application/xhtml+xml",
  "text/html",
  "application/html+xml",
]);

export class LocalImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LocalImportError";
  }
}

function getExtension(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === fileName.length - 1) return "";
  return fileName.slice(dotIndex + 1).toLowerCase();
}

function titleFromFileName(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  const baseName = dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
  return baseName.trim() || "Untitled";
}

function formatFromFile(file: File): LocalImportFormat {
  const extension = getExtension(file.name);
  const mimeType = file.type.toLowerCase();

  if (extension === "txt") return "txt";
  if (extension === "html" || extension === "htm") return "html";
  if (extension === "epub") return "epub";
  if (extension === "pdf") return "pdf";

  if (mimeType === "text/plain") return "txt";
  if (mimeType === "text/html") return "html";
  if (mimeType === "application/epub+zip") return "epub";
  if (mimeType === "application/pdf") return "pdf";

  throw new LocalImportError(`Unsupported local import format: ${file.name}`);
}

function formatLimit(format: LocalImportFormat): number {
  if (format === "txt") return LOCAL_IMPORT_LIMITS.textBytes;
  if (format === "html") return LOCAL_IMPORT_LIMITS.htmlBytes;
  if (format === "pdf") return LOCAL_IMPORT_LIMITS.pdfBytes;
  return LOCAL_IMPORT_LIMITS.fileBytes;
}

function assertFileWithinLimit(file: File, format: LocalImportFormat): void {
  const limit = Math.min(LOCAL_IMPORT_LIMITS.fileBytes, formatLimit(format));
  if (file.size > limit) {
    throw new LocalImportError(
      `${file.name} is larger than the ${format} import limit.`,
    );
  }
}

function bytesToArray(bytes: Uint8Array): number[] {
  return Array.from(bytes);
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof btoa !== "function") {
    throw new LocalImportError("Base64 encoding is not available.");
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function utf8Decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function hexFromBytes(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new LocalImportError("SHA-256 hashing is not available.");
  }
  return hexFromBytes(await subtle.digest("SHA-256", bytes));
}

function pathKeyForHash(format: LocalImportFormat, contentHash: string): string {
  return `local:${format}:${contentHash}`;
}

function duplicateMetadata(
  analysis: Omit<LocalImportAnalysis, "duplicate">,
): LocalImportDuplicateMetadata {
  return {
    strategy: "content-hash",
    key: analysis.contentHash,
    pathKey: analysis.pathKey,
    contentHash: analysis.contentHash,
    fileName: analysis.fileName,
    fileSize: analysis.fileSize,
    format: analysis.format,
  };
}

async function readFileBytes(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}

async function analyzeLocalImportBytes(
  file: File,
  bytes: Uint8Array,
): Promise<LocalImportAnalysis> {
  const format = formatFromFile(file);
  assertFileWithinLimit(file, format);

  const contentHash = await sha256Hex(bytes);
  const analysisWithoutDuplicate = {
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
    format,
    title: titleFromFileName(file.name),
    contentHash,
    pathKey: pathKeyForHash(format, contentHash),
  };
  return {
    ...analysisWithoutDuplicate,
    duplicate: duplicateMetadata(analysisWithoutDuplicate),
  };
}

export async function analyzeLocalImportFile(
  file: File,
): Promise<LocalImportAnalysis> {
  const format = formatFromFile(file);
  assertFileWithinLimit(file, format);
  return analyzeLocalImportBytes(file, await readFileBytes(file));
}

function isAllowedUrl(value: string, allowDataImages: boolean): boolean {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.startsWith("#")) return true;
  if (allowDataImages && DATA_IMAGE_SOURCE_PATTERN.test(trimmed)) return true;

  try {
    const url = new URL(trimmed);
    return (
      url.protocol === "http:" ||
      url.protocol === "https:" ||
      url.protocol === "mailto:"
    );
  } catch {
    return false;
  }
}

function isAllowedAttribute(
  tagName: string,
  attributeName: string,
  value: string,
): boolean {
  const normalizedName = attributeName.toLowerCase();
  if (normalizedName.startsWith("on")) return false;
  if (normalizedName === "style" || normalizedName === "srcdoc") return false;
  if (
    !GLOBAL_ALLOWED_ATTRIBUTES.has(normalizedName) &&
    !TAG_ALLOWED_ATTRIBUTES[tagName]?.has(normalizedName)
  ) {
    return false;
  }

  if (tagName === "a" && normalizedName === "href") {
    return isAllowedUrl(value, false);
  }
  if (tagName === "img" && normalizedName === "src") {
    return isAllowedUrl(value, true);
  }
  if (
    (tagName === "img" &&
      (normalizedName === "width" || normalizedName === "height")) ||
    ((tagName === "td" || tagName === "th") &&
      (normalizedName === "colspan" || normalizedName === "rowspan"))
  ) {
    return /^\d{1,4}$/.test(value.trim());
  }

  return true;
}

export function sanitizeLocalImportHtml(html: string): string {
  const $ = load(html, {}, false);

  $([...UNSAFE_TAGS].join(",")).remove();

  $("*").each((_, element) => {
    const node = element as SanitizableElement;
    const tagName = node.tagName.toLowerCase();
    if (!ALLOWED_TAGS.has(tagName)) {
      $(element).replaceWith($(element).contents());
      return;
    }

    for (const attribute of Object.keys(node.attribs ?? {})) {
      const value = $(element).attr(attribute) ?? "";
      if (!isAllowedAttribute(tagName, attribute, value)) {
        $(element).removeAttr(attribute);
      }
    }
  });

  return $.root().html() ?? "";
}

function chapterPath(pathKey: string, index: number): string {
  return `${pathKey}/chapter-${String(index + 1).padStart(4, "0")}`;
}

function singleChapterConversion(
  analysis: LocalImportAnalysis,
  content: string,
  contentType: ChapterContentType,
): LocalImportConversion {
  const chapter: LocalImportConvertedChapter = {
    name: analysis.title,
    path: chapterPath(analysis.pathKey, 0),
    contentType,
    content,
    contentBytes: utf8ByteLength(content),
  };

  return {
    analysis,
    novel: {
      name: analysis.title,
      path: analysis.pathKey,
      chapters: [
        {
          name: chapter.name,
          path: chapter.path,
          contentType,
        },
      ],
    },
    chapters: [chapter],
    duplicate: analysis.duplicate,
  };
}

async function invokeZipList(bytes: Uint8Array): Promise<ZipEntryInfo[]> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<ZipEntryInfo[]>("plugin_zip_list", {
    bytes: bytesToArray(bytes),
  });
}

async function invokeZipReadFile(
  bytes: Uint8Array,
  path: string,
  maxBytes: number,
): Promise<Uint8Array> {
  const { invoke } = await import("@tauri-apps/api/core");
  const output = await invoke<number[]>("plugin_zip_read_file", {
    bytes: bytesToArray(bytes),
    options: {
      path,
      max_bytes: maxBytes,
    },
  });
  return new Uint8Array(output);
}

function normalizeZipPath(path: string): string {
  const parts: string[] = [];
  for (const rawPart of path.replace(/\\/g, "/").split("/")) {
    const part = safeDecodePathPart(rawPart).trim();
    if (!part || part === ".") continue;
    if (part === "..") {
      parts.pop();
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function joinZipPath(basePath: string, href: string): string {
  if (/^[a-z][a-z\d+\-.]*:/i.test(href)) return "";
  const baseParts =
    basePath && !href.startsWith("/") ? basePath.split("/") : [];
  const hrefParts = href.split("#")[0]?.split("?")[0] ?? "";
  return normalizeZipPath([...baseParts, hrefParts].join("/"));
}

function safeDecodePathPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function directoryName(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

function parseContainerRootfile(containerXml: string): string {
  const $ = load(containerXml, { xmlMode: true });
  const rootfilePath = $("rootfile").first().attr("full-path")?.trim();
  if (!rootfilePath) {
    throw new LocalImportError(
      "EPUB container.xml does not reference an OPF file.",
    );
  }
  return normalizeZipPath(rootfilePath);
}

function manifestItemsFromOpf(opfXml: string): Map<string, EpubManifestItem> {
  const $ = load(opfXml, { xmlMode: true });
  const manifest = new Map<string, EpubManifestItem>();

  $("manifest item").each((_, element) => {
    const id = $(element).attr("id")?.trim();
    const href = $(element).attr("href")?.trim();
    const mediaType =
      $(element).attr("media-type")?.trim().toLowerCase() ?? "";
    if (!id || !href) return;
    manifest.set(id, { id, href, mediaType });
  });

  return manifest;
}

function spineIdrefsFromOpf(opfXml: string): string[] {
  const $ = load(opfXml, { xmlMode: true });
  const idrefs: string[] = [];

  $("spine itemref").each((_, element) => {
    const idref = $(element).attr("idref")?.trim();
    const linear = $(element).attr("linear")?.trim().toLowerCase();
    if (idref && linear !== "no") idrefs.push(idref);
  });

  return idrefs;
}

function epubTitleFromOpf(opfXml: string, fallback: string): string {
  const $ = load(opfXml, { xmlMode: true });
  return $("metadata title, dc\\:title")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim() || fallback;
}

function epubAuthorFromOpf(opfXml: string): string | undefined {
  const $ = load(opfXml, { xmlMode: true });
  const author = $("metadata creator, dc\\:creator")
    .first()
    .text()
    .replace(/\s+/g, " ")
    .trim();
  return author || undefined;
}

function isXhtmlManifestItem(item: EpubManifestItem): boolean {
  if (XHTML_MEDIA_TYPES.has(item.mediaType)) return true;
  const extension = `.${getExtension(item.href)}`;
  return (
    extension === ".xhtml" ||
    extension === ".html" ||
    extension === ".htm"
  );
}

function imageMediaType(path: string): string | null {
  const extension = `.${getExtension(path)}`;
  return SUPPORTED_IMAGE_MEDIA_TYPES[extension] ?? null;
}

function entryMapByName(entries: ZipEntryInfo[]): Map<string, ZipEntryInfo> {
  const map = new Map<string, ZipEntryInfo>();
  for (const entry of entries) {
    if (entry.is_file) map.set(normalizeZipPath(entry.name), entry);
  }
  return map;
}

async function inlineEpubImages(
  zipBytes: Uint8Array,
  entries: Map<string, ZipEntryInfo>,
  chapterPathValue: string,
  xhtml: string,
  imageBudget: { usedBytes: number },
): Promise<string> {
  const $ = load(xhtml, { xmlMode: true });
  const chapterDir = directoryName(chapterPathValue);

  for (const element of $("img, image").toArray()) {
    const srcAttribute = $(element).attr("src") != null ? "src" : "href";
    const source = $(element).attr(srcAttribute)?.trim();
    if (!source || /^[a-z][a-z\d+\-.]*:/i.test(source)) continue;

    const imagePath = joinZipPath(chapterDir, source);
    const mediaType = imageMediaType(imagePath);
    const entry = entries.get(imagePath);
    if (!mediaType || !entry) continue;
    if (
      entry.uncompressed_size > LOCAL_IMPORT_LIMITS.epubImageBytes ||
      imageBudget.usedBytes + entry.uncompressed_size >
        LOCAL_IMPORT_LIMITS.epubTotalImageBytes
    ) {
      continue;
    }

    const imageBytes = await invokeZipReadFile(
      zipBytes,
      imagePath,
      LOCAL_IMPORT_LIMITS.epubImageBytes,
    );
    imageBudget.usedBytes += imageBytes.byteLength;
    $(element).attr(
      "src",
      `data:${mediaType};base64,${bytesToBase64(imageBytes)}`,
    );
    if (srcAttribute !== "src") $(element).removeAttr(srcAttribute);
  }

  return $.root().html() ?? "";
}

function chapterNameFromHtml(html: string, fallback: string): string {
  const $ = load(html);
  const title =
    $("title, h1, h2, h3")
      .first()
      .text()
      .replace(/\s+/g, " ")
      .trim() || fallback;
  return title;
}

function bodyOrRootHtml(html: string): string {
  const $ = load(html);
  const bodyHtml = $("body").first().html();
  return bodyHtml ?? ($.root().html() || html);
}

async function convertEpub(
  analysis: LocalImportAnalysis,
  bytes: Uint8Array,
): Promise<LocalImportConversion> {
  const entries = entryMapByName(await invokeZipList(bytes));
  if (!entries.has("META-INF/container.xml")) {
    throw new LocalImportError(
      "EPUB archive is missing META-INF/container.xml.",
    );
  }

  const containerXml = utf8Decode(
    await invokeZipReadFile(
      bytes,
      "META-INF/container.xml",
      LOCAL_IMPORT_LIMITS.epubContainerBytes,
    ),
  );
  const opfPath = parseContainerRootfile(containerXml);
  const opfXml = utf8Decode(
    await invokeZipReadFile(bytes, opfPath, LOCAL_IMPORT_LIMITS.epubOpfBytes),
  );
  const opfDir = directoryName(opfPath);
  const manifest = manifestItemsFromOpf(opfXml);
  const spineItems = spineIdrefsFromOpf(opfXml)
    .map((idref) => manifest.get(idref))
    .filter(
      (item): item is EpubManifestItem => !!item && isXhtmlManifestItem(item),
    );

  if (!spineItems.length) {
    throw new LocalImportError(
      "EPUB OPF does not contain readable spine items.",
    );
  }

  const imageBudget = { usedBytes: 0 };
  const chapterSources: EpubChapterSource[] = [];

  for (const [index, item] of spineItems.entries()) {
    const itemPath = joinZipPath(opfDir, item.href);
    const xhtml = utf8Decode(
      await invokeZipReadFile(
        bytes,
        itemPath,
        LOCAL_IMPORT_LIMITS.epubChapterBytes,
      ),
    );
    const withImages = await inlineEpubImages(
      bytes,
      entries,
      itemPath,
      xhtml,
      imageBudget,
    );
    const html = sanitizeLocalImportHtml(bodyOrRootHtml(withImages));
    chapterSources.push({
      name: chapterNameFromHtml(xhtml, `Chapter ${index + 1}`),
      path: chapterPath(analysis.pathKey, index),
      html,
    });
  }

  const chapters: LocalImportConvertedChapter[] = chapterSources.map(
    (chapter) => ({
      name: chapter.name,
      path: chapter.path,
      contentType: "html",
      content: chapter.html,
      contentBytes: utf8ByteLength(chapter.html),
    }),
  );

  return {
    analysis: {
      ...analysis,
      title: epubTitleFromOpf(opfXml, analysis.title),
    },
    novel: {
      name: epubTitleFromOpf(opfXml, analysis.title),
      path: analysis.pathKey,
      author: epubAuthorFromOpf(opfXml),
      chapters: chapters.map((chapter) => ({
        name: chapter.name,
        path: chapter.path,
        contentType: chapter.contentType,
      })),
    },
    chapters,
    duplicate: analysis.duplicate,
  };
}

export async function convertLocalImportFile(
  file: File,
): Promise<LocalImportConversion> {
  const format = formatFromFile(file);
  assertFileWithinLimit(file, format);
  const bytes = await readFileBytes(file);
  const analysis = await analyzeLocalImportBytes(file, bytes);

  if (analysis.format === "txt") {
    return singleChapterConversion(
      analysis,
      chapterContentToHtml(utf8Decode(bytes), "text"),
      "text",
    );
  }

  if (analysis.format === "html") {
    return singleChapterConversion(
      analysis,
      sanitizeLocalImportHtml(bodyOrRootHtml(utf8Decode(bytes))),
      "html",
    );
  }

  if (analysis.format === "pdf") {
    return singleChapterConversion(
      analysis,
      `data:application/pdf;base64,${bytesToBase64(bytes)}`,
      "pdf",
    );
  }

  return convertEpub(analysis, bytes);
}
