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
  const restored = {
    ...manifest,
    chapters: manifest.chapters.map((chapter) => {
      const html = htmlById.get(chapter.id);
      return html !== undefined ? { ...chapter, content: html } : chapter;
    }),
  };
  return attachBackupChapterMediaFiles(
    restored,
    (result.chapter_media ?? []).map((file) => ({
      body: file.body,
      mediaSrc: file.media_src,
    })),
  );
}
