import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceTaskSpec } from "./scheduler";

const schedulerMocks = vi.hoisted(() => ({
  enqueueSource: vi.fn(),
}));

const pluginMocks = vi.hoisted(() => ({
  getPlugin: vi.fn(),
  getPluginForExecutor: vi.fn(),
  loadInstalledFromDb: vi.fn(),
  parseChapter: vi.fn(),
}));

vi.mock("../../db/queries/chapter", () => ({
  getChapterById: vi.fn(),
  saveChapterContent: vi.fn(),
  saveChapterPartialContent: vi.fn(),
}));
vi.mock("../../db/queries/novel", () => ({
  getNovelById: vi.fn(),
}));
vi.mock("../../store/browse", () => ({
  useBrowseStore: {
    getState: vi.fn(() => ({ chapterDownloadCooldownSeconds: 0 })),
  },
}));
vi.mock("../chapter-media", () => ({
  cacheHtmlChapterMedia: vi.fn(),
  clearChapterMedia: vi.fn(),
  getStoredChapterMediaBytes: vi.fn(),
  hasRemoteChapterMedia: vi.fn(),
  localChapterMediaCacheKeys: vi.fn(),
  pruneChapterMedia: vi.fn(),
}));
vi.mock("../plugins/manager", () => ({
  pluginManager: {
    getPlugin: pluginMocks.getPlugin,
    getPluginForExecutor: pluginMocks.getPluginForExecutor,
    loadInstalledFromDb: pluginMocks.loadInstalledFromDb,
  },
}));
vi.mock("../tauri-runtime", () => ({
  isTauriRuntime: vi.fn(() => false),
}));
vi.mock("./scheduler", () => ({
  sourceBaseDomainKey: vi.fn((baseUrl?: string) =>
    baseUrl ? "source.test" : null,
  ),
  TASK_PAUSE_ABORT_MESSAGE: "Task was paused.",
  taskScheduler: {
    enqueueSource: schedulerMocks.enqueueSource,
    getSnapshot: vi.fn(() => ({ records: [] })),
    getTaskByDedupeKey: vi.fn(),
    subscribeEvents: vi.fn(),
  },
}));

import {
  getChapterById,
  saveChapterContent,
  saveChapterPartialContent,
} from "../../db/queries/chapter";
import { getNovelById } from "../../db/queries/novel";
import {
  cacheHtmlChapterMedia,
  clearChapterMedia,
  getStoredChapterMediaBytes,
  hasRemoteChapterMedia,
  localChapterMediaCacheKeys,
  pruneChapterMedia,
} from "../chapter-media";
import {
  enqueueChapterDownload,
  enqueueChapterMediaRepair,
} from "./chapter-download";

let capturedSpec: SourceTaskSpec<void> | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  capturedSpec = null;
  schedulerMocks.enqueueSource.mockImplementation(
    (spec: SourceTaskSpec<void>) => {
      capturedSpec = spec;
      return { id: "task-1", promise: new Promise<void>(() => {}) };
    },
  );
  const plugin = {
    id: "source-a",
    imageRequestInit: { headers: { Referer: "https://source.test/" } },
    name: "Source A",
    getBaseUrl: () => "https://source.test",
    parseChapter: pluginMocks.parseChapter,
  };
  pluginMocks.getPlugin.mockReturnValue(plugin);
  pluginMocks.getPluginForExecutor.mockReturnValue(plugin);
  pluginMocks.parseChapter.mockResolvedValue(`plain <chapter>`);
  vi.mocked(cacheHtmlChapterMedia).mockResolvedValue({
    cacheKey: "media-cache",
    html: "<img>",
    mediaFailures: [],
    mediaBytes: 3,
    storedMediaCount: 1,
  });
  vi.mocked(getChapterById).mockResolvedValue({
    contentType: "text",
    id: 7,
  } as never);
  vi.mocked(getNovelById).mockResolvedValue(null);
  vi.mocked(getStoredChapterMediaBytes).mockResolvedValue(3);
  vi.mocked(hasRemoteChapterMedia).mockReturnValue(true);
  vi.mocked(localChapterMediaCacheKeys).mockReturnValue(["media-cache"]);
  vi.mocked(saveChapterContent).mockResolvedValue({ rowsAffected: 1 });
  vi.mocked(saveChapterPartialContent).mockResolvedValue({ rowsAffected: 1 });
});

