export type ScraperExecutorId = "immediate" | `pool:${number}`;

const DEFAULT_SCRAPER_EXECUTOR: ScraperExecutorId = "immediate";

const activeExecutorsBySourceId = new Map<
  string,
  Map<string, ScraperExecutorId>
>();

export function activeScraperExecutor(
  sourceId: string | undefined,
): ScraperExecutorId {
  if (!sourceId) return DEFAULT_SCRAPER_EXECUTOR;
  const active = activeExecutorsBySourceId.get(sourceId);
  if (!active || active.size === 0) return DEFAULT_SCRAPER_EXECUTOR;
  return [...active.values()][active.size - 1] ?? DEFAULT_SCRAPER_EXECUTOR;
}

export async function runWithScraperExecutor<T>(
  sourceId: string,
  taskId: string,
  executorId: ScraperExecutorId,
  run: () => Promise<T>,
): Promise<T> {
  const active = activeExecutorsBySourceId.get(sourceId) ?? new Map();
  active.set(taskId, executorId);
  activeExecutorsBySourceId.set(sourceId, active);

  try {
    return await run();
  } finally {
    active.delete(taskId);
    if (active.size === 0) {
      activeExecutorsBySourceId.delete(sourceId);
    }
  }
}
