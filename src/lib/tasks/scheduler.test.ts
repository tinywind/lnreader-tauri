import { describe, expect, it, vi } from "vitest";
import { TaskScheduler, type TaskRunContext } from "./scheduler";

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

describe("TaskScheduler", () => {
  it("runs main and source tasks independently", async () => {
    const scheduler = new TaskScheduler({
      sourceForegroundConcurrency: 1,
      sourceQueuesPaused: false,
    });
    const order: string[] = [];

    const main = scheduler.enqueueMain({
      kind: "backup.export",
      title: "Export backup",
      run: async () => {
        order.push("main");
      },
    });
    const source = scheduler.enqueueSource({
      kind: "source.search",
      title: "Search source",
      priority: "interactive",
      source: { id: "p", name: "Plugin" },
      run: async () => {
        order.push("source");
      },
    });

    await Promise.all([main.promise, source.promise]);

    expect(order).toEqual(expect.arrayContaining(["main", "source"]));
    expect(scheduler.getSnapshot().running).toBe(0);
  });

  it("caps pool source work at the configured executor count", async () => {
    const scheduler = new TaskScheduler({
      sourceForegroundConcurrency: 2,
      sourceQueuesPaused: false,
    });
    const order: string[] = [];
    const finishers: Array<() => void> = [];

    const tasks = ["a", "b", "c"].map((sourceId) =>
      scheduler.enqueueSource({
        kind: "source.globalSearch",
        title: `Search ${sourceId}`,
        priority: "normal",
        source: { id: sourceId, name: sourceId },
        run: (context) =>
          new Promise<void>((resolve) => {
            order.push(`${sourceId}:${context.executor}:start`);
            finishers.push(resolve);
          }),
      }),
    );

    await settle();
    expect(order).toEqual([
      "a:pool:0:start",
      "b:pool:1:start",
    ]);

    finishers[0]?.();
    await tasks[0]!.promise;
    await settle();

    expect(order).toEqual([
      "a:pool:0:start",
      "b:pool:1:start",
      "c:pool:0:start",
    ]);

    finishers[1]?.();
    finishers[2]?.();
    await Promise.all(tasks.map((task) => task.promise));
  });

  it("keeps one active task per source even when later work has higher priority", async () => {
    const scheduler = new TaskScheduler({
      sourceForegroundConcurrency: 2,
      sourceQueuesPaused: false,
    });
    const order: string[] = [];
    let finishActive!: () => void;

    const active = scheduler.enqueueSource({
      kind: "source.globalSearch",
      title: "Active search",
      priority: "normal",
      source: { id: "p", name: "Plugin" },
      run: () =>
        new Promise<void>((resolve) => {
          order.push("active:start");
          finishActive = resolve;
        }),
    });

    await settle();

    const user = scheduler.enqueueSource({
      kind: "chapter.download",
      title: "User download",
      priority: "user",
      source: { id: "p", name: "Plugin" },
      run: async () => {
        order.push("user:start");
      },
    });

    await settle();
    expect(order).toEqual(["active:start"]);

    finishActive();
    await Promise.all([active.promise, user.promise]);

    expect(order).toEqual(["active:start", "user:start"]);
  });

  it("reserves the immediate executor for open site work without blocking the pool", async () => {
    const scheduler = new TaskScheduler({
      sourceForegroundConcurrency: 1,
      sourceQueuesPaused: false,
    });
    const order: string[] = [];
    let closeSite!: () => void;
    let finishPool!: () => void;

    const pool = scheduler.enqueueSource({
      kind: "source.globalSearch",
      title: "Pool work",
      priority: "normal",
      source: { id: "a", name: "Source A" },
      run: (context) =>
        new Promise<void>((resolve) => {
          order.push(`pool:${context.executor}:start`);
          finishPool = resolve;
        }),
    });

    await settle();

    const site = scheduler.enqueueSource({
      kind: "source.openSite",
      title: "Open site",
      priority: "interactive",
      exclusive: true,
      source: { id: "site", name: "Site" },
      run: (context) =>
        new Promise<void>((resolve) => {
          order.push(`site:${context.executor}:start`);
          closeSite = resolve;
        }),
    });

    await settle();
    expect(order).toEqual(["pool:pool:0:start", "site:immediate:start"]);

    closeSite();
    finishPool();
    await Promise.all([site.promise, pool.promise]);
  });

  it("lets open site work run while source queues are paused", async () => {
    const scheduler = new TaskScheduler({ sourceQueuesPaused: true });
    const order: string[] = [];

    const search = scheduler.enqueueSource({
      kind: "source.search",
      title: "Paused search",
      priority: "interactive",
      source: { id: "p", name: "Plugin" },
      run: async () => {
        order.push("search:start");
      },
    });
    const site = scheduler.enqueueSource({
      kind: "source.openSite",
      title: "Open site",
      priority: "interactive",
      exclusive: true,
      source: { id: "p", name: "Plugin" },
      run: async (context) => {
        order.push(`site:${context.executor}:start`);
      },
    });

    await site.promise;
    await settle();

    expect(order).toEqual(["site:immediate:start"]);
    expect(scheduler.getTask(search.id)?.status).toBe("queued");
  });

  it("limits background work inside the shared pool", async () => {
    const scheduler = new TaskScheduler({
      sourceBackgroundConcurrency: 1,
      sourceForegroundConcurrency: 3,
      sourceQueuesPaused: false,
    });
    const order: string[] = [];
    let finishBackground!: () => void;

    const firstBackground = scheduler.enqueueSource({
      kind: "chapter.download",
      title: "Background A",
      priority: "background",
      source: { id: "a", name: "A" },
      run: () =>
        new Promise<void>((resolve) => {
          order.push("background-a:start");
          finishBackground = resolve;
        }),
    });
    const secondBackground = scheduler.enqueueSource({
      kind: "chapter.download",
      title: "Background B",
      priority: "background",
      source: { id: "b", name: "B" },
      run: async () => {
        order.push("background-b:start");
      },
    });
    const foreground = scheduler.enqueueSource({
      kind: "source.globalSearch",
      title: "Foreground C",
      priority: "normal",
      source: { id: "c", name: "C" },
      run: async () => {
        order.push("foreground-c:start");
      },
    });

    await foreground.promise;
    await settle();

    expect(order).toEqual(["background-a:start", "foreground-c:start"]);

    finishBackground();
    await Promise.all([firstBackground.promise, secondBackground.promise]);

    expect(order).toEqual([
      "background-a:start",
      "foreground-c:start",
      "background-b:start",
    ]);
  });

  it("delays tasks with a matching source cooldown", async () => {
    vi.useFakeTimers();
    try {
      const scheduler = new TaskScheduler({
        sourceForegroundConcurrency: 1,
        sourceQueuesPaused: false,
      });
      const order: string[] = [];
      const cooldownKey = "source:p";

      const first = scheduler.enqueueSource({
        kind: "chapter.download",
        title: "First",
        priority: "background",
        source: { id: "p", name: "Plugin" },
        sourceCooldownKey: cooldownKey,
        sourceCooldownMs: 1_000,
        run: async () => {
          order.push("first:start");
        },
      });
      await first.promise;

      const second = scheduler.enqueueSource({
        kind: "source.globalSearch",
        title: "Second",
        priority: "user",
        source: { id: "p", name: "Plugin" },
        sourceCooldownKey: cooldownKey,
        run: async () => {
          order.push("second:start");
        },
      });

      await settle();
      expect(order).toEqual(["first:start"]);

      vi.advanceTimersByTime(999);
      await settle();
      expect(order).toEqual(["first:start"]);

      vi.advanceTimersByTime(1);
      await second.promise;

      expect(order).toEqual(["first:start", "second:start"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not reuse a cancelled running executor until the work settles", async () => {
    const scheduler = new TaskScheduler({
      sourceForegroundConcurrency: 1,
      sourceQueuesPaused: false,
    });
    const order: string[] = [];
    let settleCancelled!: () => void;

    const cancelled = scheduler.enqueueSource({
      kind: "source.search",
      title: "Cancelled",
      priority: "normal",
      source: { id: "a", name: "A" },
      run: () =>
        new Promise<void>((resolve) => {
          order.push("cancelled:start");
          settleCancelled = resolve;
        }),
    });

    await settle();
    expect(scheduler.cancel(cancelled.id)).toBe(true);
    await expect(cancelled.promise).rejects.toThrow("Task was cancelled.");

    const next = scheduler.enqueueSource({
      kind: "source.search",
      title: "Next",
      priority: "normal",
      source: { id: "b", name: "B" },
      run: async () => {
        order.push("next:start");
      },
    });

    await settle();
    expect(order).toEqual(["cancelled:start"]);

    settleCancelled();
    await next.promise;

    expect(order).toEqual(["cancelled:start", "next:start"]);
  });

  it("passes the assigned scraper executor through the task context", async () => {
    const scheduler = new TaskScheduler({
      sourceForegroundConcurrency: 1,
      sourceQueuesPaused: false,
    });
    let executor: TaskRunContext["executor"];

    const task = scheduler.enqueueSource({
      kind: "source.search",
      title: "Search",
      priority: "normal",
      source: { id: "p", name: "Plugin" },
      run: async (context) => {
        executor = context.executor;
      },
    });

    await task.promise;

    expect(executor).toBe("pool:0");
  });
});
