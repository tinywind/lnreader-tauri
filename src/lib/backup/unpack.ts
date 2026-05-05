import { invoke } from "@tauri-apps/api/core";
import { parseBackupManifest, type BackupManifest } from "./format";

interface UnpackedBackupRaw {
  /** Snake-case to match the Rust serde default — see `cf_webview.ts`. */
  manifest_json: string;
  chapters: Array<{ id: number; html: string }>;
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
  return {
    ...manifest,
    chapters: manifest.chapters.map((chapter) => {
      const html = htmlById.get(chapter.id);
      return html !== undefined ? { ...chapter, content: html } : chapter;
    }),
  };
}
