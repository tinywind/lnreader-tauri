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
  listDownloadCacheMediaBackfillCandidates,
  listDownloadCacheNovels,
  updateDownloadCacheChapterMediaBytes,
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
  it("uses stored byte columns instead of scanning chapter content", async () => {
    mockSelect.mockResolvedValueOnce([]);

    await listDownloadCacheNovels();

    const [sql] = mockSelect.mock.calls[0]!;
    expect(sql).toContain("SUM(c.content_bytes + c.media_bytes)");
    expect(sql).toContain("media_repair_needed = 1");
    expect(sql).toContain("n.is_local = 0");
    expect(sql).not.toContain("length(CAST");
    expect(sql).not.toContain("COALESCE(c.content");
  });
});

describe("listDownloadCacheChapters", () => {
  it("uses stored content and media byte counts for chapter sizes", async () => {
    mockSelect.mockResolvedValueOnce([]);

    await listDownloadCacheChapters(7);

    const [sql, params] = mockSelect.mock.calls[0]!;
    expect(sql).toContain("content_bytes AS contentBytes");
    expect(sql).toContain("media_bytes AS mediaBytes");
    expect(sql).toContain("media_repair_needed AS mediaRepairNeeded");
    expect(sql).toContain("content_bytes + c.media_bytes AS totalBytes");
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
    expect(sql).toContain("media_bytes   = 0");
    expect(sql).toContain("media_repair_needed = 0");
    expect(sql).toContain("is_downloaded = 0");
    expect(sql).toContain("n.is_local = 0");
    expect(params).toEqual([7]);
    expect(result.rowsAffected).toBe(1);
  });
});

describe("deleteDownloadCacheNovel", () => {
  it("clears cached byte counts for one novel", async () => {
    mockExecute.mockResolvedValueOnce({ rowsAffected: 2 });

    await deleteDownloadCacheNovel(7);

    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).toContain("content_bytes = 0");
    expect(sql).toContain("media_bytes   = 0");
    expect(sql).toContain("media_repair_needed = 0");
    expect(sql).toContain("novel_id = $1");
    expect(sql).toContain("n.is_local = 0");
    expect(params).toEqual([7]);
  });
});

describe("deleteAllDownloadCache", () => {
  it("clears cached byte counts globally", async () => {
    mockExecute.mockResolvedValueOnce({ rowsAffected: 3 });

    await deleteAllDownloadCache();

    const [sql] = mockExecute.mock.calls[0]!;
    expect(sql).toContain("content_bytes = 0");
    expect(sql).toContain("media_bytes   = 0");
    expect(sql).toContain("media_repair_needed = 0");
    expect(sql).toContain("WHERE is_downloaded = 1");
    expect(sql).toContain("n.is_local = 0");
  });
});

describe("download cache media byte backfill", () => {
  it("selects only downloaded non-local chapters that still need media bytes", async () => {
    mockSelect.mockResolvedValueOnce([]);

    await listDownloadCacheMediaBackfillCandidates(7);

    const [sql, params] = mockSelect.mock.calls[0]!;
    expect(sql).toContain("c.name           AS chapterName");
    expect(sql).toContain("c.chapter_number AS chapterNumber");
    expect(sql).toContain("n.path           AS novelPath");
    expect(sql).toContain("n.plugin_id      AS pluginId");
    expect(sql).toContain("c.media_bytes = 0");
    expect(sql).toContain("c.content LIKE '%norea-media://chapter/%'");
    expect(sql).toContain("n.is_local = 0");
    expect(sql).toContain("c.novel_id = $1");
    expect(params).toEqual([7]);
  });

  it("updates a chapter media byte count without changing download time", async () => {
    mockExecute.mockResolvedValueOnce({ rowsAffected: 1 });

    const result = await updateDownloadCacheChapterMediaBytes(7, 42.4);

    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).toContain("SET media_bytes = $2");
    expect(sql).not.toContain("updated_at");
    expect(params).toEqual([7, 42]);
    expect(result.rowsAffected).toBe(1);
  });
});
