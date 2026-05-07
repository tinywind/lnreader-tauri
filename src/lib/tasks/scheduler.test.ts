import { describe, expect, it } from "vitest";
import { TaskScheduler } from "./scheduler";

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

describe("TaskScheduler", () => {
  it("runs main and source tasks independently", async () => {
    const scheduler = new TaskScheduler({
      sourceBackgroundConcurrency: 1,
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

  it("lets the current background download finish before foreground source work", async () => {
    const scheduler = new TaskScheduler({
      sourceBackgroundConcurrency: 1,
      sourceForegroundConcurrency: 1,
      sourceQueuesPaused: false,
    });
    const order: string[] = [];
    let finishFirstDownload!: () => void;

    const firstDownload = scheduler.enqueueSource({
      kind: "chapter.download",
      title: "Download 1",
      priority: "background",
      source: { id: "p", name: "Plugin" },
      run: () =>
        new Promise<void>((resolve) => {
          order.push("download-1:start");
          finishFirstDownload = () => {
            order.push("download-1:finish");
            resolve();
          };
        }),
    });

    await settle();

    const secondDownload = scheduler.enqueueSource({
      kind: "chapter.download",
      title: "Download 2",
      priority: "background",
      source: { id: "p", name: "Plugin" },
      run: async () => {
        order.push("download-2:start");
      },
    });
    const foreground = scheduler.enqueueSource({
      kind: "source.search",
      title: "Search source",
      priority: "interactive",
      source: { id: "p", name: "Plugin" },
      run: async () => {
        order.push("foreground:start");
      },
    });

    finishFirstDownload();
    await Promise.all([
      firstDownload.promise,
      foreground.promise,
      secondDownload.promise,
    ]);

    expect(order).toEqual([
      "download-1:start",
      "download-1:finish",
      "foreground:start",
      "download-2:start",
    ]);
  });

  it("blocks background downloads for any source while foreground source work is queued", async () => {
    const scheduler = new TaskScheduler({
      sourceBackgroundConcurrency: 1,
      sourceForegroundConcurrency: 1,
      sourceQueuesPaused: false,
    });
    const order: string[] = [];
    let finishActiveDownload!: () => void;

    const activeDownload = scheduler.enqueueSource({
      kind: "chapter.download",
      title: "Download active",
      priority: "background",
      source: { id: "a", name: "Source A" },
      run: () =>
        new Promise<void>((resolve) => {
          order.push("download-a:start");
          finishActiveDownload = resolve;
        }),
    });

    await settle();

    const foreground = scheduler.enqueueSource({
      kind: "source.search",
      title: "Search source A",
      priority: "interactive",
      source: { id: "a", name: "Source A" },
      run: async () => {
        order.push("foreground-a:start");
      },
    });
    const otherDownload = scheduler.enqueueSource({
      kind: "chapter.download",
      title: "Download other source",
      priority: "background",
      source: { id: "b", name: "Source B" },
      run: async () => {
        order.push("download-b:start");
      },
    });

    await settle();
    expect(order).toEqual(["download-a:start"]);

    finishActiveDownload();
    await Promise.all([
      activeDownload.promise,
      foreground.promise,
      otherDownload.promise,
    ]);

    expect(order).toEqual([
      "download-a:start",
      "foreground-a:start",
      "download-b:start",
    ]);
  });

  it("keeps exclusive source tasks ahead of other foreground source work", async () => {
    const scheduler = new TaskScheduler({
      sourceForegroundConcurrency: 3,
      sourceQueuesPaused: false,
    });
    const order: string[] = [];
    let closeSite!: () => void;

    const site = scheduler.enqueueSource({
      kind: "source.openSite",
      title: "Open site",
      priority: "interactive",
      exclusive: true,
      source: { id: "site", name: "Site Source" },
      run: () =>
        new Promise<void>((resolve) => {
          order.push("site:start");
          closeSite = resolve;
        }),
    });

    await settle();

    const firstSearch = scheduler.enqueueSource({
      kind: "source.search",
      title: "Search A",
      priority: "interactive",
      source: { id: "a", name: "Source A" },
      run: async () => {
        order.push("search-a:start");
      },
    });
    const secondSearch = scheduler.enqueueSource({
      kind: "source.search",
      title: "Search B",
      priority: "interactive",
      source: { id: "b", name: "Source B" },
      run: async () => {
        order.push("search-b:start");
      },
    });

    await settle();
    expect(order).toEqual(["site:start"]);

    closeSite();
    await Promise.all([site.promise, firstSearch.promise, secondSearch.promise]);

    expect(order).toEqual([
      "site:start",
      "search-a:start",
      "search-b:start",
    ]);
  });

  it("cancels queued source tasks and retries them as new work", async () => {
    const scheduler = new TaskScheduler({
      sourceForegroundConcurrency: 1,
      sourceQueuesPaused: false,
    });
    const order: string[] = [];
    let finishActiveTask!: () => void;

    const active = scheduler.enqueueSource({
      kind: "source.search",
      title: "Active search",
      priority: "interactive",
      source: { id: "p", name: "Plugin" },
      run: () =>
        new Promise<void>((resolve) => {
          order.push("active:start");
          finishActiveTask = resolve;
        }),
    });
    const queued = scheduler.enqueueSource({
      kind: "source.search",
      title: "Queued search",
      priority: "interactive",
      source: { id: "q", name: "Other Plugin" },
      run: async () => {
        order.push("queued:start");
      },
    });

    await settle();
    expect(scheduler.cancel(queued.id)).toBe(true);
    await expect(queued.promise).rejects.toThrow("Task was cancelled.");
    expect(scheduler.getTask(queued.id)?.canRetry).toBe(true);

    const retry = scheduler.retry(queued.id);
    expect(retry).not.toBeNull();
    expect(retry?.id).not.toBe(queued.id);

    await settle();
    expect(order).toEqual(["active:start"]);

    finishActiveTask();
    await Promise.all([active.promise, retry!.promise]);

    expect(order).toEqual(["active:start", "queued:start"]);
  });

  it("starts with source queues paused until all source queues are resumed", async () => {
    const scheduler = new TaskScheduler();
    const order: string[] = [];

    const main = scheduler.enqueueMain({
      kind: "backup.export",
      title: "Export backup",
      run: async () => {
        order.push("main:start");
      },
    });
    const source = scheduler.enqueueSource({
      kind: "source.search",
      title: "Search source",
      priority: "interactive",
      source: { id: "p", name: "Plugin" },
      run: async () => {
        order.push("source:start");
      },
    });

    await main.promise;
    await settle();

    expect(order).toEqual(["main:start"]);
    expect(scheduler.getTask(source.id)?.status).toBe("queued");
    expect(scheduler.getSnapshot().sourceQueuesPaused).toBe(true);

    expect(scheduler.resumeSourceQueue()).toBe(true);
    await source.promise;

    expect(order).toEqual(["main:start", "source:start"]);
    expect(scheduler.getSnapshot().sourceQueuesPaused).toBe(false);
  });

  it("pauses and resumes one source queue without pausing other sources", async () => {
    const scheduler = new TaskScheduler({
      sourceBackgroundConcurrency: 1,
      sourceQueuesPaused: false,
    });
    const order: string[] = [];
    let finishOtherDownload!: () => void;

    expect(scheduler.pauseSourceQueue("a")).toBe(true);
    const pausedSourceDownload = scheduler.enqueueSource({
      kind: "chapter.download",
      title: "Download paused source",
      priority: "background",
      source: { id: "a", name: "Source A" },
      run: async () => {
        order.push("download-a:start");
      },
    });
    const otherSourceDownload = scheduler.enqueueSource({
      kind: "chapter.download",
      title: "Download other source",
      priority: "background",
      source: { id: "b", name: "Source B" },
      run: () =>
        new Promise<void>((resolve) => {
          order.push("download-b:start");
          finishOtherDownload = resolve;
        }),
    });

    await settle();

    expect(order).toEqual(["download-b:start"]);
    expect(scheduler.getTask(pausedSourceDownload.id)?.status).toBe("queued");
    expect(scheduler.getSnapshot().pausedSourceIds).toEqual(["a"]);

    finishOtherDownload();
    await otherSourceDownload.promise;
    await settle();
    expect(order).toEqual(["download-b:start"]);

    expect(scheduler.resumeSourceQueue("a")).toBe(true);
    await pausedSourceDownload.promise;

    expect(order).toEqual(["download-b:start", "download-a:start"]);
    expect(scheduler.getSnapshot().pausedSourceIds).toEqual([]);
  });

  it("resumes all source queues and clears per-source pauses", async () => {
    const scheduler = new TaskScheduler({ sourceQueuesPaused: false });

    expect(scheduler.pauseSourceQueue("a")).toBe(true);
    expect(scheduler.pauseSourceQueue()).toBe(true);
    expect(scheduler.getSnapshot().pausedSourceIds).toEqual(["a"]);
    expect(scheduler.getSnapshot().sourceQueuesPaused).toBe(true);

    expect(scheduler.resumeSourceQueue()).toBe(true);

    expect(scheduler.getSnapshot().pausedSourceIds).toEqual([]);
    expect(scheduler.getSnapshot().sourceQueuesPaused).toBe(false);
  });

  it("deduplicates active tasks by key", async () => {
    const scheduler = new TaskScheduler({ sourceQueuesPaused: false });
    let finish!: () => void;
    const first = scheduler.enqueueSource({
      kind: "chapter.download",
      title: "Download",
      priority: "background",
      source: { id: "p", name: "Plugin" },
      dedupeKey: "chapter.download:1",
      run: () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    });

    const second = scheduler.enqueueSource({
      kind: "chapter.download",
      title: "Download duplicate",
      priority: "background",
      source: { id: "p", name: "Plugin" },
      dedupeKey: "chapter.download:1",
      run: async () => {
        throw new Error("duplicate should not run");
      },
    });

    expect(second.id).toBe(first.id);
    finish();
    await Promise.all([first.promise, second.promise]);
  });
});
