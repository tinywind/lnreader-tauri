import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/client", () => ({
  getDb: vi.fn(),
}));

vi.mock("../../db/queries/chapter", () => ({
  getLatestSourceChapterAnchor: vi.fn(),
  upsertChapter: vi.fn(),
}));

vi.mock("../updates/update-index-events", () => ({
  markUpdatesIndexDirty: vi.fn(),
}));

import { getDb } from "../../db/client";
import {
  getLatestSourceChapterAnchor,
  upsertChapter,
} from "../../db/queries/chapter";
import { syncNovelFromSource } from "./sync-novel";
import type { Plugin, SourceNovel } from "./types";

const mockedGetDb = vi.mocked(getDb);
const mockedGetLatestSourceChapterAnchor = vi.mocked(
  getLatestSourceChapterAnchor,
);
const mockedUpsertChapter = vi.mocked(upsertChapter);

let mockExecute: ReturnType<typeof vi.fn>;
let mockSelect: ReturnType<typeof vi.fn>;

function makeDetail(chapterNumbers: number[]): SourceNovel {
  return {
    name: "Novel",
    path: "/novel",
    chapters: chapterNumbers.map((chapterNumber) => ({
      chapterNumber,
      name: `Chapter ${chapterNumber}`,
      path: `/chapter-${chapterNumber}`,
    })),
  };
}

function makePlugin(overrides: Partial<Plugin> = {}): Plugin {
  return {
    id: "demo",
    name: "Demo",
    lang: "en",
    version: "1.0.0",
    url: "https://example.test/index.js",
    iconUrl: "https://example.test/icon.png",
    getBaseUrl: () => "https://example.test",
    popularNovels: () => Promise.resolve([]),
    parseNovel: vi.fn(() => Promise.resolve(makeDetail([1, 2, 3]))),
    parseNovelSince: vi.fn((_path, since) =>
      Promise.resolve(makeDetail([since, since + 1])),
    ),
    parseChapter: () => Promise.resolve(""),
    searchNovels: () => Promise.resolve([]),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockExecute = vi.fn().mockResolvedValue({ rowsAffected: 0 });
  mockSelect = vi.fn().mockResolvedValue([{ id: 7 }]);
  mockedGetDb.mockResolvedValue({
    execute: mockExecute,
    select: mockSelect,
  } as never);
  mockedGetLatestSourceChapterAnchor.mockResolvedValue({
    novelId: 7,
    chapterNumber: 2,
    position: 2,
  });
  mockedUpsertChapter.mockResolvedValue({ rowsAffected: 1 });
});

describe("syncNovelFromSource", () => {
  it("rejects chapters without finite numeric chapterNumber", async () => {
    const plugin = makePlugin({
      parseNovel: vi.fn(() =>
        Promise.resolve({
          ...makeDetail([]),
          chapters: [
            {
              chapterNumber: Number.NaN,
              name: "Broken",
              path: "/broken",
            },
          ],
        }),
      ),
    });

    await expect(
      syncNovelFromSource(plugin, { name: "Novel", path: "/novel" }),
    ).rejects.toThrow("finite numeric chapterNumber");
  });

  it("rejects duplicate chapterNumber values from a source result", async () => {
    const plugin = makePlugin({
      parseNovel: vi.fn(() => Promise.resolve(makeDetail([1, 1]))),
    });

    await expect(
      syncNovelFromSource(plugin, { name: "Novel", path: "/novel" }),
    ).rejects.toThrow("duplicate chapterNumber 1");
  });

  it("uses parseNovelSince and starts at the anchor position for suffix results", async () => {
    const plugin = makePlugin();

    await syncNovelFromSource(
      plugin,
      { name: "Novel", path: "/novel" },
      { chapterRefreshMode: "since", novelId: 7 },
    );

    expect(plugin.parseNovelSince).toHaveBeenCalledWith("/novel", 2);
    expect(plugin.parseNovel).not.toHaveBeenCalled();
    expect(mockedUpsertChapter).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        chapterNumber: "2",
        path: "/chapter-2",
        position: 2,
      }),
    );
    expect(mockedUpsertChapter).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        chapterNumber: "3",
        path: "/chapter-3",
        position: 3,
      }),
    );
  });

  it("treats a since result starting before the anchor as a full list", async () => {
    const plugin = makePlugin({
      parseNovelSince: vi.fn(() => Promise.resolve(makeDetail([1, 2, 3]))),
    });

    await syncNovelFromSource(
      plugin,
      { name: "Novel", path: "/novel" },
      { chapterRefreshMode: "since", novelId: 7 },
    );

    expect(plugin.parseNovel).not.toHaveBeenCalled();
    expect(mockedUpsertChapter).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        chapterNumber: "1",
        position: 1,
      }),
    );
  });

  it("falls back to parseNovel when a since result skips the anchor", async () => {
    const plugin = makePlugin({
      parseNovelSince: vi.fn(() => Promise.resolve(makeDetail([3, 4]))),
    });

    await syncNovelFromSource(
      plugin,
      { name: "Novel", path: "/novel" },
      { chapterRefreshMode: "since", novelId: 7 },
    );

    expect(plugin.parseNovelSince).toHaveBeenCalledWith("/novel", 2);
    expect(plugin.parseNovel).toHaveBeenCalledWith("/novel");
    expect(mockedUpsertChapter).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        chapterNumber: "1",
        position: 1,
      }),
    );
  });

  it("falls back to full refresh when existing chapters lack chapter numbers", async () => {
    mockedGetLatestSourceChapterAnchor.mockResolvedValueOnce(null);
    const plugin = makePlugin();

    await syncNovelFromSource(
      plugin,
      { name: "Novel", path: "/novel" },
      { chapterRefreshMode: "since", novelId: 7 },
    );

    expect(plugin.parseNovelSince).not.toHaveBeenCalled();
    expect(plugin.parseNovel).toHaveBeenCalledWith("/novel");
  });
});
