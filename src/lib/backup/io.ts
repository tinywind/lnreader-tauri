import { open, save } from "@tauri-apps/plugin-dialog";
import { packBackup } from "./pack";
import { applyBackupSnapshot, gatherBackupSnapshot } from "./snapshot";
import { unpackBackup } from "./unpack";

const ZIP_FILTER_NAME = "LNReaderTauri Backup";

function zipFilter(): { name: string; extensions: string[] } {
  return { name: ZIP_FILTER_NAME, extensions: ["zip"] };
}

/** ISO date prefix used for the default backup filename, e.g. `2026-05-05`. */
function isoDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** `lnreader-backup-YYYY-MM-DD.zip` — what the save dialog pre-fills. */
export function defaultBackupFilename(now: Date = new Date()): string {
  return `lnreader-backup-${isoDate(now)}.zip`;
}

/**
 * Run the full export flow: file picker → DB snapshot → zip pack.
 *
 * Resolves with the chosen path, or `null` if the user dismissed the
 * dialog. Errors thrown by `gatherBackupSnapshot` / `packBackup`
 * propagate to the caller for UI presentation.
 */
export async function exportBackupToFile(): Promise<string | null> {
  const path = await save({
    defaultPath: defaultBackupFilename(),
    filters: [zipFilter()],
  });
  if (!path) return null;
  const manifest = await gatherBackupSnapshot();
  await packBackup(manifest, path);
  return path;
}

/**
 * Run the full import flow: file picker → zip unpack → DB apply.
 *
 * Destructive — replaces every row in the 5 backup tables. The
 * caller is expected to confirm intent before invoking this.
 *
 * Resolves with the chosen path, or `null` if the user dismissed
 * the dialog.
 */
export async function importBackupFromFile(): Promise<string | null> {
  const selected = await open({
    multiple: false,
    filters: [zipFilter()],
  });
  if (selected === null || Array.isArray(selected)) {
    // `multiple: false` should never resolve with an array, but the
    // dialog plugin's union type forces us to narrow.
    return null;
  }
  const manifest = await unpackBackup(selected);
  await applyBackupSnapshot(manifest);
  return selected;
}
