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

interface ChapterMediaReference {
  mediaSrc: string;
}

const LOCAL_CHAPTER_MEDIA_SRC_PATTERN =
  /norea-media:\/\/chapter\/\d+\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+/g;

function localChapterMediaSources(html: string): string[] {
  return html.match(LOCAL_CHAPTER_MEDIA_SRC_PATTERN) ?? [];
}

/**
 * Pack a {@link BackupManifest} plus its chapter reader bodies into a
 * zip on disk via the Rust `backup_pack` IPC command.
 *
 * The on-disk layout splits `chapter.content` out of `manifest.json`.
 * Each non-null body becomes a `chapters/<id>.html` entry, so the
 * JSON envelope stays small and the archive is human-inspectable.
 * {@link unpackBackup} reverses the split.
 */
export async function packBackup(
  manifest: BackupManifest,
  outputPath: string,
): Promise<void> {
  const chapterContents: ChapterContent[] = [];
  const mediaSources = new Set<string>();
  const leanChapters: BackupChapter[] = manifest.chapters.map((chapter) => {
    if (chapter.content === null) {
      return chapter;
    }
    for (const mediaSrc of localChapterMediaSources(chapter.content)) {
      mediaSources.add(mediaSrc);
    }
    chapterContents.push({ id: chapter.id, html: chapter.content });
    return { ...chapter, content: null };
  });
  const leanManifest: BackupManifest = {
    ...manifest,
    chapters: leanChapters,
  };
  const chapterMedia: ChapterMediaReference[] = [...mediaSources].map(
    (mediaSrc) => ({ mediaSrc }),
  );
  await invoke("backup_pack", {
    manifestJson: encodeBackupManifest(leanManifest),
    chapters: chapterContents,
    chapterMedia,
    outputPath,
  });
}
