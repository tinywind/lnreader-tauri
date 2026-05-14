import { invoke } from "@tauri-apps/api/core";
import {
  localChapterMediaSources,
  resolveLocalChapterMediaSrc,
} from "../chapter-media";
import { encodeBackupManifest, type BackupManifest } from "./format";

interface BackupChapterMediaPayload {
  body: number[];
  media_src: string;
}

function backupChapterMediaSources(manifest: BackupManifest): string[] {
  const mediaSources = new Set<string>();
  for (const chapter of manifest.chapters) {
    if (!chapter.content) continue;
    for (const mediaSrc of localChapterMediaSources(chapter.content)) {
      mediaSources.add(mediaSrc);
    }
  }
  return [...mediaSources];
}

function bytesFromDataUrl(dataUrl: string): number[] {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0 || !dataUrl.slice(0, commaIndex).includes(";base64")) {
    throw new Error("Backup media must resolve to a base64 data URL.");
  }
  const binary = atob(dataUrl.slice(commaIndex + 1));
  const bytes = new Array<number>(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

async function backupChapterMediaPayloads(
  manifest: BackupManifest,
): Promise<BackupChapterMediaPayload[]> {
  const mediaSources = backupChapterMediaSources(manifest);
  const files: BackupChapterMediaPayload[] = [];
  for (const mediaSrc of mediaSources) {
    const dataUrl = await resolveLocalChapterMediaSrc(mediaSrc);
    if (!dataUrl?.startsWith("data:")) {
      throw new Error(`Backup media is missing: ${mediaSrc}`);
    }
    files.push({
      body: bytesFromDataUrl(dataUrl),
      media_src: mediaSrc,
    });
  }
  return files;
}

/**
 * Pack a {@link BackupManifest} into a zip on disk via the Rust
 * `backup_pack` IPC command.
 */
export async function packBackup(
  manifest: BackupManifest,
  outputPath: string,
): Promise<void> {
  const chapterMedia = await backupChapterMediaPayloads(manifest);
  await invoke("backup_pack", {
    chapterMedia,
    manifestJson: encodeBackupManifest(manifest),
    outputPath,
  });
}

export async function packBackupTempFile(
  manifest: BackupManifest,
): Promise<string> {
  const chapterMedia = await backupChapterMediaPayloads(manifest);
  return invoke<string>("backup_pack_temp_file", {
    chapterMedia,
    manifestJson: encodeBackupManifest(manifest),
  });
}

export async function deleteBackupTempFile(path: string): Promise<void> {
  await invoke("backup_delete_temp_file", { path });
}

export async function packBackupBytes(
  manifest: BackupManifest,
): Promise<number[]> {
  const chapterMedia = await backupChapterMediaPayloads(manifest);
  return invoke<number[]>("backup_pack_bytes", {
    chapterMedia,
    manifestJson: encodeBackupManifest(manifest),
  });
}
