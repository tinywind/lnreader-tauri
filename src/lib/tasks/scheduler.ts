export type TaskLane = "main" | "source";

export type TaskPriority = "interactive" | "normal" | "background";

export type TaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type MainTaskKind =
  | "backup.export"
  | "backup.restore"
  | "maintenance.clearCachedNovels"
  | "maintenance.clearUpdates"
  | "maintenance.deleteReadDownloads"
  | "maintenance.clearPluginStorage"
  | "repository.add"
  | "repository.remove"
  | "repository.refreshIndex"
  | "plugin.install"
  | "plugin.uninstall";

export type SourceTaskKind =
  | "source.openSite"
  | "source.listPopular"
  | "source.listLatest"
  | "source.search"
  | "source.openNovel"
  | "source.refreshNovel"
  | "source.checkLibraryUpdates"
  | "source.globalSearch";

export type ChapterTaskKind =
  | "chapter.download"
  | "chapter.downloadBatch"
  | "chapter.deleteDownload";

export type TaskKind = MainTaskKind | SourceTaskKind | ChapterTaskKind;

export interface TaskSource {
  id: string;
  name: string;
}

export interface TaskSubject {
  chapterId?: number;
  chapterName?: string;
  novelId?: number;
  novelName?: string;
  path?: string;
  pluginId?: string;
  url?: string;
}

export interface TaskProgress {
  current: number;
  total?: number;
}

export interface TaskRecord {
  id: string;
  lane: TaskLane;
  kind: TaskKind;
  priority: TaskPriority;
  title: string;
  source?: TaskSource;
  subject?: TaskSubject;
  status: TaskStatus;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
  progress?: TaskProgress;
  detail?: string;
  error?: string;
  canCancel: boolean;
  canRetry: boolean;
}

export interface TaskSnapshot {
  pausedSourceIds: string[];
  records: TaskRecord[];
  sourceQueuesPaused: boolean;
  running: number;
  queued: number;
  failed: number;
  succeeded: number;
  cancelled: number;
}

export interface TaskEvent {
  task: TaskRecord;
  previousStatus: TaskStatus | null;
}

export interface TaskRunContext {
  signal: AbortSignal;
  taskId: string;
  setDetail: (detail: string) => void;
  setProgress: (progress: TaskProgress | undefined) => void;
}

export interface TaskSpec<T> {
  lane: TaskLane;
  kind: TaskKind;
  title: string;
  priority?: TaskPriority;
  source?: TaskSource;
  subject?: TaskSubject;
  dedupeKey?: string;
  exclusive?: boolean;
  run: (context: TaskRunContext) => Promise<T>;
}

export interface MainTaskSpec<T>
  extends Omit<TaskSpec<T>, "lane" | "source"> {
  kind: MainTaskKind;
}

export interface SourceTaskSpec<T> extends Omit<TaskSpec<T>, "lane"> {
  kind: SourceTaskKind | ChapterTaskKind;
  source: TaskSource;
}

export interface TaskHandle<T> {
  id: string;
  promise: Promise<T>;
}

interface TaskEntry {
  controller: AbortController;
  dedupeKey?: string;
  exclusive: boolean;
  promise: Promise<unknown>;
  record: TaskRecord;
  reject: (error: unknown) => void;
  resolve: (value: unknown) => void;
  spec: TaskSpec<unknown>;
}

const DEFAULT_SOURCE_FOREGROUND_CONCURRENCY = 3;
const DEFAULT_SOURCE_BACKGROUND_CONCURRENCY = 2;
const HISTORY_LIMIT = 200;
const TERMINAL_TASK_RETENTION_MS = 2_000;

function priorityRank(priority: TaskPriority): number {
  switch (priority) {
    case "interactive":
      return 0;
    case "normal":
      return 1;
    case "background":
      return 2;
  }
}

function makeTaskId(): string {
  return `task-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 9)}`;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return (
    error instanceof DOMException && error.name === "AbortError"
  ) || (error instanceof Error && error.name === "AbortError");
}

export class TaskScheduler {
  private readonly activeDedupeByKey = new Map<string, string>();
  private readonly activeSourceById = new Map<string, string>();
  private readonly entries = new Map<string, TaskEntry>();
  private readonly eventListeners = new Set<(event: TaskEvent) => void>();
  private readonly latestByDedupeKey = new Map<string, string>();
  private readonly mainQueue: string[] = [];
  private readonly pausedSourceIds = new Set<string>();
  private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly snapshotListeners = new Set<() => void>();
  private readonly sourceQueues = new Map<string, string[]>();
  private readonly sourceForegroundConcurrency: number;
  private readonly sourceBackgroundConcurrency: number;
  private readonly terminalTaskRetentionMs: number;
  private sourceQueuesPaused: boolean;
  private activeBackgroundCount = 0;
  private activeExclusiveSourceTaskId: string | null = null;
  private activeForegroundCount = 0;
  private activeMainTaskId: string | null = null;
  private snapshot: TaskSnapshot = {
    pausedSourceIds: [],
    records: [],
    sourceQueuesPaused: false,
    running: 0,
    queued: 0,
    failed: 0,
    succeeded: 0,
    cancelled: 0,
  };

