/**
 * Source task dispatch design
 *
 * Keep logical source queues separate from physical scraper executors.
 *
 * Logical source queues protect sites from noisy access patterns:
 * - Keep one queue per source id.
 * - Gate each source with pause, cooldown, backoff, and an active lease.
 * - Dispatch source queues through a base-domain lane so sources sharing a
 *   site do not spread across multiple hidden WebViews.
 * - Default to one active task per source, even when a higher priority task
 *   is waiting. Priority may change ordering, but it must not bypass source
 *   rate limits unless a future task explicitly opts into that policy.
 *
 * Physical scraper executors own WebViews:
 * - `immediate` owns the foreground/site-browser WebView and is reserved for
 *   UI-responsive work such as opening a site or manual challenge clearing.
 * - `pool:0..N-1` own hidden worker WebViews. N is the user-configured
 *   concurrent source work setting.
 * - All executor WebViews must use the same browser profile so cookies,
 *   storage, and authenticated sessions are shared without copying cookies.
 *
 * Dispatcher loop:
 * 1. Drain main app work.
 * 2. Drain the immediate executor with UI-responsive eligible work only.
 * 3. For each free pool executor, select one eligible candidate from each
 *    source queue, then choose by priority, domain affinity, fairness, and
 *    creation time.
 * 4. Mark a task running only after assigning an executor. Pass that executor
 *    id through TaskRunContext so plugin fetch/extract calls use the same
 *    WebView for the task lifetime.
 * 5. Release the executor and source lease only after the task and its native
 *    scraper work have actually settled. Cancellation must stop or settle the
 *    native scraper request before the WebView is reused.
 *
 * Route affinity is an optimization, not a queue type. A source that benefits
 * from repeated access through the same WebView may request a short sticky
 * executor lease via a route key, but executors should return to the shared
 * pool when that lease expires.
 */
import {
  runWithScraperExecutor,
  type ScraperExecutorId,
} from "./scraper-queue";

export type TaskLane = "main" | "source";

export type TaskPriority =
  | "interactive"
  | "user"
  | "normal"
  | "deferred"
  | "background";

export type TaskStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export type MainTaskKind =
  | "backup.export"
  | "backup.restore"
  | "library.checkUpdates"
  | "library.refreshMetadata"
  | "maintenance.clearLibraryMembership"
  | "maintenance.clearDownloadedContent"
  | "maintenance.clearReadingProgress"
  | "maintenance.clearUpdates"
  | "repository.add"
  | "repository.remove"
  | "repository.refreshIndex"
  | "plugin.install"
  | "plugin.uninstall";

export type MainLaneTaskKind = MainTaskKind | "source.openNovel";

export type SourceTaskKind =
  | "source.openSite"
  | "source.listPopular"
  | "source.listLatest"
  | "source.search"
  | "source.refreshNovel"
  | "source.checkLibraryUpdates"
  | "source.globalSearch";

export type ChapterTaskKind =
  | "chapter.download"
  | "chapter.deleteDownload";

export type TaskKind = MainLaneTaskKind | SourceTaskKind | ChapterTaskKind;

export interface TaskSource {
  id: string;
  name: string;
  site?: string;
}

export interface TaskSubject {
  batchId?: string;
  batchTitle?: string;
  chapterId?: number;
  chapterName?: string;
  contentType?: string;
  categoryId?: number | null;
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
  executor?: ScraperExecutorId;
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
  sourceCooldownKey?: string;
  sourceCooldownMs?: number;
  run: (context: TaskRunContext) => Promise<T>;
}

export interface MainTaskSpec<T>
  extends Omit<TaskSpec<T>, "lane" | "source"> {
  kind: MainLaneTaskKind;
}

export interface SourceTaskSpec<T> extends Omit<TaskSpec<T>, "lane"> {
  kind: SourceTaskKind | ChapterTaskKind;
  source: TaskSource;
}

export interface TaskHandle<T> {
  id: string;
  promise: Promise<T>;
}

