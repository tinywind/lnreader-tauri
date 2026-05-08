export const CHAPTER_CONTENT_TYPES = ["html", "text", "pdf"] as const;

export type ChapterContentType = (typeof CHAPTER_CONTENT_TYPES)[number];

export const DEFAULT_CHAPTER_CONTENT_TYPE: ChapterContentType = "html";

export function normalizeChapterContentType(
  value: unknown,
): ChapterContentType {
  return CHAPTER_CONTENT_TYPES.includes(value as ChapterContentType)
    ? (value as ChapterContentType)
    : DEFAULT_CHAPTER_CONTENT_TYPE;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function chapterContentToHtml(
  content: string,
  contentType: ChapterContentType,
): string {
  if (contentType === "text") {
    return `<pre>${escapeHtml(content)}</pre>`;
  }

  return content;
}
