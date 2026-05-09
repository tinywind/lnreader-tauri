import { invoke } from "@tauri-apps/api/core";
import { parseBackupManifest, type BackupManifest } from "./format";

interface UnpackedBackupRaw {
  /** Snake-case to match the Rust serde default — see `cf_webview.ts`. */
  manifest_json: string;
  chapters: Array<{ id: number; html: string }>;
  chapter_media?: Array<{ media_src: string; body: number[] }>;
}

export interface BackupChapterMediaFile {
  body: number[];
  mediaSrc: string;
}

const BACKUP_CHAPTER_MEDIA_FILES = Symbol("backupChapterMediaFiles");
const LOCAL_CHAPTER_MEDIA_SRC_PATTERN =
  /^norea-media:\/\/chapter\/([1-9]\d*)\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

type BackupManifestWithChapterMedia = BackupManifest & {
  [BACKUP_CHAPTER_MEDIA_FILES]?: readonly BackupChapterMediaFile[];
};

export function attachBackupChapterMediaFiles(
  manifest: BackupManifest,
  files: readonly BackupChapterMediaFile[],
): BackupManifest {
  Object.defineProperty(manifest, BACKUP_CHAPTER_MEDIA_FILES, {
    configurable: false,
    enumerable: false,
    value: files,
  });
  return manifest;
}

export function hasBackupChapterMediaFiles(
  manifest: BackupManifest,
): boolean {
  return Object.prototype.hasOwnProperty.call(
    manifest,
    BACKUP_CHAPTER_MEDIA_FILES,
  );
}

export function getBackupChapterMediaFiles(
  manifest: BackupManifest,
): readonly BackupChapterMediaFile[] {
  return (
    (manifest as BackupManifestWithChapterMedia)[BACKUP_CHAPTER_MEDIA_FILES] ??
    []
  );
}

function chapterMediaByteCounts(
  files: readonly BackupChapterMediaFile[],
): Map<number, number> {
  const bytesByChapterId = new Map<number, number>();
  for (const file of files) {
    const match = LOCAL_CHAPTER_MEDIA_SRC_PATTERN.exec(file.mediaSrc);
    if (!match) continue;
    const chapterId = Number.parseInt(match[1]!, 10);
    bytesByChapterId.set(
      chapterId,
      (bytesByChapterId.get(chapterId) ?? 0) + file.body.length,
    );
  }
  return bytesByChapterId;
}

/**
 * Read a backup zip from disk via the Rust `backup_unpack` IPC
 * command. Re-injects each `chapters/<id>.html` body into the
 * matching chapter row's `content` field on the parsed manifest.
 *
 * Throws `BackupFormatError` (re-exported from `./format`) if the
 * envelope JSON is malformed.
 */
export async function unpackBackup(inputPath: string): Promise<BackupManifest> {
  const result = await invoke<UnpackedBackupRaw>("backup_unpack", {
    inputPath,
  });
  const manifest = parseBackupManifest(result.manifest_json);
  const htmlById = new Map<number, string>();
  for (const entry of result.chapters) {
    htmlById.set(entry.id, entry.html);
  }
  const chapterMediaFiles = (result.chapter_media ?? []).map((file) => ({
    body: file.body,
    mediaSrc: file.media_src,
  }));
  const mediaBytesByChapterId = chapterMediaByteCounts(chapterMediaFiles);
  const restored = {
    ...manifest,
    chapters: manifest.chapters.map((chapter) => {
      const html = htmlById.get(chapter.id);
      const mediaBytes = mediaBytesByChapterId.get(chapter.id);
      return html !== undefined || mediaBytes !== undefined
        ? {
            ...chapter,
            ...(html !== undefined ? { content: html } : {}),
            ...(mediaBytes !== undefined ? { mediaBytes } : {}),
          }
        : chapter;
    }),
  };
  return attachBackupChapterMediaFiles(restored, chapterMediaFiles);
}
