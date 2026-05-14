import {
  DEFAULT_CHAPTER_CONTENT_TYPE,
  normalizeChapterContentType,
  type ChapterContentType,
} from "./chapter-content";

const MEDIA_ELEMENT_PATTERN =
  /<(?:img|picture|source|video|audio|track|iframe|embed|object)\b[^>]*>/gi;
const REMOTE_URL_TOKEN_PATTERN = /(?:^|[\s"'(,=])(?:https?:)?\/\//i;
const REMOTE_STYLE_MEDIA_PATTERN =
  /\burl\(\s*["']?(?:https?:)?\/\//i;

function hasRemoteMediaElement(content: string): boolean {
  MEDIA_ELEMENT_PATTERN.lastIndex = 0;
  for (const match of content.matchAll(MEDIA_ELEMENT_PATTERN)) {
    if (REMOTE_URL_TOKEN_PATTERN.test(match[0])) return true;
  }
  return false;
}

export function chapterMediaRepairNeeded(
  content: string | null | undefined,
  contentType: ChapterContentType | string | null | undefined = DEFAULT_CHAPTER_CONTENT_TYPE,
): boolean {
  if (normalizeChapterContentType(contentType) !== "html") return false;
  if (!content) return false;
  return (
    hasRemoteMediaElement(content) ||
    REMOTE_STYLE_MEDIA_PATTERN.test(content)
  );
}

export function chapterMediaRepairFlag(
  content: string | null | undefined,
  contentType?: ChapterContentType | string | null,
): 0 | 1 {
  return chapterMediaRepairNeeded(content, contentType) ? 1 : 0;
}