  constructor(options: {
    sourceForegroundConcurrency?: number;
    sourceBackgroundConcurrency?: number;
    sourceQueuesPaused?: boolean;
    terminalTaskRetentionMs?: number;
  } = {}) {
    this.sourceQueuesPaused = options.sourceQueuesPaused ?? false;
    this.terminalTaskRetentionMs = Math.max(
      0,
      options.terminalTaskRetentionMs ?? TERMINAL_TASK_RETENTION_MS,
    );
    this.sourceForegroundConcurrency = Math.max(
      1,
      options.sourceForegroundConcurrency ??
        DEFAULT_SOURCE_FOREGROUND_CONCURRENCY,
    );
    this.sourceBackgroundConcurrency = Math.max(
      1,
      options.sourceBackgroundConcurrency ??
        DEFAULT_SOURCE_BACKGROUND_CONCURRENCY,
    );
    this.snapshot = this.buildSnapshot();
  }

  private debug(
    message: string,
    entry?: TaskEntry,
    extra?: Record<string, unknown>,
  ): void {
    console.info(`[task-scheduler] ${message}`, {
      activeBackgroundCount: this.activeBackgroundCount,
      activeForegroundCount: this.activeForegroundCount,
      activeMainTaskId: this.activeMainTaskId,
      exclusive: entry?.exclusive,
      kind: entry?.record.kind,
      lane: entry?.record.lane,
      mainQueueLength: this.mainQueue.length,
      pausedSourceIds: [...this.pausedSourceIds].sort(),
      priority: entry?.record.priority,
      sourceId: entry?.record.source?.id,
      sourceName: entry?.record.source?.name,
      sourceQueueLength: entry?.record.source
        ? this.sourceQueues.get(entry.record.source.id)?.length ?? 0
        : undefined,
      sourceQueuesPaused: this.sourceQueuesPaused,
      status: entry?.record.status,
      taskId: entry?.record.id,
      ...extra,
    });
  }

  enqueueMain<T>(spec: MainTaskSpec<T>): TaskHandle<T> {
    return this.enqueue({ ...spec, lane: "main" });
  }

  enqueueSource<T>(spec: SourceTaskSpec<T>): TaskHandle<T> {
    return this.enqueue({ ...spec, lane: "source" });
  }

  enqueue<T>(spec: TaskSpec<T>): TaskHandle<T> {
    if (spec.lane === "source" && !spec.source?.id) {
      throw new Error("Source tasks require a source id.");
    }

    if (spec.dedupeKey && spec.kind !== "source.openSite") {
      const activeId = this.activeDedupeByKey.get(spec.dedupeKey);
      const activeEntry = activeId ? this.entries.get(activeId) : undefined;
      if (activeEntry) {
        return {
          id: activeEntry.record.id,
          promise: activeEntry.promise as Promise<T>,
        };
      }
    }

    const id = makeTaskId();
    const controller = new AbortController();
    let resolve!: (value: unknown) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<unknown>((promiseResolve, promiseReject) => {
      resolve = promiseResolve;
      reject = promiseReject;
    });
    const entry: TaskEntry = {
      controller,
      dedupeKey: spec.dedupeKey,
      exclusive: spec.exclusive ?? false,
      promise,
      reject,
      resolve,
      spec: spec as TaskSpec<unknown>,
      record: {
        id,
        lane: spec.lane,
        kind: spec.kind,
        priority: spec.priority ?? "normal",
        title: spec.title,
        source: spec.source,
        subject: spec.subject,
        status: "queued",
        createdAt: Date.now(),
        canCancel: true,
        canRetry: false,
      },
    };

    this.entries.set(id, entry);
    if (spec.dedupeKey) {
      this.activeDedupeByKey.set(spec.dedupeKey, id);
      this.latestByDedupeKey.set(spec.dedupeKey, id);
    }

    if (spec.lane === "main") {
      this.mainQueue.push(id);
    } else {
      const sourceId = spec.source!.id;
      const queue = this.sourceQueues.get(sourceId) ?? [];
      queue.push(id);
      this.sourceQueues.set(sourceId, queue);
    }

    if (spec.kind === "source.openSite") {
      this.cancelOtherOpenSiteTasks(id);
    }

    this.debug("queued", entry, { dedupeKey: entry.dedupeKey });
    this.publish(entry, null);
    this.drain();
    return { id, promise: promise as Promise<T> };
  }

