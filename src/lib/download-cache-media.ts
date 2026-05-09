import {
  listDownloadCacheMediaBackfillCandidates,
  updateDownloadCacheChapterMediaBytes,
} from "../db/queries/download-cache";
import { getStoredChapterMediaBytes } from "./chapter-media";
import { isTauriRuntime } from "./tauri-runtime";

export async function backfillDownloadCacheMediaBytes(
  novelId?: number,
): Promise<void> {
  if (!isTauriRuntime()) return;

  const candidates = await listDownloadCacheMediaBackfillCandidates(novelId);
  for (const candidate of candidates) {
    const mediaBytes = await getStoredChapterMediaBytes(candidate.content);
    await updateDownloadCacheChapterMediaBytes(candidate.id, mediaBytes);
  }
}
