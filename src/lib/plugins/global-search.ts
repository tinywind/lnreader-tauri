import type { PluginManager } from "./manager";
import type { NovelItem, Plugin } from "./types";

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
  /** Called as each plugin's task settles. */
  onResult?: (result: GlobalSearchResult) => void;
}

const DEFAULT_CONCURRENCY = 3;

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
 * no further plugin tasks are started. The promise resolves once
 * the in-flight tasks complete.
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
  const collected: GlobalSearchResult[] = [];

  const tasks = plugins.map((plugin) =>
    limit(async () => {
      if (signal?.aborted) return;
      let result: GlobalSearchResult;
      try {
        const novels = await plugin.searchNovels(term, 1);
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
