import type { PluginManager } from "./manager";
import type { NovelItem, Plugin } from "./types";
import { enqueueSourceTask } from "../tasks/source-tasks";

export interface GlobalSearchResult {
  pluginId: string;
  pluginName: string;
  novels: NovelItem[];
  error?: string;
}

export interface GlobalSearchOptions {
  /** Default 3, mirrors upstream's `globalSearchConcurrency`. */
  concurrency?: number;
  plugins?: readonly Plugin[];
  /** When the signal aborts, no further results are yielded. */
  signal?: AbortSignal;
  /** Per-plugin search timeout. Default 30 seconds. */
  timeoutMs?: number;
  /** Called as each plugin's task settles. */
  onResult?: (result: GlobalSearchResult) => void;
  taskTitle?: (plugin: Plugin) => string;
}

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_TIMEOUT_MS = 30_000;

function normalizeTimeoutMs(value: unknown): number {
  const numeric = typeof value === "number" ? value : DEFAULT_TIMEOUT_MS;
  if (!Number.isFinite(numeric)) return DEFAULT_TIMEOUT_MS;
  return Math.max(1, Math.round(numeric));
}

function formatTimeoutSeconds(timeoutMs: number): string {
  const seconds = timeoutMs / 1000;
  return Number.isInteger(seconds) ? String(seconds) : seconds.toFixed(1);
}

async function withTimeout<T>(
  task: () => Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const promise = task();
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(
        new Error(
          `Search timed out after ${formatTimeoutSeconds(timeoutMs)} seconds.`,
        ),
      );
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

/**
 * Tiny in-process semaphore. Each task is a thunk returning a
 * promise; runs at most `concurrency` at a time. Inline so we
 * don't pull in a 30-line npm dep for what's effectively a queue.
 */
function makeLimiter(concurrency: number) {
  let active = 0;
  const queue: Array<() => void> = [];
  const drain = () => {
    while (active < concurrency && queue.length > 0) {
      const next = queue.shift();
      if (next) {
        active += 1;
        next();
      }
    }
  };
  return <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active -= 1;
            drain();
          });
      });
      drain();
    });
}

/**
 * Fan a single search query across every installed plugin with a
 * bounded concurrency. Returns the per-plugin result list once
 * every task has settled.
 *
 * If the {@link AbortSignal} fires, in-flight plugin tasks still
 * finish (their internal HTTP requests aren't auto-aborted by the
 * upstream plugin contract), but their results are discarded and
 * no further plugin tasks are started. The per-plugin timeout keeps
 * stalled plugins from blocking the full search result set.
 */
export async function globalSearch(
  manager: PluginManager,
  term: string,
  options: GlobalSearchOptions = {},
): Promise<GlobalSearchResult[]> {
  const plugins = options.plugins ?? manager.list();
  if (plugins.length === 0) return [];

  const concurrency = Math.max(
    1,
    options.concurrency ?? DEFAULT_CONCURRENCY,
  );
  const limit = makeLimiter(concurrency);
  const { signal, onResult } = options;
  const timeoutMs = normalizeTimeoutMs(options.timeoutMs);
  const collected: GlobalSearchResult[] = [];

  const tasks = plugins.map((plugin) =>
    limit(async () => {
      if (signal?.aborted) return;
      let result: GlobalSearchResult;
      try {
        const novels = await enqueueSourceTask<NovelItem[]>({
          plugin,
          kind: "source.globalSearch",
          priority: "interactive",
          title: options.taskTitle?.(plugin) ?? plugin.name,
          subject: { path: term },
          dedupeKey: `source.globalSearch:${plugin.id}:${term}`,
          run: () => withTimeout(() => plugin.searchNovels(term, 1), timeoutMs),
        }).promise;
        result = {
          pluginId: plugin.id,
          pluginName: plugin.name,
          novels,
        };
      } catch (error) {
        result = {
          pluginId: plugin.id,
          pluginName: plugin.name,
          novels: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
      if (signal?.aborted) return;
      collected.push(result);
      onResult?.(result);
    }),
  );

  await Promise.all(tasks);
  return collected;
}