describe("enqueueChapterDownload", () => {
  it("carries contentType through the task subject and saveChapterContent", async () => {
    enqueueChapterDownload({
      id: 7,
      pluginId: "source-a",
      chapterPath: "/chapter/7",
      contentType: "text",
      title: "Chapter 7",
    });

    expect(capturedSpec?.subject).toEqual(
      expect.objectContaining({ contentType: "text" }),
    );

    await capturedSpec?.run({
      setDetail: vi.fn(),
      setProgress: vi.fn(),
      signal: new AbortController().signal,
      taskId: "task-1",
    });

    expect(saveChapterContent).toHaveBeenCalledWith(
      7,
      `<section class="reader-text-content"><p>plain &lt;chapter&gt;</p></section>`,
      "text",
      { mediaBytes: 0 },
    );
    expect(clearChapterMedia).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ chapterId: 7, sourceId: "source-a" }),
    );
  });

  it("keeps chapter media downloads on the assigned scraper executor", async () => {
    pluginMocks.parseChapter.mockResolvedValueOnce(`<img src="/page.png">`);
    vi.mocked(getChapterById).mockResolvedValueOnce({
      content: `<img src="norea-media://chapter/7/old/page.png">`,
      contentType: "html",
      id: 7,
    } as never);

    enqueueChapterDownload({
      id: 7,
      pluginId: "source-a",
      chapterPath: "/chapter/7",
      contentType: "html",
      title: "Chapter 7",
    });

    if (!capturedSpec) throw new Error("Task spec was not captured.");
    await capturedSpec.run({
      executor: "pool:1",
      setDetail: vi.fn(),
      setProgress: vi.fn(),
      signal: new AbortController().signal,
      taskId: "task-1",
    });

    expect(cacheHtmlChapterMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        previousHtml: `<img src="norea-media://chapter/7/old/page.png">`,
        requestInit: { headers: { Referer: "https://source.test/" } },
        scraperExecutor: "pool:1",
        sourceId: "source-a",
      }),
    );
    expect(saveChapterContent).toHaveBeenCalledWith(7, "<img>", "html", {
      mediaBytes: 3,
    });
  });

  it("records media fallback detail without failing the chapter download", async () => {
    const setDetail = vi.fn();
    pluginMocks.parseChapter.mockResolvedValueOnce(`<img src="/page.png">`);
    vi.mocked(getChapterById).mockResolvedValueOnce({
      content: null,
      contentType: "html",
      id: 7,
    } as never);
    vi.mocked(cacheHtmlChapterMedia).mockResolvedValueOnce({
      cacheKey: null,
      html: `<img src="https://source.test/page.png">`,
      mediaFailures: [
        {
          message: "Failed to fetch",
          url: "https://source.test/page.png",
        },
      ],
      mediaBytes: 0,
      storedMediaCount: 0,
    });

    enqueueChapterDownload({
      id: 7,
      pluginId: "source-a",
      chapterPath: "/chapter/7",
      contentType: "html",
      title: "Chapter 7",
    });

    if (!capturedSpec) throw new Error("Task spec was not captured.");
    await capturedSpec.run({
      setDetail,
      setProgress: vi.fn(),
      signal: new AbortController().signal,
      taskId: "task-1",
    });

    expect(setDetail).toHaveBeenCalledWith(
      "1 media assets using remote fallback",
    );
    expect(saveChapterContent).toHaveBeenCalledWith(
      7,
      `<img src="https://source.test/page.png">`,
      "html",
      { mediaBytes: 0 },
    );
  });

  it("fails when the local chapter row is missing", async () => {
    vi.mocked(getChapterById).mockResolvedValueOnce(null);

    enqueueChapterDownload({
      id: 7,
      pluginId: "source-a",
      chapterPath: "/chapter/7",
      title: "Chapter 7",
    });

    if (!capturedSpec) throw new Error("Task spec was not captured.");
    await expect(
      capturedSpec.run({
        setDetail: vi.fn(),
        setProgress: vi.fn(),
        signal: new AbortController().signal,
        taskId: "task-1",
      }),
    ).rejects.toThrow(
      'chapter-download: local chapter 7 was not found for "Chapter 7" from plugin "source-a" at path "/chapter/7".',
    );

    expect(pluginMocks.parseChapter).not.toHaveBeenCalled();
    expect(saveChapterContent).not.toHaveBeenCalled();
  });

  it("fails when saving downloaded content does not update a chapter row", async () => {
    vi.mocked(saveChapterContent).mockResolvedValueOnce({ rowsAffected: 0 });

    enqueueChapterDownload({
      id: 7,
      pluginId: "source-a",
      chapterPath: "/chapter/7",
      title: "Chapter 7",
    });

    if (!capturedSpec) throw new Error("Task spec was not captured.");
    await expect(
      capturedSpec.run({
        setDetail: vi.fn(),
        setProgress: vi.fn(),
        signal: new AbortController().signal,
        taskId: "task-1",
      }),
    ).rejects.toThrow(
      'chapter-download: local chapter 7 was not found for "Chapter 7" from plugin "source-a" at path "/chapter/7".',
    );

    expect(clearChapterMedia).not.toHaveBeenCalled();
  });
});

