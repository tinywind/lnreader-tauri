import { invoke } from "@tauri-apps/api/core";
import { encodeBackupManifest, type BackupManifest } from "./format";

/**
 * Pack a {@link BackupManifest} into a small zip on disk via the Rust
 * `backup_pack` IPC command.
 *
 * Downloaded chapter bodies and media stay in the configured storage
 * folder. The backup file carries database metadata only, so moving the
 * backup plus that storage folder is enough to restore downloaded content.
 */
export async function packBackup(
  manifest: BackupManifest,
  outputPath: string,
): Promise<void> {
  const leanManifest: BackupManifest = {
    ...manifest,
    chapters: manifest.chapters.map((chapter) => ({
      ...chapter,
      content: null,
      isDownloaded: false,
      mediaBytes: 0,
    })),
  };
  await invoke("backup_pack", {
    manifestJson: encodeBackupManifest(leanManifest),
    outputPath,
  });
}
