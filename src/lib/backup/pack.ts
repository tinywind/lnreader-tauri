import { invoke } from "@tauri-apps/api/core";
import {
  encodeBackupManifest,
  type BackupChapter,
  type BackupManifest,
} from "./format";

interface ChapterContent {
  id: number;
  html: string;
}

/**
 * Pack a {@link BackupManifest} plus its chapter HTML bodies into a
 * zip on disk via the Rust `backup_pack` IPC command.
 *
 * The on-disk layout splits `chapter.content` out of `manifest.json`
 * — each non-null body becomes a `chapters/<id>.html` entry — so the
 * JSON envelope stays small and the archive is human-inspectable.
 * {@link unpackBackup} reverses the split.
 */
export async function packBackup(
  manifest: BackupManifest,
  outputPath: string,
): Promise<void> {
  const chapterContents: ChapterContent[] = [];
  const leanChapters: BackupChapter[] = manifest.chapters.map((chapter) => {
    if (chapter.content === null) {
      return chapter;
    }
    chapterContents.push({ id: chapter.id, html: chapter.content });
    return { ...chapter, content: null };
  });
  const leanManifest: BackupManifest = {
    ...manifest,
    chapters: leanChapters,
  };
  await invoke("backup_pack", {
    manifestJson: encodeBackupManifest(leanManifest),
    chapters: chapterContents,
    outputPath,
  });
}