export interface TaskCancelOptions {
  sourceId?: string;
}

interface TaskEntry {
  activeReleased: boolean;
  controller: AbortController;
  dedupeKey?: string;
  exclusive: boolean;
  promise: Promise<unknown>;
  record: TaskRecord;
  reject: (error: unknown) => void;
  resolve: (value: unknown) => void;
  sourceExecutorId?: ScraperExecutorId;
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
    case "user":
      return 1;
    case "normal":
      return 2;
    case "deferred":
      return 3;
    case "background":
      return 4;
  }
}

function isBackgroundPriority(priority: TaskPriority): boolean {
  return priority === "background";
}

function isImmediateSourceKind(kind: TaskKind): boolean {
  return kind === "source.openSite";
}

function poolExecutorId(index: number): ScraperExecutorId {
  return `pool:${index}`;
}

const commonSecondLevelDomainLabels = new Set([
  "ac",
  "co",
  "com",
  "edu",
  "go",
  "gov",
  "net",
  "ne",
  "or",
  "org",
  "re",
]);

function poolExecutorIndex(executorId: ScraperExecutorId): number | null {
  const match = /^pool:(\d+)$/.exec(executorId);
  return match ? Number(match[1]) : null;
}

export function sourceBaseDomainKey(site: string | undefined): string | null {
  const trimmed = site?.trim();
  if (!trimmed) {
    return null;
  }

  let hostname: string;
  try {
    const normalizedUrl = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    hostname = new URL(normalizedUrl).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }

  const withoutWww = hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  if (!withoutWww || withoutWww === "localhost" || withoutWww.includes(":")) {
    return withoutWww || null;
  }

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(withoutWww)) {
    return withoutWww;
  }

  const labels = withoutWww.split(".").filter(Boolean);
  if (labels.length <= 2) {
    return withoutWww;
  }

  const topLevel = labels[labels.length - 1]!;
  const secondLevel = labels[labels.length - 2]!;
  if (
    topLevel.length === 2 &&
    commonSecondLevelDomainLabels.has(secondLevel) &&
    labels.length >= 3
  ) {
    return labels.slice(-3).join(".");
  }

  return labels.slice(-2).join(".");
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
  private readonly activeSourceTaskIdsByDomain = new Map<string, Set<string>>();
  private readonly activeSourceTaskIdsById = new Map<string, Set<string>>();
  private readonly entries = new Map<string, TaskEntry>();
  private readonly eventListeners = new Set<(event: TaskEvent) => void>();
  private readonly latestByDedupeKey = new Map<string, string>();
  private readonly mainQueue: string[] = [];
  private readonly pausedSourceIds = new Set<string>();
  private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly snapshotListeners = new Set<() => void>();
  private readonly sourceCooldownTimers = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  private readonly sourceCooldownUntilByKey = new Map<string, number>();
  private readonly sourceQueues = new Map<string, string[]>();
  private sourceForegroundConcurrency: number;
  private readonly sourceBackgroundConcurrency: number;
  private readonly terminalTaskRetentionMs: number;
  private sourceQueuesPaused: boolean;
  private activeBackgroundCount = 0;
  private activeImmediateTaskId: string | null = null;
  private activeMainTaskId: string | null = null;
  private readonly activePoolTaskIdsByExecutor = new Map<ScraperExecutorId, string>();
  private readonly sourceExecutorByDomain = new Map<string, ScraperExecutorId>();
  private readonly sourceLastServedAt = new Map<string, number>();
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
    console.debug(`[task-scheduler] ${message}`, {
      activeBackgroundCount: this.activeBackgroundCount,
      activeImmediateTaskId: this.activeImmediateTaskId,
      activePoolTaskIdsByExecutor: Object.fromEntries(
        this.activePoolTaskIdsByExecutor,
      ),
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
        const requestedPriority = spec.priority ?? "normal";
        if (
          activeEntry.record.status === "queued" &&
          priorityRank(requestedPriority) <
            priorityRank(activeEntry.record.priority)
        ) {
          activeEntry.spec = { ...activeEntry.spec, priority: requestedPriority };
          activeEntry.record = {
            ...activeEntry.record,
            priority: requestedPriority,
          };
          this.publishSnapshot();
          this.drain();
        }
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
      activeReleased: true,
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
      this.cancelRunning(entry);
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

  cancelActiveTasks(options: TaskCancelOptions = {}): number {
    const cancellableTaskIds = [...this.entries.values()]
      .filter((entry) => this.isCancellableActiveEntry(entry, options))
      .sort((left, right) => {
        const leftRank = left.record.status === "queued" ? 0 : 1;
        const rightRank = right.record.status === "queued" ? 0 : 1;
        return leftRank - rightRank;
      })
      .map((entry) => entry.record.id);
    let cancelled = 0;

    for (const taskId of cancellableTaskIds) {
      if (this.cancel(taskId)) cancelled += 1;
    }

    return cancelled;
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

  private isCancellableActiveEntry(
    entry: TaskEntry,
    options: TaskCancelOptions,
  ): boolean {
    if (!entry.record.canCancel) return false;
    if (entry.record.status !== "queued" && entry.record.status !== "running") {
      return false;
    }
    if (!options.sourceId) return true;
    return (
      entry.record.lane === "source" &&
      entry.record.source?.id === options.sourceId
    );
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

  clearFailedTasks(): number {
    const failedEntries = [...this.entries.values()].filter(
      (entry) => entry.record.status === "failed",
    );
    for (const entry of failedEntries) {
      this.deleteEntry(entry);
    }
    if (failedEntries.length > 0) this.publishSnapshot();
    return failedEntries.length;
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

  setSourceForegroundConcurrency(concurrency: number): void {
    const nextConcurrency = Number.isFinite(concurrency)
      ? Math.max(1, Math.round(concurrency))
      : DEFAULT_SOURCE_FOREGROUND_CONCURRENCY;
    if (nextConcurrency === this.sourceForegroundConcurrency) return;
    this.sourceForegroundConcurrency = nextConcurrency;
    this.dropDisabledDomainExecutors();
    this.debug("source foreground concurrency changed", undefined, {
      sourceForegroundConcurrency: nextConcurrency,
    });
    this.drain();
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
    this.drainImmediateExecutor();
    this.drainSourcePool();
  }

  private drainMain(): void {
    if (this.activeMainTaskId || this.mainQueue.length === 0) return;
    let nextIndex = -1;
    let entry: TaskEntry | undefined;
    for (let index = 0; index < this.mainQueue.length; index += 1) {
      const candidate = this.entries.get(this.mainQueue[index]);
      if (!candidate || candidate.record.status !== "queued") continue;
      if (!entry || this.compareTaskOrder(candidate, entry) < 0) {
        entry = candidate;
        nextIndex = index;
      }
    }
    if (!entry || nextIndex < 0) return;
    this.mainQueue.splice(nextIndex, 1);
    this.activeMainTaskId = entry.record.id;
    this.start(entry);
  }

  private drainImmediateExecutor(): void {
    if (this.activeImmediateTaskId) return;
    const next = this.pickSourceTask(
      (entry) => isImmediateSourceKind(entry.record.kind),
      { allowPaused: true, allowActiveSource: true },
    );
    if (!next) return;
    this.startSource(next, "immediate");
  }

  private drainSourcePool(): void {
    for (const executorId of this.freePoolExecutorIds()) {
      const next = this.pickSourceTask((entry) => {
        if (isImmediateSourceKind(entry.record.kind)) return false;
        if (!this.canUseExecutorForSourceDomain(entry, executorId)) return false;
        if (
          isBackgroundPriority(entry.record.priority) &&
          this.activeBackgroundCount >= this.sourceBackgroundConcurrency
        ) {
          return false;
        }
        return true;
      });
      if (!next) continue;
      this.startSource(next, executorId);
    }
  }

  private freePoolExecutorIds(): ScraperExecutorId[] {
    const ids: ScraperExecutorId[] = [];
    for (let index = 0; index < this.sourceForegroundConcurrency; index += 1) {
      const executorId = poolExecutorId(index);
      if (!this.activePoolTaskIdsByExecutor.has(executorId)) ids.push(executorId);
    }
    return ids;
  }

  private isEnabledPoolExecutor(executorId: ScraperExecutorId): boolean {
    const index = poolExecutorIndex(executorId);
    return index !== null && index < this.sourceForegroundConcurrency;
  }

  private assignedDomainExecutor(
    domainKey: string,
  ): ScraperExecutorId | undefined {
    const executorId = this.sourceExecutorByDomain.get(domainKey);
    if (!executorId) return undefined;
    if (this.isEnabledPoolExecutor(executorId)) return executorId;
    this.sourceExecutorByDomain.delete(domainKey);
    return undefined;
  }

  private dropDisabledDomainExecutors(): void {
    for (const [domainKey, executorId] of this.sourceExecutorByDomain) {
      if (!this.isEnabledPoolExecutor(executorId)) {
        this.sourceExecutorByDomain.delete(domainKey);
      }
    }
  }

  private canUseExecutorForSourceDomain(
    entry: TaskEntry,
    executorId: ScraperExecutorId,
  ): boolean {
    const domainKey = this.sourceDomainKey(entry);
    if (!domainKey) return true;
    const assignedExecutor = this.assignedDomainExecutor(domainKey);
    return !assignedExecutor || assignedExecutor === executorId;
  }

  private hasQueuedSourceDomain(domainKey: string): boolean {
    for (const queue of this.sourceQueues.values()) {
      for (const id of queue) {
        const entry = this.entries.get(id);
        if (
          entry?.record.status === "queued" &&
          this.sourceDomainKey(entry) === domainKey
        ) {
          return true;
        }
      }
    }
    return false;
  }

  private startSource(entry: TaskEntry, executorId: ScraperExecutorId): void {
    this.removeFromSourceQueue(entry);
    const sourceId = entry.record.source!.id;
    const activeIds = this.activeSourceTaskIdsById.get(sourceId) ?? new Set();
    activeIds.add(entry.record.id);
    this.activeSourceTaskIdsById.set(sourceId, activeIds);
    const domainKey = this.sourceDomainKey(entry);
    if (domainKey) {
      const domainActiveIds =
        this.activeSourceTaskIdsByDomain.get(domainKey) ?? new Set();
      domainActiveIds.add(entry.record.id);
      this.activeSourceTaskIdsByDomain.set(domainKey, domainActiveIds);
      if (executorId !== "immediate" && !this.assignedDomainExecutor(domainKey)) {
        this.sourceExecutorByDomain.set(domainKey, executorId);
      }
    }
    entry.sourceExecutorId = executorId;
    entry.activeReleased = false;
    if (executorId === "immediate") {
      this.activeImmediateTaskId = entry.record.id;
    } else {
      this.activePoolTaskIdsByExecutor.set(executorId, entry.record.id);
    }
    if (isBackgroundPriority(entry.record.priority)) {
      this.activeBackgroundCount += 1;
    }
    this.start(entry);
  }

  private pickSourceTask(
    predicate: (entry: TaskEntry) => boolean,
    options: {
      allowPaused?: boolean;
      allowActiveSource?: boolean;
    } = {},
  ): TaskEntry | null {
    const candidates: TaskEntry[] = [];
    for (const queue of this.sourceQueues.values()) {
      let sourceCandidate: TaskEntry | null = null;
      for (const id of queue) {
        const entry = this.entries.get(id);
        if (!entry || entry.record.status !== "queued" || !entry.record.source) {
          continue;
        }
        if (!this.canStartSourceTask(entry, options)) continue;
        if (!options.allowPaused && this.isSourceTaskPaused(entry)) continue;
        const cooldownDelay = this.sourceCooldownDelay(entry);
        if (cooldownDelay > 0) {
          this.scheduleSourceCooldownDrain(
            entry.spec.sourceCooldownKey!,
            cooldownDelay,
          );
          continue;
        }
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

  private isSourceTaskPaused(entry: TaskEntry): boolean {
    const sourceId = entry.record.source?.id;
    return (
      this.sourceQueuesPaused ||
      (sourceId !== undefined && this.pausedSourceIds.has(sourceId))
    );
  }

  private sourceDomainKey(entry: TaskEntry): string | null {
    return sourceBaseDomainKey(entry.record.source?.site);
  }

  private sourceFairnessKey(entry: TaskEntry): string | null {
    return this.sourceDomainKey(entry) ?? entry.record.source?.id ?? null;
  }

  private canStartSourceTask(
    entry: TaskEntry,
    options: { allowActiveSource?: boolean } = {},
  ): boolean {
    if (options.allowActiveSource) return true;
    const sourceId = entry.record.source?.id;
    if (!sourceId) return true;
    const activeIds = this.activeSourceTaskIdsById.get(sourceId);
    if (activeIds && activeIds.size > 0) return false;
    const domainKey = this.sourceDomainKey(entry);
    if (!domainKey) return true;
    const activeDomainIds = this.activeSourceTaskIdsByDomain.get(domainKey);
    return !activeDomainIds || activeDomainIds.size === 0;
  }

  private compareTaskOrder(a: TaskEntry, b: TaskEntry): number {
    const priority = priorityRank(a.record.priority) - priorityRank(b.record.priority);
    if (priority !== 0) return priority;
    const aFairnessKey = this.sourceFairnessKey(a);
    const bFairnessKey = this.sourceFairnessKey(b);
    const aSourceLastServed = aFairnessKey
      ? this.sourceLastServedAt.get(aFairnessKey) ?? 0
      : 0;
    const bSourceLastServed = bFairnessKey
      ? this.sourceLastServedAt.get(bFairnessKey) ?? 0
      : 0;
    if (aSourceLastServed !== bSourceLastServed) {
      return aSourceLastServed - bSourceLastServed;
    }
    return a.record.createdAt - b.record.createdAt;
  }

  private sourceCooldownDelay(entry: TaskEntry): number {
    const key = entry.spec.sourceCooldownKey;
    if (!key) return 0;
    const until = this.sourceCooldownUntilByKey.get(key);
    if (!until) return 0;

    const delay = until - Date.now();
    if (delay > 0) return delay;

    this.clearSourceCooldown(key);
    return 0;
  }

  private setSourceCooldown(entry: TaskEntry): void {
    const key = entry.spec.sourceCooldownKey;
    const cooldownMs = entry.spec.sourceCooldownMs ?? 0;
    if (!key || cooldownMs <= 0) return;

    const delayMs = Math.max(0, Math.round(cooldownMs));
    const until = Date.now() + delayMs;
    this.clearSourceCooldown(key);
    this.sourceCooldownUntilByKey.set(key, until);
    this.scheduleSourceCooldownDrain(key, delayMs);
  }

  private clearSourceCooldown(key: string): void {
    const timer = this.sourceCooldownTimers.get(key);
    if (timer) clearTimeout(timer);
    this.sourceCooldownTimers.delete(key);
    this.sourceCooldownUntilByKey.delete(key);
  }

  private scheduleSourceCooldownDrain(key: string, delayMs: number): void {
    if (this.sourceCooldownTimers.has(key)) return;
    const timer = setTimeout(() => {
      this.sourceCooldownTimers.delete(key);
      const until = this.sourceCooldownUntilByKey.get(key);
      if (until !== undefined && until <= Date.now()) {
        this.sourceCooldownUntilByKey.delete(key);
      }
      this.drain();
    }, Math.max(0, delayMs));
    if (typeof timer === "object" && "unref" in timer) {
      timer.unref();
    }
    this.sourceCooldownTimers.set(key, timer);
  }

  private start(entry: TaskEntry): void {
    this.setStatus(entry, "running", {
      canCancel: true,
      canRetry: false,
      startedAt: Date.now(),
    });
    this.debug("started", entry);

    const context: TaskRunContext = {
      executor: entry.sourceExecutorId,
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
      .then(() => this.runWithScraperExecutorContext(entry, context))
      .then((value) => {
        if (entry.controller.signal.aborted) {
          this.finishCancelledRunningAfterSettlement(entry);
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
        if (cancelled && entry.record.status === "cancelled") {
          this.finishCancelledRunningAfterSettlement(entry);
          return;
        }
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

  private runWithScraperExecutorContext(
    entry: TaskEntry,
    context: TaskRunContext,
  ): Promise<unknown> {
    if (entry.record.lane !== "source" || !entry.record.source) {
      return entry.spec.run(context);
    }

    const executorId = entry.sourceExecutorId;
    if (!executorId) {
      return Promise.reject(new Error("Source task is missing a scraper executor."));
    }

    return runWithScraperExecutor(
      entry.record.source.id,
      entry.record.id,
      executorId,
      () => entry.spec.run(context),
    );
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

  private cancelRunning(entry: TaskEntry): void {
    this.setStatus(entry, "cancelled", {
      canCancel: false,
      canRetry: true,
      finishedAt: Date.now(),
    });
    entry.reject(new DOMException("Task was cancelled.", "AbortError"));
    if (entry.record.lane === "main") {
      this.releaseActive(entry);
      this.trimHistory();
      this.drain();
    }
  }

  private finishCancelledRunningAfterSettlement(entry: TaskEntry): void {
    if (entry.activeReleased) return;
    this.debug("cancelled task settled", entry);
    this.releaseActive(entry);
    this.trimHistory();
    this.drain();
  }

  private releaseActive(entry: TaskEntry): void {
    if (entry.record.lane === "main") {
      if (this.activeMainTaskId === entry.record.id) this.activeMainTaskId = null;
    } else {
      const sourceId = entry.record.source?.id;
      if (sourceId) {
        const activeIds = this.activeSourceTaskIdsById.get(sourceId);
        activeIds?.delete(entry.record.id);
        if (activeIds?.size === 0) {
          this.activeSourceTaskIdsById.delete(sourceId);
        }
      }
      const domainKey = this.sourceDomainKey(entry);
      if (domainKey) {
        const activeDomainIds = this.activeSourceTaskIdsByDomain.get(domainKey);
        activeDomainIds?.delete(entry.record.id);
        const hasActiveDomain = (activeDomainIds?.size ?? 0) > 0;
        if (!hasActiveDomain) {
          this.activeSourceTaskIdsByDomain.delete(domainKey);
          if (!this.hasQueuedSourceDomain(domainKey)) {
            this.sourceExecutorByDomain.delete(domainKey);
          }
        }
      }
      const fairnessKey = this.sourceFairnessKey(entry);
      if (fairnessKey) {
        this.sourceLastServedAt.set(fairnessKey, Date.now());
      }
      if (entry.sourceExecutorId === "immediate") {
        if (this.activeImmediateTaskId === entry.record.id) {
          this.activeImmediateTaskId = null;
        }
      } else if (entry.sourceExecutorId) {
        if (this.activePoolTaskIdsByExecutor.get(entry.sourceExecutorId) === entry.record.id) {
          this.activePoolTaskIdsByExecutor.delete(entry.sourceExecutorId);
        }
      }
      if (isBackgroundPriority(entry.record.priority)) {
        this.activeBackgroundCount = Math.max(
          0,
          this.activeBackgroundCount - 1,
        );
      }
      entry.sourceExecutorId = undefined;
      entry.activeReleased = true;
      this.setSourceCooldown(entry);
    }

    if (
      entry.dedupeKey &&
      this.activeDedupeByKey.get(entry.dedupeKey) === entry.record.id
    ) {
      this.activeDedupeByKey.delete(entry.dedupeKey);
    }
    this.scheduleTerminalCleanup(entry);
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
    if (!entry.activeReleased) return;

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
