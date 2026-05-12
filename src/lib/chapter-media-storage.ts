import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { selectAndroidStorageRoot } from "./android-storage";
import { isAndroidRuntime, isTauriRuntime } from "./tauri-runtime";

export async function getChapterMediaStorageRoot(): Promise<string | null> {
  if (!isTauriRuntime()) return null;
  return invoke<string | null>("chapter_media_get_storage_root");
}

export async function setChapterMediaStorageRoot(
  root: string,
): Promise<string> {
  return invoke<string>("chapter_media_set_storage_root", { root });
}

export async function useDefaultChapterMediaStorageRoot(): Promise<string> {
  if (isAndroidRuntime()) {
    throw new Error("Android requires selecting an external storage folder.");
  }
  return invoke<string>("chapter_media_use_default_storage_root");
}

export async function selectChapterMediaStorageRoot(): Promise<string | null> {
  if (isAndroidRuntime()) {
    return selectAndroidStorageRoot();
  }

  const selected = await open({
    directory: true,
    multiple: false,
    recursive: true,
  });
  if (selected === null || Array.isArray(selected)) return null;
  return setChapterMediaStorageRoot(selected);
}
