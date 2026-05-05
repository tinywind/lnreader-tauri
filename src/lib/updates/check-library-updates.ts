import { getDb } from "../../db/client";
import {
  listLibraryUpdatesPage,
  upsertChapter,
  type LibraryUpdateEntry,
} from "../../db/queries/chapter";
import { pluginManager } from "../plugins/manager";
import { LOCAL_PLUGIN_ID } from "../plugins/types";

interface LibraryNovelForUpdate {
  id: number;
  pluginId: string;
  path: string;
  name: string;
}

export interface UpdateCheckFailure {
  novelId: number;
  novelName: string;
  pluginId: string;
  reason: string;
}

export interface UpdateCheckResult {
  checkedNovels: number;
  skippedNovels: number;
  failures: UpdateCheckFailure[];
  hasMoreUpdates: boolean;
  nextUpdateOffset: number;
  updates: LibraryUpdateEntry[];
}

const SELECT_LIBRARY_NOVELS_FOR_UPDATE = `
  SELECT
    id,
    plugin_id AS pluginId,
    path,
    name
  FROM novel
  WHERE in_library = 1
  ORDER BY name COLLATE NOCASE ASC
`;

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function listLibraryNovelsForUpdate(): Promise<
  LibraryNovelForUpdate[]
> {
  const db = await getDb();
  return db.select<LibraryNovelForUpdate[]>(
    SELECT_LIBRARY_NOVELS_FOR_UPDATE,
  );
}

export async function checkLibraryUpdates(
  limit: number,
): Promise<UpdateCheckResult> {
  const novels = await listLibraryNovelsForUpdate();
  const failures: UpdateCheckFailure[] = [];
  let checkedNovels = 0;
  let skippedNovels = 0;

  for (const novel of novels) {
    if (novel.pluginId === LOCAL_PLUGIN_ID) {
      skippedNovels += 1;
      continue;
    }

    const plugin = pluginManager.getPlugin(novel.pluginId);
    if (!plugin) {
      failures.push({
        novelId: novel.id,
        novelName: novel.name,
        pluginId: novel.pluginId,
        reason: `Plugin "${novel.pluginId}" is not installed.`,
      });
      continue;
    }

    try {
      const detail = await plugin.parseNovel(novel.path);
      checkedNovels += 1;

      for (let index = 0; index < detail.chapters.length; index += 1) {
        const chapter = detail.chapters[index]!;
        await upsertChapter({
          novelId: novel.id,
          path: chapter.path,
          name: chapter.name,
          position: index + 1,
          chapterNumber:
            chapter.chapterNumber !== undefined
              ? String(chapter.chapterNumber)
              : null,
          page: chapter.page ?? "1",
          releaseTime: chapter.releaseTime ?? null,
        });
      }
    } catch (error) {
      failures.push({
        novelId: novel.id,
        novelName: novel.name,
        pluginId: novel.pluginId,
        reason: describeError(error),
      });
    }
  }

  const updatesPage = await listLibraryUpdatesPage(limit);

  return {
    checkedNovels,
    skippedNovels,
    failures,
    hasMoreUpdates: updatesPage.hasMore,
    nextUpdateOffset: updatesPage.nextOffset,
    updates: updatesPage.updates,
  };
}
