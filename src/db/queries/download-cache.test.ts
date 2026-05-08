import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../client";
import {
  deleteAllDownloadCache,
  deleteDownloadCacheChapter,
  deleteDownloadCacheNovel,
  listDownloadCacheChapters,
  listDownloadCacheNovels,
} from "./download-cache";

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

describe("listDownloadCacheNovels", () => {
  it("uses stored content_bytes instead of scanning chapter content", async () => {
    mockSelect.mockResolvedValueOnce([]);

    await listDownloadCacheNovels();

    const [sql] = mockSelect.mock.calls[0]!;
    expect(sql).toContain("SUM(c.content_bytes)");
    expect(sql).toContain("n.is_local = 0");
    expect(sql).not.toContain("length(CAST");
    expect(sql).not.toContain("COALESCE(c.content");
  });
});

describe("listDownloadCacheChapters", () => {
  it("uses stored content_bytes for chapter sizes", async () => {
    mockSelect.mockResolvedValueOnce([]);

    await listDownloadCacheChapters(7);

    const [sql, params] = mockSelect.mock.calls[0]!;
    expect(sql).toContain("content_bytes AS contentBytes");
    expect(sql).toContain("JOIN novel n ON n.id = c.novel_id");
    expect(sql).toContain("n.is_local = 0");
    expect(sql).not.toContain("length(CAST");
    expect(params).toEqual([7]);
  });
});

describe("deleteDownloadCacheChapter", () => {
  it("clears cached content and byte count", async () => {
    mockExecute.mockResolvedValueOnce({ rowsAffected: 1 });

    const result = await deleteDownloadCacheChapter(7);

    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).toContain("content       = NULL");
    expect(sql).toContain("content_bytes = 0");
    expect(sql).toContain("is_downloaded = 0");
    expect(sql).toContain("n.is_local = 0");
    expect(params).toEqual([7]);
    expect(result.rowsAffected).toBe(1);
  });
});

describe("deleteDownloadCacheNovel", () => {
  it("clears cached content byte counts for one novel", async () => {
    mockExecute.mockResolvedValueOnce({ rowsAffected: 2 });

    await deleteDownloadCacheNovel(7);

    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).toContain("content_bytes = 0");
    expect(sql).toContain("novel_id = $1");
    expect(sql).toContain("n.is_local = 0");
    expect(params).toEqual([7]);
  });
});

describe("deleteAllDownloadCache", () => {
  it("clears cached content byte counts globally", async () => {
    mockExecute.mockResolvedValueOnce({ rowsAffected: 3 });

    await deleteAllDownloadCache();

    const [sql] = mockExecute.mock.calls[0]!;
    expect(sql).toContain("content_bytes = 0");
    expect(sql).toContain("WHERE is_downloaded = 1");
    expect(sql).toContain("n.is_local = 0");
  });
});
