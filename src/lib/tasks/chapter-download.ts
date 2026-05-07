import { saveChapterContent } from "../../db/queries/chapter";
import { pluginManager } from "../plugins/manager";
import {
  taskScheduler,
  type TaskEvent,
  type TaskHandle,
  type TaskRecord,
} from "./scheduler";

export interface ChapterDownloadJob {
  id: number;
  pluginId: string;
  pluginName?: string;
  chapterPath: string;
  chapterName?: string;
  novelId?: number;
  novelName?: string;
  title: string;
}

export type ChapterDownloadStatus =
  | { kind: "queued" }
  | { kind: "running" }
  | { kind: "done" }
  | { kind: "cancelled" }
  | { kind: "failed"; error: string };

export interface ChapterDownloadEvent {
  job: ChapterDownloadJob;
  status: ChapterDownloadStatus;
  task: TaskRecord;
}

function chapterDownloadDedupeKey(chapterId: number): string {
  return `chapter.download:${chapterId}`;
}

function statusFromTask(task: TaskRecord): ChapterDownloadStatus | null {
  switch (task.status) {
    case "queued":
      return { kind: "queued" };
    case "running":
      return { kind: "running" };
    case "succeeded":
      return { kind: "done" };
    case "cancelled":
      return { kind: "cancelled" };
    case "failed":
      return { kind: "failed", error: task.error ?? task.title };
  }
}

function eventFromTask(task: TaskRecord): ChapterDownloadEvent | null {
  if (task.kind !== "chapter.download") return null;
  const chapterId = task.subject?.chapterId;
  const pluginId = task.subject?.pluginId ?? task.source?.id;
  const chapterPath = task.subject?.path;
  if (!chapterId || !pluginId || !chapterPath) return null;
  const status = statusFromTask(task);
  if (!status) return null;
  return {
    status,
    task,
    job: {
      id: chapterId,
      pluginId,
      pluginName: task.source?.name,
      chapterPath,
      chapterName: task.subject?.chapterName,
      novelId: task.subject?.novelId,
      novelName: task.subject?.novelName,
      title: task.title,
    },
  };
}

export function enqueueChapterDownload(
  job: ChapterDownloadJob,
): TaskHandle<void> {
  const sourceName = job.pluginName ?? job.pluginId;
  return taskScheduler.enqueueSource<void>({
    kind: "chapter.download",
    priority: "background",
    title: job.title,
    source: { id: job.pluginId, name: sourceName },
    subject: {
      chapterId: job.id,
      chapterName: job.chapterName,
      novelId: job.novelId,
      novelName: job.novelName,
      path: job.chapterPath,
      pluginId: job.pluginId,
    },
    dedupeKey: chapterDownloadDedupeKey(job.id),
    run: async () => {
      const plugin = pluginManager.getPlugin(job.pluginId);
      if (!plugin) {
        throw new Error(`Plugin '${job.pluginId}' is not installed.`);
      }
      const html = await plugin.parseChapter(job.chapterPath);
      if (html.trim() === "") {
        throw new Error("Downloaded chapter content is empty.");
      }
      await saveChapterContent(job.id, html);
    },
  });
}

export function getChapterDownloadStatus(
  chapterId: number,
): ChapterDownloadStatus | undefined {
  const task = taskScheduler.getTaskByDedupeKey(
    chapterDownloadDedupeKey(chapterId),
  );
  return task ? (statusFromTask(task) ?? undefined) : undefined;
}

export function subscribeChapterDownloads(
  listener: (event: ChapterDownloadEvent) => void,
): () => void {
  return taskScheduler.subscribeEvents((event: TaskEvent) => {
    const chapterEvent = eventFromTask(event.task);
    if (chapterEvent) listener(chapterEvent);
  });
}