  cancel(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.debug("cancel requested", entry);

    if (entry.record.status === "running") {
      entry.controller.abort();
      this.finishRunningAsCancelled(entry);
      return true;
    }

    if (entry.record.status !== "queued") return false;

    if (entry.record.lane === "main") {
      this.removeQueuedId(this.mainQueue, id);
    } else if (entry.record.source) {
      const queue = this.sourceQueues.get(entry.record.source.id);
      if (queue) this.removeQueuedId(queue, id);
    }

    this.finishQueuedAsCancelled(entry);
    this.drain();
    return true;
  }

  private cancelOtherOpenSiteTasks(taskId: string): void {
    for (const entry of [...this.entries.values()]) {
      if (
        entry.record.id !== taskId &&
        entry.record.kind === "source.openSite" &&
        (entry.record.status === "queued" || entry.record.status === "running")
      ) {
        this.cancel(entry.record.id);
      }
    }
  }

  retry(id: string): TaskHandle<unknown> | null {
    const entry = this.entries.get(id);
    if (!entry) return null;
    if (entry.record.status !== "failed" && entry.record.status !== "cancelled") {
      return null;
    }
    const { spec } = entry;
    return this.enqueue({ ...spec, dedupeKey: spec.dedupeKey });
  }

  pauseSourceQueue(sourceId?: string): boolean {
    if (!sourceId) {
      if (this.sourceQueuesPaused) return false;
      this.sourceQueuesPaused = true;
      this.debug("all source queues paused");
      this.publishSnapshot();
      return true;
    }

    if (this.pausedSourceIds.has(sourceId)) return false;
    this.pausedSourceIds.add(sourceId);
    this.debug("source queue paused", undefined, { sourceId });
    this.publishSnapshot();
    return true;
  }

  resumeSourceQueue(sourceId?: string): boolean {
    if (!sourceId) {
      if (!this.sourceQueuesPaused && this.pausedSourceIds.size === 0) {
        return false;
      }
      this.sourceQueuesPaused = false;
      this.pausedSourceIds.clear();
      this.debug("all source queues resumed");
      this.publishSnapshot();
      this.drain();
      return true;
    }

    if (!this.pausedSourceIds.delete(sourceId)) return false;
    this.debug("source queue resumed", undefined, { sourceId });
    this.publishSnapshot();
    this.drain();
    return true;
  }

  getSnapshot = (): TaskSnapshot => this.snapshot;

  getTask(id: string): TaskRecord | undefined {
    const entry = this.entries.get(id);
    return entry ? { ...entry.record } : undefined;
  }

  getTaskByDedupeKey(key: string): TaskRecord | undefined {
    const id = this.latestByDedupeKey.get(key);
    return id ? this.getTask(id) : undefined;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.snapshotListeners.add(listener);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  };

  subscribeEvents(listener: (event: TaskEvent) => void): () => void {
    this.eventListeners.add(listener);
    return () => {
      this.eventListeners.delete(listener);
    };
  }

  private drain(): void {
    this.drainMain();
    this.drainSourceForeground();
    this.drainSourceBackground();
  }

  private drainMain(): void {
    if (this.activeMainTaskId || this.mainQueue.length === 0) return;
    const id = this.mainQueue.shift();
    if (!id) return;
    const entry = this.entries.get(id);
    if (!entry) return;
    this.activeMainTaskId = id;
    this.start(entry);
  }

  private drainSourceForeground(): void {
    if (this.sourceQueuesPaused) return;

    while (this.activeForegroundCount < this.sourceForegroundConcurrency) {
      const next = this.pickSourceTask((entry) => {
        if (entry.record.priority === "background") return false;
        if (this.activeExclusiveSourceTaskId) return false;
        if (entry.exclusive && this.activeForegroundCount > 0) return false;
        return true;
      });
      if (!next) return;
      this.removeFromSourceQueue(next);
      this.activeSourceById.set(next.record.source!.id, next.record.id);
      this.activeForegroundCount += 1;
      if (next.exclusive) this.activeExclusiveSourceTaskId = next.record.id;
      this.start(next);
    }
  }

