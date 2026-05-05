import { create } from "zustand";
import type {
  LibraryUpdateEntry,
  LibraryUpdatesPage,
} from "../db/queries/chapter";
import type { UpdateCheckResult } from "../lib/updates/check-library-updates";

interface UpdatesState {
  hasLoaded: boolean;
  hasMoreUpdates: boolean;
  lastCheckResult: UpdateCheckResult | null;
  nextUpdateOffset: number;
  updates: LibraryUpdateEntry[];
  appendPage: (page: LibraryUpdatesPage) => void;
  applyCheckResult: (result: UpdateCheckResult) => void;
  markChapterDownloaded: (chapterId: number) => void;
  mergeFirstPage: (page: LibraryUpdatesPage) => void;
}

function mergeRows(
  priorityRows: readonly LibraryUpdateEntry[],
  existingRows: readonly LibraryUpdateEntry[],
): LibraryUpdateEntry[] {
  const seen = new Set<number>();
  const merged: LibraryUpdateEntry[] = [];

  for (const row of [...priorityRows, ...existingRows]) {
    if (seen.has(row.chapterId)) continue;
    seen.add(row.chapterId);
    merged.push(row);
  }

  return merged;
}

function appendRows(
  existingRows: readonly LibraryUpdateEntry[],
  nextRows: readonly LibraryUpdateEntry[],
): LibraryUpdateEntry[] {
  const seen = new Set(existingRows.map((row) => row.chapterId));
  const appended = nextRows.filter((row) => !seen.has(row.chapterId));
  return [...existingRows, ...appended];
}

function markRowsDownloaded(
  rows: readonly LibraryUpdateEntry[],
  chapterId: number,
): LibraryUpdateEntry[] {
  return rows.map((row) =>
    row.chapterId === chapterId ? { ...row, isDownloaded: true } : row,
  );
}

export const useUpdatesStore = create<UpdatesState>((set) => ({
  hasLoaded: false,
  hasMoreUpdates: false,
  lastCheckResult: null,
  nextUpdateOffset: 0,
  updates: [],
  appendPage: (page) =>
    set((state) => ({
      hasLoaded: true,
      hasMoreUpdates: page.hasMore,
      nextUpdateOffset: page.nextOffset,
      updates: appendRows(state.updates, page.updates),
    })),
  applyCheckResult: (result) =>
    set((state) => ({
      hasLoaded: true,
      hasMoreUpdates: result.hasMoreUpdates || state.hasMoreUpdates,
      lastCheckResult: result,
      nextUpdateOffset: Math.max(
        state.nextUpdateOffset,
        result.nextUpdateOffset,
      ),
      updates: mergeRows(result.updates, state.updates),
    })),
  markChapterDownloaded: (chapterId) =>
    set((state) => ({
      lastCheckResult: state.lastCheckResult
        ? {
            ...state.lastCheckResult,
            updates: markRowsDownloaded(
              state.lastCheckResult.updates,
              chapterId,
            ),
          }
        : null,
      updates: markRowsDownloaded(state.updates, chapterId),
    })),
  mergeFirstPage: (page) =>
    set((state) => ({
      hasLoaded: true,
      hasMoreUpdates: page.hasMore || state.hasMoreUpdates,
      nextUpdateOffset: Math.max(state.nextUpdateOffset, page.nextOffset),
      updates: mergeRows(page.updates, state.updates),
    })),
}));
