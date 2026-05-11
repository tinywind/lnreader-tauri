import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { isTauriRuntime } from "./tauri-runtime";

export async function getChapterMediaStorageRoot(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  return invoke<string | null>("chapter_media_get_storage_root");
}

export async function setChapterMediaStorageRoot(
  root: string,
): Promise<string> {
  return invoke<string>("chapter_media_set_storage_root", { root });
}

export async function selectChapterMediaStorageRoot(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    recursive: true,
  });
  if (selected === null || Array.isArray(selected)) return null;
  return setChapterMediaStorageRoot(selected);
}