  private drainSourceBackground(): void {
    if (this.sourceQueuesPaused) return;

    if (this.activeForegroundCount > 0 || this.hasQueuedForegroundSourceTask()) {
      return;
    }

    while (this.activeBackgroundCount < this.sourceBackgroundConcurrency) {
      const next = this.pickSourceTask(
        (entry) => entry.record.priority === "background",
      );
      if (!next) return;
      this.removeFromSourceQueue(next);
      this.activeSourceById.set(next.record.source!.id, next.record.id);
      this.activeBackgroundCount += 1;
      this.start(next);
    }
  }

  private pickSourceTask(
    predicate: (entry: TaskEntry) => boolean,
  ): TaskEntry | null {
    const candidates: TaskEntry[] = [];
    for (const [sourceId, queue] of this.sourceQueues) {
      if (this.pausedSourceIds.has(sourceId)) continue;
      let sourceCandidate: TaskEntry | null = null;
      for (const id of queue) {
        const entry = this.entries.get(id);
        if (!entry || entry.record.status !== "queued" || !entry.record.source) {
          continue;
        }
        if (this.activeSourceById.has(entry.record.source.id)) break;
        if (!predicate(entry)) continue;
        if (!sourceCandidate || this.compareTaskOrder(entry, sourceCandidate) < 0) {
          sourceCandidate = entry;
        }
      }
      if (sourceCandidate) candidates.push(sourceCandidate);
    }

    candidates.sort((a, b) => this.compareTaskOrder(a, b));
    return candidates[0] ?? null;
  }

  private compareTaskOrder(a: TaskEntry, b: TaskEntry): number {
    const priority = priorityRank(a.record.priority) - priorityRank(b.record.priority);
    if (priority !== 0) return priority;
    return a.record.createdAt - b.record.createdAt;
  }

  private hasQueuedForegroundSourceTask(): boolean {
    for (const [sourceId, queue] of this.sourceQueues) {
      if (this.pausedSourceIds.has(sourceId)) continue;
      for (const id of queue) {
        const entry = this.entries.get(id);
        if (!entry || entry.record.status !== "queued") continue;
        if (entry.record.priority !== "background") return true;
      }
    }
    return false;
  }

  private start(entry: TaskEntry): void {
    this.setStatus(entry, "running", {
      canCancel: true,
      canRetry: false,
      startedAt: Date.now(),
    });
    this.debug("started", entry);

    const context: TaskRunContext = {
      signal: entry.controller.signal,
      taskId: entry.record.id,
      setDetail: (detail) => {
        entry.record = { ...entry.record, detail };
        this.publish(entry, entry.record.status);
      },
      setProgress: (progress) => {
        entry.record = { ...entry.record, progress };
        this.publish(entry, entry.record.status);
      },
    };

    Promise.resolve()
      .then(() => entry.spec.run(context))
      .then((value) => {
        if (entry.controller.signal.aborted) {
          this.finishRunningAsCancelled(entry);
          return;
        }
        this.finishRunning(entry, "succeeded", {
          canCancel: false,
          canRetry: false,
          finishedAt: Date.now(),
        });
        if (entry.record.status === "succeeded") entry.resolve(value);
      })
      .catch((error) => {
        const cancelled = entry.controller.signal.aborted || isAbortError(error);
        this.finishRunning(entry, cancelled ? "cancelled" : "failed", {
          canCancel: false,
          canRetry: cancelled,
          error: cancelled ? undefined : describeError(error),
          finishedAt: Date.now(),
        });
        if (entry.record.status === "cancelled" || entry.record.status === "failed") {
          entry.reject(error);
        }
      });
  }

  private finishRunning(
    entry: TaskEntry,
    status: TaskStatus,
    patch: Partial<TaskRecord>,
  ): boolean {
    if (entry.record.status !== "running") return false;
    this.setStatus(entry, status, patch);
    this.debug("finished", entry);
    this.releaseActive(entry);
    this.trimHistory();
    this.drain();
    return true;
  }

  private finishRunningAsCancelled(entry: TaskEntry): void {
    const finished = this.finishRunning(entry, "cancelled", {
      canCancel: false,
      canRetry: true,
      finishedAt: Date.now(),
    });
    if (finished) {
      entry.reject(new DOMException("Task was cancelled.", "AbortError"));
    }
  }

  private releaseActive(entry: TaskEntry): void {
    if (entry.record.lane === "main") {
      if (this.activeMainTaskId === entry.record.id) this.activeMainTaskId = null;
    } else {
      const sourceId = entry.record.source?.id;
      if (sourceId && this.activeSourceById.get(sourceId) === entry.record.id) {
        this.activeSourceById.delete(sourceId);
      }
      if (entry.record.priority === "background") {
        this.activeBackgroundCount = Math.max(0, this.activeBackgroundCount - 1);
      } else {
        this.activeForegroundCount = Math.max(0, this.activeForegroundCount - 1);
      }
      if (this.activeExclusiveSourceTaskId === entry.record.id) {
        this.activeExclusiveSourceTaskId = null;
      }
    }

    if (
      entry.dedupeKey &&
      this.activeDedupeByKey.get(entry.dedupeKey) === entry.record.id
    ) {
      this.activeDedupeByKey.delete(entry.dedupeKey);
    }
  }

