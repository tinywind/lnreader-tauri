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
    const mediaBytes = await getStoredChapterMediaBytes(candidate.content, {
      chapterId: candidate.id,
      chapterName: candidate.chapterName,
      chapterNumber: candidate.chapterNumber,
      chapterPosition: candidate.position,
      novelId: candidate.novelId,
      novelName: candidate.novelName,
      novelPath: candidate.novelPath,
      sourceId: candidate.pluginId,
    });
    await updateDownloadCacheChapterMediaBytes(candidate.id, mediaBytes);
  }
}
