import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../client";
import {
  clearChapterContent,
  getAdjacentChapter,
  getChapterById,
  getChapterContent,
  insertChapter,
  listChaptersByNovel,
  listLibraryUpdates,
  listRecentlyRead,
  saveChapterContent,
  setChapterBookmark,
  updateChapterProgress,
  upsertChapter,
} from "./chapter";

const mockedGetDb = vi.mocked(getDb);
let mockSelect: ReturnType<typeof vi.fn>;
let mockExecute: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockSelect = vi.fn();
  mockExecute = vi.fn();
  mockedGetDb.mockResolvedValue({
    select: mockSelect,
    execute: mockExecute,
  } as never);
});

describe("listChaptersByNovel", () => {
  it("filters by novel_id and orders by position", async () => {
    mockSelect.mockResolvedValueOnce([]);
    await listChaptersByNovel(42);

    const [sql, params] = mockSelect.mock.calls[0]!;
    expect(sql).toContain("FROM chapter");
    expect(sql).toContain("WHERE novel_id = $1");
    expect(sql).toContain("ORDER BY position");
    expect(params).toEqual([42]);
  });
});

describe("getChapterById", () => {
  it("returns the row when present", async () => {
    mockSelect.mockResolvedValueOnce([{ id: 7, novelId: 1 }]);
    const row = await getChapterById(7);
    expect(row).toMatchObject({ id: 7, novelId: 1 });
  });

  it("returns null on miss", async () => {
    mockSelect.mockResolvedValueOnce([]);
    expect(await getChapterById(999)).toBeNull();
  });
});

describe("insertChapter", () => {
  it("uses INSERT OR IGNORE with the 7 expected params in order", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await insertChapter({
      novelId: 1,
      path: "/c/1",
      name: "Chapter One",
      position: 1,
      chapterNumber: "1",
      page: "1",
      releaseTime: "2025-12-31",
    });

    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).toContain("INSERT OR IGNORE INTO chapter");
    expect(params).toEqual([
      1,
      "/c/1",
      "Chapter One",
      1,
      "1",
      "1",
      "2025-12-31",
    ]);
  });

  it("defaults page to '1' and nullable fields to null", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await insertChapter({
      novelId: 2,
      path: "/c/x",
      name: "Untitled",
      position: 0,
    });
    const [, params] = mockExecute.mock.calls[0]!;
    expect(params).toEqual([2, "/c/x", "Untitled", 0, null, "1", null]);
  });
});

describe("upsertChapter", () => {
  it("updates source metadata without touching progress fields", async () => {
    mockExecute.mockResolvedValueOnce(undefined);

    await upsertChapter({
      novelId: 7,
      path: "/c/1",
      name: "Chapter One",
      position: 1,
      chapterNumber: "1",
      page: "2",
      releaseTime: "2026-05-01",
    });

    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).toContain("ON CONFLICT(novel_id, path) DO UPDATE");
    expect(sql).toContain("name           = excluded.name");
    expect(sql).toContain("updated_at     = unixepoch()");
    expect(sql).not.toContain("progress");
    expect(sql).not.toContain("is_downloaded");
    expect(params).toEqual([
      7,
      "/c/1",
      "Chapter One",
      1,
      "1",
      "2",
      "2026-05-01",
    ]);
  });
});

describe("updateChapterProgress", () => {
  it("clamps below zero to 0", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await updateChapterProgress(5, -10);
    const [, params] = mockExecute.mock.calls[0]!;
    expect(params).toEqual([5, 0]);
  });

  it("clamps above 100 to 100", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await updateChapterProgress(5, 250);
    const [, params] = mockExecute.mock.calls[0]!;
    expect(params).toEqual([5, 100]);
  });

  it("rounds floats", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await updateChapterProgress(5, 33.7);
    const [, params] = mockExecute.mock.calls[0]!;
    expect(params).toEqual([5, 34]);
  });

  it("flips unread + read_at when crossing the 97 threshold", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await updateChapterProgress(5, 97);
    const [sql] = mockExecute.mock.calls[0]!;
    expect(sql).toContain("CASE WHEN $2 >= 97 THEN 0 ELSE unread END");
    expect(sql).toContain(
      "CASE WHEN $2 >= 97 THEN unixepoch() ELSE read_at END",
    );
  });
});

describe("setChapterBookmark", () => {
  it("toggles via parameterized UPDATE", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await setChapterBookmark(11, true);
    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).toContain("UPDATE chapter");
    expect(sql).toContain("bookmark = $2");
    expect(params).toEqual([11, true]);
  });
});