  private setStatus(
    entry: TaskEntry,
    status: TaskStatus,
    patch: Partial<TaskRecord> = {},
  ): void {
    const previousStatus = entry.record.status;
    entry.record = {
      ...entry.record,
      ...patch,
      status,
    };
    this.entries.set(entry.record.id, entry);
    this.publish(entry, previousStatus);
    this.scheduleTerminalCleanup(entry);
  }

  private scheduleTerminalCleanup(entry: TaskEntry): void {
    if (entry.record.status !== "succeeded" && entry.record.status !== "cancelled") {
      return;
    }

    const existingTimer = this.cleanupTimers.get(entry.record.id);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
      this.cleanupTimers.delete(entry.record.id);
      const current = this.entries.get(entry.record.id);
      if (
        !current ||
        (current.record.status !== "succeeded" &&
          current.record.status !== "cancelled")
      ) {
        return;
      }
      this.deleteEntry(current);
      this.publishSnapshot();
    }, this.terminalTaskRetentionMs);
    if (typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }
    this.cleanupTimers.set(entry.record.id, timer);
  }

  private publish(entry: TaskEntry, previousStatus: TaskStatus | null): void {
    this.publishSnapshot();
    const event = { task: { ...entry.record }, previousStatus };
    for (const listener of this.eventListeners) listener(event);
  }

  private publishSnapshot(): void {
    this.snapshot = this.buildSnapshot();
    for (const listener of this.snapshotListeners) listener();
  }

  private buildSnapshot(): TaskSnapshot {
    const records = [...this.entries.values()]
      .map((entry) => ({ ...entry.record }))
      .sort((a, b) => b.createdAt - a.createdAt);
    return {
      pausedSourceIds: [...this.pausedSourceIds].sort(),
      records,
      sourceQueuesPaused: this.sourceQueuesPaused,
      running: records.filter((task) => task.status === "running").length,
      queued: records.filter((task) => task.status === "queued").length,
      failed: records.filter((task) => task.status === "failed").length,
      succeeded: records.filter((task) => task.status === "succeeded").length,
      cancelled: records.filter((task) => task.status === "cancelled").length,
    };
  }

  private finishQueuedAsCancelled(entry: TaskEntry): void {
    this.setStatus(entry, "cancelled", {
      canCancel: false,
      canRetry: true,
      finishedAt: Date.now(),
    });
    this.debug("queued task cancelled", entry);
    if (
      entry.dedupeKey &&
      this.activeDedupeByKey.get(entry.dedupeKey) === entry.record.id
    ) {
      this.activeDedupeByKey.delete(entry.dedupeKey);
    }
    entry.reject(new Error("Task was cancelled."));
  }

  private removeFromSourceQueue(entry: TaskEntry): void {
    const sourceId = entry.record.source?.id;
    if (!sourceId) return;
    const queue = this.sourceQueues.get(sourceId);
    if (queue) this.removeQueuedId(queue, entry.record.id);
  }

  private removeQueuedId(queue: string[], id: string): void {
    const index = queue.indexOf(id);
    if (index >= 0) queue.splice(index, 1);
  }

  private trimHistory(): void {
    if (this.entries.size <= HISTORY_LIMIT) return;
    const removable = [...this.entries.values()]
      .filter(
        (entry) =>
          entry.record.status !== "queued" && entry.record.status !== "running",
      )
      .sort((a, b) => a.record.createdAt - b.record.createdAt);
    for (const entry of removable) {
      if (this.entries.size <= HISTORY_LIMIT) return;
      this.deleteEntry(entry);
    }
    this.snapshot = this.buildSnapshot();
  }

  private deleteEntry(entry: TaskEntry): void {
    const timer = this.cleanupTimers.get(entry.record.id);
    if (timer) {
      clearTimeout(timer);
      this.cleanupTimers.delete(entry.record.id);
    }
    this.entries.delete(entry.record.id);
    if (
      entry.dedupeKey &&
      this.latestByDedupeKey.get(entry.dedupeKey) === entry.record.id
    ) {
      this.latestByDedupeKey.delete(entry.dedupeKey);
    }
  }
}

export const taskScheduler = new TaskScheduler();
