import { saveChapterContent } from "../../db/queries/chapter";
import { pluginManager, type PluginManager } from "../plugins/manager";

export interface DownloadJob {
  /** Local chapter row id (unique key in the queue). */
  id: number;
  pluginId: string;
  chapterPath: string;
}

export type DownloadStatus =
  | { kind: "queued" }
  | { kind: "running" }
  | { kind: "done" }
  | { kind: "cancelled" }
  | { kind: "failed"; error: string };

export interface DownloadEvent {
  job: DownloadJob;
  status: DownloadStatus;
}

export interface DownloadQueueOptions {
  concurrency?: number;
  manager?: PluginManager;
  /** Test seam — defaults to {@link saveChapterContent}. */
  save?: (chapterId: number, html: string) => Promise<void>;
}

const DEFAULT_CONCURRENCY = 2;

/**
 * In-memory chapter download queue. Bounded by `concurrency`,
 * emits `{job, status}` events for UI consumers.
 *
 * Failed jobs leave their status as `failed` so the UI can surface
 * the error and the user can re-enqueue. Re-enqueuing a job that's
 * currently `queued` or `running` is a no-op.
 */
export class DownloadQueue {
  private readonly listeners = new Set<(event: DownloadEvent) => void>();
  private readonly waiting: DownloadJob[] = [];
  private readonly active = new Set<number>();
  private readonly statusById = new Map<number, DownloadStatus>();
  private readonly concurrency: number;
  private readonly manager: PluginManager;
  private readonly save: (chapterId: number, html: string) => Promise<void>;

  constructor(options: DownloadQueueOptions = {}) {
    this.concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
    this.manager = options.manager ?? pluginManager;
    this.save = options.save ?? saveChapterContent;
  }

  enqueue(job: DownloadJob): boolean {
    const current = this.statusById.get(job.id);
    if (current?.kind === "queued" || current?.kind === "running") {
      return false;
    }
    this.waiting.push(job);
    this.setStatus(job, { kind: "queued" });
    this.drain();
    return true;
  }

  downloadNow(job: DownloadJob): Promise<void> {
    this.cancelWaitingExcept(job.id);

    const current = this.statusById.get(job.id);
    if (current?.kind === "running") {
      return this.waitForTerminalStatus(job.id);
    }

    this.removeWaiting(job.id);
    const completion = this.waitForTerminalStatus(job.id);
    this.active.add(job.id);
    void this.runJob(job);
    return completion;
  }

  status(chapterId: number): DownloadStatus | undefined {
    return this.statusById.get(chapterId);
  }

  subscribe(listener: (event: DownloadEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  size(): { active: number; waiting: number } {
    return { active: this.active.size, waiting: this.waiting.length };
  }

  private setStatus(job: DownloadJob, status: DownloadStatus): void {
    this.statusById.set(job.id, status);
    for (const listener of this.listeners) {
      listener({ job, status });
    }
  }

  private cancelWaitingExcept(chapterId: number): void {
    const retained: DownloadJob[] = [];
    for (const waitingJob of this.waiting) {
      if (waitingJob.id === chapterId) {
        retained.push(waitingJob);
        continue;
      }
      this.setStatus(waitingJob, { kind: "cancelled" });
    }
    this.waiting.length = 0;
    this.waiting.push(...retained);
  }

  private removeWaiting(chapterId: number): void {
    const index = this.waiting.findIndex((job) => job.id === chapterId);
    if (index >= 0) this.waiting.splice(index, 1);
  }

  private waitForTerminalStatus(chapterId: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const unsubscribe = this.subscribe((event) => {
        if (event.job.id !== chapterId) return;
        if (event.status.kind === "done") {
          unsubscribe();
          resolve();
          return;
        }
        if (event.status.kind === "failed") {
          unsubscribe();
          reject(new Error(event.status.error));
          return;
        }
        if (event.status.kind === "cancelled") {
          unsubscribe();
          reject(new Error("Download was cancelled."));
        }
      });
    });
  }

  private drain(): void {
    while (
      this.active.size < this.concurrency &&
      this.waiting.length > 0
    ) {
      const next = this.waiting.shift();
      if (!next) break;
      this.active.add(next.id);
      void this.runJob(next);
    }
  }

  private async runJob(job: DownloadJob): Promise<void> {
    this.setStatus(job, { kind: "running" });
    try {
      const plugin = this.manager.getPlugin(job.pluginId);
      if (!plugin) {
        throw new Error(`Plugin '${job.pluginId}' is not installed.`);
      }
      const html = await plugin.parseChapter(job.chapterPath);
      if (html.trim() === "") {
        throw new Error("Downloaded chapter content is empty.");
      }
      await this.save(job.id, html);
      this.setStatus(job, { kind: "done" });
    } catch (error) {
      this.setStatus(job, {
        kind: "failed",
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.active.delete(job.id);
      this.drain();
    }
  }
}

/** Process-global default queue used by the UI. */
export const downloadQueue = new DownloadQueue();