describe("saveChapterContent", () => {
  it("UPDATEs content + flips is_downloaded=1 + bumps updated_at", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await saveChapterContent(7, "<p>hello</p>");
    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).toContain("UPDATE chapter");
    expect(sql).toContain("content");
    expect(sql).toContain("is_downloaded  = 1");
    expect(sql).toContain("updated_at     = unixepoch()");
    expect(params).toEqual([7, "<p>hello</p>"]);
  });
});

describe("getChapterContent", () => {
  it("returns the content string when row exists with content", async () => {
    mockSelect.mockResolvedValueOnce([{ content: "<p>x</p>" }]);
    expect(await getChapterContent(7)).toBe("<p>x</p>");
  });

  it("returns null when row content is null", async () => {
    mockSelect.mockResolvedValueOnce([{ content: null }]);
    expect(await getChapterContent(7)).toBeNull();
  });

  it("returns null when no row matches", async () => {
    mockSelect.mockResolvedValueOnce([]);
    expect(await getChapterContent(7)).toBeNull();
  });
});

describe("clearChapterContent", () => {
  it("nulls content and resets is_downloaded", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await clearChapterContent(7);
    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).toContain("content        = NULL");
    expect(sql).toContain("is_downloaded  = 0");
    expect(params).toEqual([7]);
  });
});

describe("getAdjacentChapter", () => {
  it("issues the next-chapter query when direction=1", async () => {
    mockSelect.mockResolvedValueOnce([]);
    await getAdjacentChapter(1, 5, 1);
    const [sql, params] = mockSelect.mock.calls[0]!;
    expect(sql).toContain("position > $2");
    expect(sql).toContain("ORDER BY position ASC");
    expect(params).toEqual([1, 5]);
  });

  it("issues the prev-chapter query when direction=-1", async () => {
    mockSelect.mockResolvedValueOnce([]);
    await getAdjacentChapter(1, 5, -1);
    const [sql, params] = mockSelect.mock.calls[0]!;
    expect(sql).toContain("position < $2");
    expect(sql).toContain("ORDER BY position DESC");
    expect(params).toEqual([1, 5]);
  });

  it("returns null on no adjacent row", async () => {
    mockSelect.mockResolvedValueOnce([]);
    expect(await getAdjacentChapter(1, 5, 1)).toBeNull();
  });
});

describe("listLibraryUpdates", () => {
  it("filters in-library + unread and orders by updated_at DESC", async () => {
    mockSelect.mockResolvedValueOnce([]);

    await listLibraryUpdates();

    const [sql, params] = mockSelect.mock.calls[0]!;
    expect(sql).toContain("n.in_library = 1");
    expect(sql).toContain("c.unread = 1");
    expect(sql).toContain("ORDER BY c.updated_at DESC");
    expect(params).toEqual([200]);
  });

  it("coerces is_downloaded to a strict boolean", async () => {
    mockSelect.mockResolvedValueOnce([
      {
        chapterId: 1,
        novelId: 1,
        chapterName: "Ch1",
        position: 1,
        updatedAt: 1_700_000_000,
        isDownloaded: 1,
        novelName: "Sample",
        novelCover: null,
      },
    ]);

    const rows = await listLibraryUpdates();
    expect(rows[0]?.isDownloaded).toBe(true);
  });

  it("clamps limit to a minimum of 1", async () => {
    mockSelect.mockResolvedValueOnce([]);
    await listLibraryUpdates(0);
    const [, params] = mockSelect.mock.calls[0]!;
    expect(params).toEqual([1]);
  });
});

describe("listRecentlyRead", () => {
  it("joins chapter with novel and orders by read_at DESC", async () => {
    mockSelect.mockResolvedValueOnce([]);

    await listRecentlyRead();

    const [sql, params] = mockSelect.mock.calls[0]!;
    expect(sql).toContain("FROM chapter c");
    expect(sql).toContain("JOIN novel n");
    expect(sql).toContain("c.read_at IS NOT NULL");
    expect(sql).toContain("ORDER BY c.read_at DESC");
    expect(sql).toContain("LIMIT $1");
    expect(params).toEqual([100]);
  });

  it("clamps limit to a minimum of 1 and floors fractional input", async () => {
    mockSelect.mockResolvedValueOnce([]);

    await listRecentlyRead(0.4);

    const [, params] = mockSelect.mock.calls[0]!;
    expect(params).toEqual([1]);
  });

  it("forwards a custom positive limit", async () => {
    mockSelect.mockResolvedValueOnce([]);

    await listRecentlyRead(25);

    const [, params] = mockSelect.mock.calls[0]!;
    expect(params).toEqual([25]);
  });
});
