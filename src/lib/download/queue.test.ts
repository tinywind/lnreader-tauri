import { beforeEach, describe, expect, it, vi } from "vitest";
import { DownloadQueue, type DownloadEvent } from "./queue";
import { PluginManager } from "../plugins/manager";
import type { Plugin } from "../plugins/types";

function makePlugin(
  id: string,
  parseChapterImpl: (path: string) => Promise<string>,
): Plugin {
  return {
    id,
    name: `Plugin ${id}`,
    site: `https://${id}.test`,
    lang: "en",
    version: "1.0.0",
    url: `https://${id}.test/index.js`,
    iconUrl: `https://${id}.test/icon.png`,
    popularNovels: () => Promise.resolve([]),
    parseNovel: () =>
      Promise.resolve({ name: "", path: "", chapters: [] }),
    parseChapter: parseChapterImpl,
    searchNovels: () => Promise.resolve([]),
  };
}

function makeManager(plugins: Plugin[]): PluginManager {
  const manager = new PluginManager();
  const installed = (
    manager as unknown as { installed: Map<string, Plugin> }
  ).installed;
  for (const plugin of plugins) {
    installed.set(plugin.id, plugin);
  }
  return manager;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

describe("DownloadQueue.enqueue + drain", () => {
  let save: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    save = vi.fn().mockResolvedValue(undefined);
  });

  it("runs a single job to completion (queued → running → done)", async () => {
    const manager = makeManager([
      makePlugin("p", async () => "<p>hi</p>"),
    ]);
    const queue = new DownloadQueue({ manager, save, concurrency: 1 });
    const events: DownloadEvent[] = [];
    queue.subscribe((event) => events.push(event));

    const accepted = queue.enqueue({
      id: 1,
      pluginId: "p",
      chapterPath: "/c/1",
    });
    expect(accepted).toBe(true);

    await settle();

    const kinds = events.map((event) => event.status.kind);
    expect(kinds).toEqual(["queued", "running", "done"]);
    expect(save).toHaveBeenCalledWith(1, "<p>hi</p>");
    expect(queue.status(1)?.kind).toBe("done");
  });

  it("captures plugin errors as failed", async () => {
    const manager = makeManager([
      makePlugin("p", async () => {
        throw new Error("scrape failed");
      }),
    ]);
    const queue = new DownloadQueue({ manager, save, concurrency: 1 });

    queue.enqueue({ id: 7, pluginId: "p", chapterPath: "/c/7" });
    await settle();

    const status = queue.status(7);
    expect(status?.kind).toBe("failed");
    if (status?.kind === "failed") {
      expect(status.error).toBe("scrape failed");
    }
    expect(save).not.toHaveBeenCalled();
  });

  it("fails when the plugin is not installed", async () => {
    const manager = makeManager([]);
    const queue = new DownloadQueue({ manager, save, concurrency: 1 });

    queue.enqueue({ id: 9, pluginId: "missing", chapterPath: "/c/9" });
    await settle();

    const status = queue.status(9);
    expect(status?.kind).toBe("failed");
    if (status?.kind === "failed") {
      expect(status.error).toMatch(/missing/);
    }
  });

  it("respects concurrency=1 (only one running at a time)", async () => {
    let active = 0;
    let maxActive = 0;
    const slow = (id: string) =>
      makePlugin(id, async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        return "ok";
      });
    const manager = makeManager([slow("a"), slow("b"), slow("c")]);
    const queue = new DownloadQueue({ manager, save, concurrency: 1 });

    queue.enqueue({ id: 1, pluginId: "a", chapterPath: "/c/1" });
    queue.enqueue({ id: 2, pluginId: "b", chapterPath: "/c/2" });
    queue.enqueue({ id: 3, pluginId: "c", chapterPath: "/c/3" });

    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(maxActive).toBe(1);
    expect(queue.status(1)?.kind).toBe("done");
    expect(queue.status(2)?.kind).toBe("done");
    expect(queue.status(3)?.kind).toBe("done");
  });

  it("re-enqueueing a queued/running job is a no-op", async () => {
    const manager = makeManager([
      makePlugin(
        "p",
        () => new Promise((resolve) => setTimeout(() => resolve("ok"), 10)),
      ),
    ]);
    const queue = new DownloadQueue({ manager, save, concurrency: 1 });

    expect(queue.enqueue({ id: 1, pluginId: "p", chapterPath: "/x" })).toBe(
      true,
    );
    expect(queue.enqueue({ id: 1, pluginId: "p", chapterPath: "/x" })).toBe(
      false,
    );

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(queue.status(1)?.kind).toBe("done");

    // Re-enqueue after done is allowed.
    expect(queue.enqueue({ id: 1, pluginId: "p", chapterPath: "/x" })).toBe(
      true,
    );
  });
});