describe("enqueueChapterMediaRepair", () => {
  it("repairs remote media without parsing chapter content", async () => {
    const setDetail = vi.fn();
    const storedHtml = `<img src="https://cdn.test/page.png">`;
    const repairedHtml = `<img src="norea-media://chapter/7/media-cache/page.png">`;
    vi.mocked(getChapterById).mockResolvedValueOnce({
      chapterNumber: "7",
      content: storedHtml,
      contentType: "html",
      id: 7,
      isDownloaded: true,
      name: "Chapter 7",
      novelId: 11,
      path: "/chapter/7",
      position: 7,
    } as never);
    vi.mocked(getNovelById).mockResolvedValueOnce({
      id: 11,
      name: "Novel",
      path: "/novel",
    } as never);
    vi.mocked(cacheHtmlChapterMedia).mockResolvedValueOnce({
      cacheKey: "media-cache",
      html: repairedHtml,
      mediaFailures: [],
      mediaBytes: 8,
      storedMediaCount: 1,
    });
    vi.mocked(getStoredChapterMediaBytes).mockResolvedValueOnce(8);

    enqueueChapterMediaRepair({
      id: 7,
      pluginId: "source-a",
      title: "Chapter 7",
    });

    if (!capturedSpec) throw new Error("Task spec was not captured.");
    await capturedSpec.run({
      executor: "pool:1",
      setDetail,
      setProgress: vi.fn(),
      signal: new AbortController().signal,
      taskId: "task-1",
    });

    expect(pluginMocks.parseChapter).not.toHaveBeenCalled();
    expect(cacheHtmlChapterMedia).toHaveBeenCalledWith(
      expect.objectContaining({
        html: storedHtml,
        previousHtml: storedHtml,
        requestInit: { headers: { Referer: "https://source.test/" } },
        scraperExecutor: "pool:1",
        sourceId: "source-a",
      }),
    );
    expect(saveChapterContent).toHaveBeenCalledWith(7, repairedHtml, "html", {
      mediaBytes: 8,
    });
    expect(pruneChapterMedia).toHaveBeenCalledWith(
      7,
      "media-cache",
      expect.objectContaining({ chapterId: 7, sourceId: "source-a" }),
    );
    expect(setDetail).toHaveBeenCalledWith("1 media assets repaired");
  });

  it("succeeds without work when downloaded HTML has no remote media", async () => {
    const setDetail = vi.fn();
    vi.mocked(hasRemoteChapterMedia).mockReturnValueOnce(false);
    vi.mocked(getChapterById).mockResolvedValueOnce({
      content: `<img src="norea-media://chapter/7/media-cache/page.png">`,
      contentType: "html",
      id: 7,
      isDownloaded: true,
      name: "Chapter 7",
      novelId: 11,
      path: "/chapter/7",
      position: 7,
    } as never);

    enqueueChapterMediaRepair({
      id: 7,
      pluginId: "source-a",
      title: "Chapter 7",
    });

    if (!capturedSpec) throw new Error("Task spec was not captured.");
    await capturedSpec.run({
      setDetail,
      setProgress: vi.fn(),
      signal: new AbortController().signal,
      taskId: "task-1",
    });

    expect(setDetail).toHaveBeenCalledWith("No remote media to repair");
    expect(pluginMocks.parseChapter).not.toHaveBeenCalled();
    expect(cacheHtmlChapterMedia).not.toHaveBeenCalled();
    expect(saveChapterContent).not.toHaveBeenCalled();
  });
});
