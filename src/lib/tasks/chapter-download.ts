import {
  getChapterById,
  saveChapterContent,
} from "../../db/queries/chapter";
import { useBrowseStore } from "../../store/browse";
import { pluginManager } from "../plugins/manager";
import { isTauriRuntime } from "../tauri-runtime";
import {
  taskScheduler,
  type TaskEvent,
  type TaskHandle,
  type TaskPriority,
  type TaskRecord,
} from "./scheduler";

export interface ChapterDownloadJob {
  id: number;
  batchId?: string;
  batchTitle?: string;
  pluginId: string;
  pluginName?: string;
  chapterPath: string;
  chapterName?: string;
  novelId?: number;
  novelName?: string;
  priority?: TaskPriority;
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

export interface ChapterDownloadBatchResult {
  cancelled: number;
  failed: number;
  succeeded: number;
  total: number;
}

export interface ChapterDownloadBatchJob {
  jobs: ChapterDownloadJob[];
  title: string;
}

export interface ChapterDownloadBatchProgress {
  current: number;
  total: number;
}

interface ChapterDownloadBatchState extends ChapterDownloadBatchResult {
  settledChapterIds: Set<number>;
}

type ChapterDownloadBatchSettlement = "cancelled" | "failed" | "succeeded";

const chapterDownloadBatchStates = new Map<
  string,
  ChapterDownloadBatchState
>();
const CHAPTER_DOWNLOAD_QUEUE_STORAGE_KEY = "chapter-download-queue";
const CHAPTER_DOWNLOAD_QUEUE_STORAGE_VERSION = 1;

let restorePersistedChapterDownloadsStarted = false;

interface PersistedChapterDownloadQueue {
  jobs: ChapterDownloadJob[];
  version: typeof CHAPTER_DOWNLOAD_QUEUE_STORAGE_VERSION;
}

function chapterDownloadDedupeKey(chapterId: number): string {
  return `chapter.download:${chapterId}`;
}

function chapterDownloadCooldownKey(pluginId: string): string {
  return `chapter.download:${pluginId}`;
}

function chapterDownloadCooldownMs(): number {
  return useBrowseStore.getState().chapterDownloadCooldownSeconds * 1_000;
}

function makeChapterDownloadBatchId(): string {
  return `chapter-download-batch-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function readStringField(
  record: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = record[key];
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function readPositiveIntegerField(
  record: Record<string, unknown>,
  key: string,
): number | undefined {
  const value = record[key];
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    !Number.isInteger(value) ||
    value <= 0
  ) {
    return undefined;
  }
  return value;
}

function normalizePersistedChapterDownloadJob(
  value: unknown,
): ChapterDownloadJob | null {
  if (value === null || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = readPositiveIntegerField(record, "id");
  const pluginId = readStringField(record, "pluginId");
  const chapterPath = readStringField(record, "chapterPath");
  const title =
    readStringField(record, "title") ??
    readStringField(record, "chapterName");
  if (!id || !pluginId || !chapterPath || !title) return null;

  return {
    id,
    pluginId,
    pluginName: readStringField(record, "pluginName"),
    chapterPath,
    chapterName: readStringField(record, "chapterName"),
    novelId: readPositiveIntegerField(record, "novelId"),
    novelName: readStringField(record, "novelName"),
    priority: "background",
    title,
  };
}

function readPersistedChapterDownloadJobs(): ChapterDownloadJob[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(CHAPTER_DOWNLOAD_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== "object") return [];
    const queue = parsed as Partial<PersistedChapterDownloadQueue>;
    if (
      queue.version !== CHAPTER_DOWNLOAD_QUEUE_STORAGE_VERSION ||
      !Array.isArray(queue.jobs)
    ) {
      return [];
    }
    const jobsById = new Map<number, ChapterDownloadJob>();
    for (const item of queue.jobs) {
      const job = normalizePersistedChapterDownloadJob(item);
      if (job) jobsById.set(job.id, job);
    }
    return [...jobsById.values()];
  } catch (error) {
    console.warn("[chapter-download] failed to read persisted queue:", error);
    return [];
  }
}

function writePersistedChapterDownloadJobs(jobs: ChapterDownloadJob[]): void {
  if (typeof window === "undefined") return;
  try {
    if (jobs.length === 0) {
      window.localStorage.removeItem(CHAPTER_DOWNLOAD_QUEUE_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(
      CHAPTER_DOWNLOAD_QUEUE_STORAGE_KEY,
      JSON.stringify({
        jobs,
        version: CHAPTER_DOWNLOAD_QUEUE_STORAGE_VERSION,
      } satisfies PersistedChapterDownloadQueue),
    );
  } catch (error) {
    console.warn("[chapter-download] failed to persist queue:", error);
  }
}

function persistChapterDownloadJob(job: ChapterDownloadJob): void {
  const persisted = normalizePersistedChapterDownloadJob(job);
  if (!persisted) return;
  const jobsById = new Map<number, ChapterDownloadJob>();
  for (const existing of readPersistedChapterDownloadJobs()) {
    jobsById.set(existing.id, existing);
  }
  jobsById.set(persisted.id, persisted);
  writePersistedChapterDownloadJobs([...jobsById.values()]);
}

function removePersistedChapterDownloadJob(chapterId: number): void {
  writePersistedChapterDownloadJobs(
    readPersistedChapterDownloadJobs().filter((job) => job.id !== chapterId),
  );
}

function settleChapterDownloadBatchJob(
  batchId: string | undefined,
  chapterId: number,
  settlement: ChapterDownloadBatchSettlement,
): void {
  if (!batchId) return;
  const state = chapterDownloadBatchStates.get(batchId);
  if (!state || state.settledChapterIds.has(chapterId)) return;

  state.settledChapterIds.add(chapterId);
  state[settlement] += 1;
}

export function getActiveChapterDownloadBatchProgress():
  | ChapterDownloadBatchProgress
  | undefined {
  const activeBatches = [...chapterDownloadBatchStates.values()];
  if (activeBatches.length === 0) return undefined;

  return activeBatches.reduce<ChapterDownloadBatchProgress>(
    (sum, batch) => ({
      current: sum.current + batch.settledChapterIds.size,
      total: sum.total + batch.total,
    }),
    { current: 0, total: 0 },
  );
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
      batchId: task.subject?.batchId,
      batchTitle: task.subject?.batchTitle,
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
  persistChapterDownloadJob(job);
  const handle = taskScheduler.enqueueSource<void>({
    kind: "chapter.download",
    priority: job.priority ?? "background",
    title: job.title,
    source: { id: job.pluginId, name: sourceName },
    subject: {
      chapterId: job.id,
      chapterName: job.chapterName,
      novelId: job.novelId,
      novelName: job.novelName,
      path: job.chapterPath,
      pluginId: job.pluginId,
      batchId: job.batchId,
      batchTitle: job.batchTitle,
    },
    dedupeKey: chapterDownloadDedupeKey(job.id),
    sourceCooldownKey: chapterDownloadCooldownKey(job.pluginId),
    sourceCooldownMs: chapterDownloadCooldownMs(),
    run: async ({ executor, setProgress, signal }) => {
      setProgress({ current: 0, total: 1 });
      try {
        if (isTauriRuntime()) {
          await pluginManager.loadInstalledFromDb();
        }
        const plugin = pluginManager.getPluginForExecutor(
          job.pluginId,
          executor ?? "immediate",
        );
        const html = await plugin.parseChapter(job.chapterPath);
        if (signal.aborted) {
          throw new DOMException("Task was cancelled.", "AbortError");
        }
        if (html.trim() === "") {
          throw new Error("Downloaded chapter content is empty.");
        }
        await saveChapterContent(job.id, html);
        settleChapterDownloadBatchJob(job.batchId, job.id, "succeeded");
        setProgress({ current: 1, total: 1 });
      } catch (error) {
        settleChapterDownloadBatchJob(
          job.batchId,
          job.id,
          signal.aborted || isAbortError(error) ? "cancelled" : "failed",
        );
        throw error;
      }
    },
  });
  void handle.promise.then(
    () => removePersistedChapterDownloadJob(job.id),
    () => removePersistedChapterDownloadJob(job.id),
  );
  return handle;
}

export function enqueueChapterDownloadBatch({
  jobs,
  title,
}: ChapterDownloadBatchJob): TaskHandle<ChapterDownloadBatchResult> {
  const batchId = makeChapterDownloadBatchId();
  const total = jobs.length;
  chapterDownloadBatchStates.set(batchId, {
    cancelled: 0,
    failed: 0,
    settledChapterIds: new Set(),
    succeeded: 0,
    total,
  });

  const handles = jobs.map((job) =>
    enqueueChapterDownload({
      ...job,
      batchId,
      batchTitle: title,
    }),
  );

  const promise = Promise.all(
    handles.map((handle, index) =>
      handle.promise
        .then(() => {
          settleChapterDownloadBatchJob(batchId, jobs[index].id, "succeeded");
        })
        .catch((error) => {
          settleChapterDownloadBatchJob(
            batchId,
            jobs[index].id,
            isAbortError(error) ? "cancelled" : "failed",
          );
        }),
    ),
  )
    .then(() => {
      const state = chapterDownloadBatchStates.get(batchId);
      const result = state
        ? {
            cancelled: state.cancelled,
            failed: state.failed,
            succeeded: state.succeeded,
            total: state.total,
          }
        : { cancelled: 0, failed: 0, succeeded: 0, total };
      if (result.failed > 0) {
        throw new Error(`${result.failed} chapter downloads failed.`);
      }
      return result;
    })
    .finally(() => {
      chapterDownloadBatchStates.delete(batchId);
    });

  return { id: batchId, promise };
}

export function getChapterDownloadStatus(
  chapterId: number,
): ChapterDownloadStatus | undefined {
  const task = taskScheduler.getTaskByDedupeKey(
    chapterDownloadDedupeKey(chapterId),
  );
  return task ? (statusFromTask(task) ?? undefined) : undefined;
}

export function listChapterDownloadStatuses(): ReadonlyMap<
  number,
  ChapterDownloadStatus
> {
  const statuses = new Map<number, ChapterDownloadStatus>();

  for (const task of taskScheduler.getSnapshot().records) {
    const event = eventFromTask(task);
    if (event) statuses.set(event.job.id, event.status);
  }

  return statuses;
}

export function subscribeChapterDownloads(
  listener: (event: ChapterDownloadEvent) => void,
): () => void {
  return taskScheduler.subscribeEvents((event: TaskEvent) => {
    const chapterEvent = eventFromTask(event.task);
    if (chapterEvent) listener(chapterEvent);
  });
}

export async function restorePersistedChapterDownloads(): Promise<void> {
  if (restorePersistedChapterDownloadsStarted || !isTauriRuntime()) return;
  restorePersistedChapterDownloadsStarted = true;

  const jobs = readPersistedChapterDownloadJobs();
  if (jobs.length === 0) return;

  const pendingJobs: ChapterDownloadJob[] = [];
  for (const job of jobs) {
    try {
      const chapter = await getChapterById(job.id);
      if (!chapter?.isDownloaded) pendingJobs.push(job);
    } catch (error) {
      console.warn(
        "[chapter-download] failed to inspect persisted chapter:",
        error,
      );
      pendingJobs.push(job);
    }
  }
  writePersistedChapterDownloadJobs(pendingJobs);
  if (pendingJobs.length === 0) return;

  try {
    await pluginManager.loadInstalledFromDb();
  } catch (error) {
    console.warn(
      "[chapter-download] failed to load plugins for restore:",
      error,
    );
    return;
  }

  for (const job of pendingJobs) {
    enqueueChapterDownload({ ...job, priority: "background" });
  }
}
