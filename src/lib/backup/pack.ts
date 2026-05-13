import { invoke } from "@tauri-apps/api/core";
import { encodeBackupManifest, type BackupManifest } from "./format";

function leanBackupManifest(manifest: BackupManifest): BackupManifest {
  return {
    ...manifest,
    chapters: manifest.chapters.map((chapter) => ({
      ...chapter,
      content: null,
      isDownloaded: false,
      mediaBytes: 0,
    })),
  };
}

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
  await invoke("backup_pack", {
    manifestJson: encodeBackupManifest(leanBackupManifest(manifest)),
    outputPath,
  });
}

export async function packBackupTempFile(
  manifest: BackupManifest,
): Promise<string> {
  return invoke<string>("backup_pack_temp_file", {
    manifestJson: encodeBackupManifest(leanBackupManifest(manifest)),
  });
}

export async function deleteBackupTempFile(path: string): Promise<void> {
  await invoke("backup_delete_temp_file", { path });
}

export async function packBackupBytes(
  manifest: BackupManifest,
): Promise<number[]> {
  return invoke<number[]>("backup_pack_bytes", {
    manifestJson: encodeBackupManifest(leanBackupManifest(manifest)),
  });
}
