import { describe, expect, it, vi } from "vitest";
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

  it("orders queued main work by priority", async () => {
    const scheduler = new TaskScheduler();
    const order: string[] = [];
    let finishActive!: () => void;

    const active = scheduler.enqueueMain({
      kind: "backup.export",
      title: "Active main task",
      priority: "normal",
      run: () =>
        new Promise<void>((resolve) => {
          order.push("active:start");
          finishActive = resolve;
        }),
    });

    await settle();

    const deferred = scheduler.enqueueMain({
      kind: "library.refreshMetadata",
      title: "Refresh metadata",
      priority: "deferred",
      run: async () => {
        order.push("deferred:start");
      },
    });
    const normal = scheduler.enqueueMain({
      kind: "repository.refreshIndex",
      title: "Refresh repository",
      priority: "normal",
      run: async () => {
        order.push("normal:start");
      },
    });

    await settle();
    expect(order).toEqual(["active:start"]);

    finishActive();
    await Promise.all([active.promise, deferred.promise, normal.promise]);

    expect(order).toEqual([
      "active:start",
      "normal:start",
      "deferred:start",
    ]);
  });

  it("runs foreground source work alongside lower-priority background work", async () => {
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

    await foreground.promise;
    await settle();
    expect(order).toEqual(["download-1:start", "foreground:start"]);

    finishFirstDownload();
    await Promise.all([
      firstDownload.promise,
      secondDownload.promise,
    ]);

    expect(order).toEqual([
      "download-1:start",
      "foreground:start",
      "download-1:finish",
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
    expect(order).toEqual(["download-a:start", "foreground-a:start"]);

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

  it("uses priority boost slots for interactive source work", async () => {
    const scheduler = new TaskScheduler({
      sourceForegroundConcurrency: 2,
      sourceQueuesPaused: false,
    });
    const order: string[] = [];
    let finishFirstSearch!: () => void;
    let finishSecondSearch!: () => void;
    let finishInteractive!: () => void;

    const firstSearch = scheduler.enqueueSource({
      kind: "source.globalSearch",
      title: "Global search A",
      priority: "normal",
      source: { id: "a", name: "Source A" },
      run: () =>
        new Promise<void>((resolve) => {
          order.push("normal-a:start");
          finishFirstSearch = resolve;
        }),
    });
    const secondSearch = scheduler.enqueueSource({
      kind: "source.globalSearch",
      title: "Global search B",
      priority: "normal",
      source: { id: "b", name: "Source B" },
      run: () =>
        new Promise<void>((resolve) => {
          order.push("normal-b:start");
          finishSecondSearch = resolve;
        }),
    });

    await settle();

    const interactive = scheduler.enqueueSource({
      kind: "source.openNovel",
      title: "Open novel",
      priority: "interactive",
      source: { id: "ui", name: "UI Source" },
      run: () =>
        new Promise<void>((resolve) => {
          order.push("interactive:start");
          finishInteractive = resolve;
        }),
    });

    await settle();
    expect(order).toEqual([
      "normal-a:start",
      "normal-b:start",
      "interactive:start",
    ]);

    const blockedSearch = scheduler.enqueueSource({
      kind: "source.globalSearch",
      title: "Global search C",
      priority: "normal",
      source: { id: "c", name: "Source C" },
      run: async () => {
        order.push("normal-c:start");
      },
    });

    await settle();
    expect(order).toEqual([
      "normal-a:start",
      "normal-b:start",
      "interactive:start",
    ]);

    finishInteractive();
    await interactive.promise;
    await settle();
    expect(order).toEqual([
      "normal-a:start",
      "normal-b:start",
      "interactive:start",
    ]);

    finishFirstSearch();
    await Promise.all([firstSearch.promise, blockedSearch.promise]);
    finishSecondSearch();
    await secondSearch.promise;

    expect(order).toEqual([
      "normal-a:start",
      "normal-b:start",
      "interactive:start",
      "normal-c:start",
    ]);
  });

  it("boosts interactive work past lower-priority same-source work", async () => {
    const scheduler = new TaskScheduler({
      sourceForegroundConcurrency: 1,
      sourceQueuesPaused: false,
    });
    const order: string[] = [];
    let finishSearch!: () => void;

    const search = scheduler.enqueueSource({
      kind: "source.globalSearch",
      title: "Global search",
      priority: "normal",
      source: { id: "p", name: "Plugin" },
      run: () =>
        new Promise<void>((resolve) => {
          order.push("search:start");
          finishSearch = resolve;
        }),
    });

    await settle();

    const openNovel = scheduler.enqueueSource({
      kind: "source.openNovel",
      title: "Open novel",
      priority: "interactive",
      source: { id: "p", name: "Plugin" },
      run: async () => {
        order.push("open:start");
      },
    });

    await openNovel.promise;
    await settle();

    expect(order).toEqual(["search:start", "open:start"]);

    finishSearch();
    await search.promise;
  });

  it("uses priority boost slots for user priority work", async () => {
    const scheduler = new TaskScheduler({
      sourceForegroundConcurrency: 1,
      sourceQueuesPaused: false,
    });
    const order: string[] = [];
    let finishActive!: () => void;

    const active = scheduler.enqueueSource({
      kind: "source.globalSearch",
      title: "Global search",
      priority: "normal",
      source: { id: "p", name: "Plugin" },
      run: () =>
        new Promise<void>((resolve) => {
          order.push("normal:start");
          finishActive = resolve;
        }),
    });

    await settle();

    const userDownload = scheduler.enqueueSource({
      kind: "chapter.download",
      title: "Download chapter",
      priority: "user",
      source: { id: "p", name: "Plugin" },
      run: async () => {
        order.push("user:start");
      },
    });

    await userDownload.promise;
    await settle();
    expect(order).toEqual(["normal:start", "user:start"]);

    finishActive();
    await active.promise;
  });

  it("orders queued source work by the full priority hierarchy", async () => {
    const scheduler = new TaskScheduler({
      sourceForegroundConcurrency: 1,
      sourceQueuesPaused: false,
    });
    const order: string[] = [];
    let finishActiveSearch!: () => void;

    const activeSearch = scheduler.enqueueSource({
      kind: "source.openNovel",
      title: "Active open novel",
      priority: "interactive",
      source: { id: "p", name: "Plugin" },
      run: () =>
        new Promise<void>((resolve) => {
          order.push("active:start");
          finishActiveSearch = resolve;
        }),
    });

    await settle();

    const queuedBackground = scheduler.enqueueSource({
      kind: "chapter.download",
      title: "Batch download",
      priority: "background",
      source: { id: "p", name: "Plugin" },
      run: async () => {
        order.push("background:start");
      },
    });
    const queuedDeferred = scheduler.enqueueSource({
      kind: "source.refreshNovel",
      title: "Refresh metadata",
      priority: "deferred",
      source: { id: "p", name: "Plugin" },
      run: async () => {
        order.push("deferred:start");
      },
    });
    const queuedNormal = scheduler.enqueueSource({
      kind: "source.globalSearch",
      title: "Queued global search",
      priority: "normal",
      source: { id: "p", name: "Plugin" },
      run: async () => {
        order.push("normal:start");
      },
    });
    const queuedUser = scheduler.enqueueSource({
      kind: "chapter.download",
      title: "User download",
      priority: "user",
      source: { id: "p", name: "Plugin" },
      run: async () => {
        order.push("user:start");
      },
    });
    const queuedInteractive = scheduler.enqueueSource({
      kind: "source.openNovel",
      title: "Open novel",
      priority: "interactive",
      source: { id: "p", name: "Plugin" },
      run: async () => {
        order.push("interactive:start");
      },
    });

    await settle();
    expect(order).toEqual(["active:start"]);

    finishActiveSearch();
    await Promise.all([
      activeSearch.promise,
      queuedInteractive.promise,
      queuedUser.promise,
      queuedNormal.promise,
      queuedDeferred.promise,
      queuedBackground.promise,
    ]);

    expect(order).toEqual([
      "active:start",
      "interactive:start",
      "user:start",
      "normal:start",
      "deferred:start",
      "background:start",
    ]);
  });

  it("delays source tasks with a matching source cooldown", async () => {
    vi.useFakeTimers();
    try {
      const scheduler = new TaskScheduler({
        sourceBackgroundConcurrency: 1,
        sourceQueuesPaused: false,
      });
      const order: string[] = [];
      const cooldownKey = "chapter.download:p";

      const firstDownload = scheduler.enqueueSource({
        kind: "chapter.download",
        title: "Download 1",
        priority: "background",
        source: { id: "p", name: "Plugin" },
        sourceCooldownKey: cooldownKey,
        sourceCooldownMs: 1_000,
        run: async () => {
          order.push("download-1:start");
        },
      });
      await firstDownload.promise;

      const secondDownload = scheduler.enqueueSource({
        kind: "chapter.download",
        title: "Download 2",
        priority: "background",
        source: { id: "p", name: "Plugin" },
        sourceCooldownKey: cooldownKey,
        sourceCooldownMs: 1_000,
        run: async () => {
          order.push("download-2:start");
        },
      });

      await settle();
      expect(order).toEqual(["download-1:start"]);

      vi.advanceTimersByTime(999);
      await settle();
      expect(order).toEqual(["download-1:start"]);

      vi.advanceTimersByTime(1);
      await secondDownload.promise;

      expect(order).toEqual(["download-1:start", "download-2:start"]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets interactive same-source work bypass cooled background downloads", async () => {
    vi.useFakeTimers();
    try {
      const scheduler = new TaskScheduler({
        sourceBackgroundConcurrency: 1,
        sourceForegroundConcurrency: 1,
        sourceQueuesPaused: false,
      });
      const order: string[] = [];
      const cooldownKey = "chapter.download:p";

      const firstDownload = scheduler.enqueueSource({
        kind: "chapter.download",
        title: "Download 1",
        priority: "background",
        source: { id: "p", name: "Plugin" },
        sourceCooldownKey: cooldownKey,
        sourceCooldownMs: 1_000,
        run: async () => {
          order.push("download-1:start");
        },
      });
      await firstDownload.promise;

      const secondDownload = scheduler.enqueueSource({
        kind: "chapter.download",
        title: "Download 2",
        priority: "background",
        source: { id: "p", name: "Plugin" },
        sourceCooldownKey: cooldownKey,
        sourceCooldownMs: 1_000,
        run: async () => {
          order.push("download-2:start");
        },
      });
      const interactive = scheduler.enqueueSource({
        kind: "source.openNovel",
        title: "Open novel",
        priority: "interactive",
        source: { id: "p", name: "Plugin" },
        run: async () => {
          order.push("interactive:start");
        },
      });

      await interactive.promise;
      await settle();

      expect(order).toEqual(["download-1:start", "interactive:start"]);

      vi.advanceTimersByTime(1_000);
      await secondDownload.promise;

      expect(order).toEqual([
        "download-1:start",
        "interactive:start",
        "download-2:start",
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses priority boost slots for exclusive source work", async () => {
    const scheduler = new TaskScheduler({
      sourceForegroundConcurrency: 2,
      sourceQueuesPaused: false,
    });
    const order: string[] = [];
    let finishFirstSearch!: () => void;
    let finishSecondSearch!: () => void;
    let closeSite!: () => void;

    const firstSearch = scheduler.enqueueSource({
      kind: "source.globalSearch",
      title: "Global search A",
      priority: "normal",
      source: { id: "a", name: "Source A" },
      run: () =>
        new Promise<void>((resolve) => {
          order.push("normal-a:start");
          finishFirstSearch = resolve;
        }),
    });
    const secondSearch = scheduler.enqueueSource({
      kind: "source.globalSearch",
      title: "Global search B",
      priority: "normal",
      source: { id: "b", name: "Source B" },
      run: () =>
        new Promise<void>((resolve) => {
          order.push("normal-b:start");
          finishSecondSearch = resolve;
        }),
    });

    await settle();

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
    const blockedSearch = scheduler.enqueueSource({
      kind: "source.globalSearch",
      title: "Global search C",
      priority: "normal",
      source: { id: "c", name: "Source C" },
      run: async () => {
        order.push("normal-c:start");
      },
    });

    await settle();
    expect(order).toEqual(["normal-a:start", "normal-b:start", "site:start"]);

    closeSite();
    await site.promise;
    await settle();
    expect(order).toEqual(["normal-a:start", "normal-b:start", "site:start"]);

    finishFirstSearch();
    await firstSearch.promise;
    await settle();
    expect(order).toEqual([
      "normal-a:start",
      "normal-b:start",
      "site:start",
      "normal-c:start",
    ]);

    finishSecondSearch();
    await Promise.all([secondSearch.promise, blockedSearch.promise]);

    expect(order).toEqual([
      "normal-a:start",
      "normal-b:start",
      "site:start",
      "normal-c:start",
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
      source: { id: "p", name: "Plugin" },
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

  it("cancels running tasks and keeps them cancelled after work settles", async () => {
    const scheduler = new TaskScheduler({ sourceQueuesPaused: false });
    const order: string[] = [];
    let finishRunningTask!: () => void;

    const running = scheduler.enqueueSource({
      kind: "source.search",
      title: "Running source task",
      priority: "interactive",
      source: { id: "p", name: "Plugin" },
      run: () =>
        new Promise<void>((resolve) => {
          order.push("running:start");
          finishRunningTask = resolve;
        }),
    });

    await settle();

    expect(scheduler.getTask(running.id)?.canCancel).toBe(true);
    expect(scheduler.cancel(running.id)).toBe(true);
    await expect(running.promise).rejects.toThrow("Task was cancelled.");
    expect(scheduler.getTask(running.id)?.status).toBe("cancelled");
    expect(scheduler.getTask(running.id)?.canRetry).toBe(true);

    finishRunningTask();
    await settle();

    expect(order).toEqual(["running:start"]);
    expect(scheduler.getTask(running.id)?.status).toBe("cancelled");
  });

  it("runs the latest open site task while all source queues are paused", async () => {
    const scheduler = new TaskScheduler({ sourceQueuesPaused: true });
    const order: string[] = [];

    const first = scheduler.enqueueSource({
      kind: "source.openSite",
      title: "Open first site",
      priority: "interactive",
      exclusive: true,
      source: { id: "a", name: "Source A" },
      dedupeKey: "source.openSite:a:https://a.test",
      subject: { url: "https://a.test" },
      run: () =>
        new Promise<void>(() => {
          order.push("site-1:start");
        }),
    });
    const second = scheduler.enqueueSource({
      kind: "source.openSite",
      title: "Open second site",
      priority: "interactive",
      exclusive: true,
      source: { id: "b", name: "Source B" },
      dedupeKey: "source.openSite:b:https://b.test",
      subject: { url: "https://b.test" },
      run: async () => {
        order.push("site-2:start");
      },
    });

    await expect(first.promise).rejects.toThrow("Task was cancelled.");
    await second.promise;

    expect(first.id).not.toBe(second.id);
    expect(scheduler.getTask(first.id)?.status).toBe("cancelled");
    expect(order).toEqual(["site-1:start", "site-2:start"]);
  });

  it("replaces a running open site task with the latest request", async () => {
    const scheduler = new TaskScheduler({ sourceQueuesPaused: false });
    const order: string[] = [];
    let closeSecondSite!: () => void;

    const first = scheduler.enqueueSource({
      kind: "source.openSite",
      title: "Open first site",
      priority: "interactive",
      exclusive: true,
      source: { id: "a", name: "Source A" },
      dedupeKey: "source.openSite:a:https://same.test",
      subject: { url: "https://same.test" },
      run: () =>
        new Promise<void>(() => {
          order.push("site-1:start");
        }),
    });

    await settle();

    const second = scheduler.enqueueSource({
      kind: "source.openSite",
      title: "Open second site",
      priority: "interactive",
      exclusive: true,
      source: { id: "a", name: "Source A" },
      dedupeKey: "source.openSite:a:https://same.test",
      subject: { url: "https://same.test" },
      run: () =>
        new Promise<void>((resolve) => {
          order.push("site-2:start");
          closeSecondSite = resolve;
        }),
    });

    expect(second.id).not.toBe(first.id);
    await expect(first.promise).rejects.toThrow("Task was cancelled.");
    await settle();

    expect(order).toEqual(["site-1:start", "site-2:start"]);
    expect(scheduler.getTask(first.id)?.status).toBe("cancelled");
    expect(scheduler.getTask(second.id)?.status).toBe("running");

    closeSecondSite();
    await second.promise;
  });

  it("starts with source queues running by default", async () => {
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
    await source.promise;

    expect(order).toEqual(["main:start", "source:start"]);
    expect(scheduler.getSnapshot().sourceQueuesPaused).toBe(false);
  });

  it("lets only interactive source tasks run while all source queues are paused", async () => {
    const scheduler = new TaskScheduler({
      sourceBackgroundConcurrency: 1,
      sourceForegroundConcurrency: 1,
      sourceQueuesPaused: false,
    });
    const order: string[] = [];

    expect(scheduler.pauseSourceQueue()).toBe(true);
    const download = scheduler.enqueueSource({
      kind: "chapter.download",
      title: "Paused download",
      priority: "background",
      source: { id: "p", name: "Plugin" },
      run: async () => {
        order.push("download:start");
      },
    });
    const userDownload = scheduler.enqueueSource({
      kind: "chapter.download",
      title: "User download",
      priority: "user",
      source: { id: "q", name: "Other Plugin" },
      run: async () => {
        order.push("user:start");
      },
    });
    const openNovel = scheduler.enqueueSource({
      kind: "source.openNovel",
      title: "Open novel",
      priority: "interactive",
      source: { id: "r", name: "Reader Plugin" },
      run: async () => {
        order.push("open:start");
      },
    });

    await openNovel.promise;
    await settle();

    expect(order).toEqual(["open:start"]);
    expect(scheduler.getTask(download.id)?.status).toBe("queued");
    expect(scheduler.getTask(userDownload.id)?.status).toBe("queued");

    expect(scheduler.resumeSourceQueue()).toBe(true);
    await Promise.all([userDownload.promise, download.promise]);

    expect(order).toEqual(["open:start", "user:start", "download:start"]);
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

  it("lets interactive same-source work bypass a paused source queue", async () => {
    const scheduler = new TaskScheduler({
      sourceBackgroundConcurrency: 1,
      sourceForegroundConcurrency: 1,
      sourceQueuesPaused: false,
    });
    const order: string[] = [];

    expect(scheduler.pauseSourceQueue("a")).toBe(true);
    const download = scheduler.enqueueSource({
      kind: "chapter.download",
      title: "Paused download",
      priority: "background",
      source: { id: "a", name: "Source A" },
      run: async () => {
        order.push("download:start");
      },
    });
    const openNovel = scheduler.enqueueSource({
      kind: "source.openNovel",
      title: "Open novel",
      priority: "interactive",
      source: { id: "a", name: "Source A" },
      run: async () => {
        order.push("open:start");
      },
    });

    await openNovel.promise;
    await settle();

    expect(order).toEqual(["open:start"]);
    expect(scheduler.getTask(download.id)?.status).toBe("queued");

    expect(scheduler.resumeSourceQueue("a")).toBe(true);
    await download.promise;

    expect(order).toEqual(["open:start", "download:start"]);
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
    await settle();
    finish();
    await Promise.all([first.promise, second.promise]);
  });

  it("upgrades queued deduplicated work to the higher requested priority", async () => {
    const scheduler = new TaskScheduler({
      sourceForegroundConcurrency: 1,
      sourceQueuesPaused: false,
    });
    const order: string[] = [];
    let finishActive!: () => void;

    const active = scheduler.enqueueSource({
      kind: "source.search",
      title: "Active search",
      priority: "interactive",
      source: { id: "p", name: "Plugin" },
      run: () =>
        new Promise<void>((resolve) => {
          order.push("active:start");
          finishActive = resolve;
        }),
    });

    await settle();

    const first = scheduler.enqueueSource({
      kind: "chapter.download",
      title: "Batch download",
      priority: "background",
      source: { id: "p", name: "Plugin" },
      dedupeKey: "chapter.download:1",
      run: async () => {
        order.push("download:start");
      },
    });
    const second = scheduler.enqueueSource({
      kind: "chapter.download",
      title: "User download",
      priority: "user",
      source: { id: "p", name: "Plugin" },
      dedupeKey: "chapter.download:1",
      run: async () => {
        throw new Error("duplicate should not run");
      },
    });

    expect(second.id).toBe(first.id);
    expect(scheduler.getTask(first.id)?.priority).toBe("user");
    await settle();
    expect(order).toEqual(["active:start"]);

    finishActive();
    await Promise.all([active.promise, first.promise, second.promise]);

    expect(order).toEqual(["active:start", "download:start"]);
  });

  it("removes succeeded and cancelled tasks after a short retention window", async () => {
    vi.useFakeTimers();
    try {
      const scheduler = new TaskScheduler({
        sourceQueuesPaused: false,
        terminalTaskRetentionMs: 10,
      });

      const succeeded = scheduler.enqueueSource({
        kind: "source.search",
        title: "Finished task",
        priority: "interactive",
        source: { id: "p", name: "Plugin" },
        run: async () => undefined,
      });
      const cancelled = scheduler.enqueueSource({
        kind: "source.search",
        title: "Cancelled task",
        priority: "interactive",
        source: { id: "q", name: "Other Plugin" },
        run: async () => undefined,
      });
      const failed = scheduler.enqueueSource({
        kind: "source.search",
        title: "Failed task",
        priority: "interactive",
        source: { id: "r", name: "Failed Plugin" },
        run: async () => {
          throw new Error("failed");
        },
      });

      expect(scheduler.cancel(cancelled.id)).toBe(true);
      await expect(cancelled.promise).rejects.toThrow("Task was cancelled.");
      await Promise.allSettled([succeeded.promise, failed.promise]);

      expect(scheduler.getTask(succeeded.id)?.status).toBe("succeeded");
      expect(scheduler.getTask(cancelled.id)?.status).toBe("cancelled");
      expect(scheduler.getTask(failed.id)?.status).toBe("failed");

      vi.advanceTimersByTime(10);

      expect(scheduler.getTask(succeeded.id)).toBeUndefined();
      expect(scheduler.getTask(cancelled.id)).toBeUndefined();
      expect(scheduler.getTask(failed.id)?.status).toBe("failed");
    } finally {
      vi.useRealTimers();
    }
  });
});
