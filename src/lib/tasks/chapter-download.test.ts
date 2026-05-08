import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceTaskSpec } from "./scheduler";

const schedulerMocks = vi.hoisted(() => ({
  enqueueSource: vi.fn(),
}));

const pluginMocks = vi.hoisted(() => ({
  getPlugin: vi.fn(),
  loadInstalledFromDb: vi.fn(),
  parseChapter: vi.fn(),
}));

vi.mock("../../db/queries/chapter", () => ({
  getChapterById: vi.fn(),
  saveChapterContent: vi.fn(),
}));
vi.mock("../../store/browse", () => ({
  useBrowseStore: {
    getState: vi.fn(() => ({ chapterDownloadCooldownSeconds: 0 })),
  },
}));
vi.mock("../chapter-media", () => ({
  cacheHtmlChapterMedia: vi.fn(),
  clearChapterMedia: vi.fn(),
  pruneChapterMedia: vi.fn(),
}));
vi.mock("../plugins/manager", () => ({
  pluginManager: {
    getPlugin: pluginMocks.getPlugin,
    loadInstalledFromDb: pluginMocks.loadInstalledFromDb,
  },
}));
vi.mock("../tauri-runtime", () => ({
  isTauriRuntime: vi.fn(() => false),
}));
vi.mock("./scheduler", () => ({
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
} from "../../db/queries/chapter";
import { clearChapterMedia } from "../chapter-media";
import { enqueueChapterDownload } from "./chapter-download";

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
  pluginMocks.getPlugin.mockReturnValue({
    id: "source-a",
    name: "Source A",
    site: "https://source.test",
    parseChapter: pluginMocks.parseChapter,
  });
  pluginMocks.parseChapter.mockResolvedValue(`plain <chapter>`);
  vi.mocked(getChapterById).mockResolvedValue(null);
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
      "<pre>plain &lt;chapter&gt;</pre>",
      "text",
    );
    expect(clearChapterMedia).toHaveBeenCalledWith(7);
  });
});
