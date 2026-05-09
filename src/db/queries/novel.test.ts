import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../client";
import { UNCATEGORIZED_CATEGORY_ID } from "./category";
import {
  countNovels,
  findLocalNovelByPath,
  getNovelById,
  insertNovelIfAbsent,
  listLibraryNovelRefreshTargets,
  listLibraryNovels,
  reorderLocalNovelChapters,
  setNovelInLibrary,
  updateLocalNovelMetadata,
  upsertLocalNovel,
  upsertLocalNovelChapters,
  upsertLocalNovelMetadata,
} from "./novel";

const mockedGetDb = vi.mocked(getDb);
const LOCAL_COVER = "data:image/png;base64,AQID";

interface MockedDb {
  select: ReturnType<typeof vi.fn>;
  execute: ReturnType<typeof vi.fn>;
}

function stubDb(): MockedDb {
  const select = vi.fn();
  const execute = vi.fn();
  mockedGetDb.mockResolvedValue({ select, execute } as never);
  return { select, execute };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listLibraryNovels", () => {
  it("filters by in_library=1 and coerces booleans on the default sort", async () => {
    const db = stubDb();
    db.select.mockResolvedValueOnce([
      {
        id: 1,
        pluginId: "local",
        path: "p1",
        name: "Sample A",
        cover: null,
        author: "Writer A",
        inLibrary: 1,
        isLocal: 0,
        totalChapters: 10,
        chaptersDownloaded: 0,
        chaptersUnread: 5,
        readingProgress: 55,
        lastReadAt: 1000,
        lastUpdatedAt: 1_700_000_000,
      },
    ]);

    const rows = await listLibraryNovels();

    expect(db.select).toHaveBeenCalledOnce();
    const [sql, params] = db.select.mock.calls[0]!;
    expect(sql).toContain("FROM novel n");
    expect(sql).toContain("LEFT JOIN novel_stats s ON s.novel_id = n.id");
    expect(sql).not.toContain("LEFT JOIN chapter");
    expect(sql).toContain("n.in_library = 1");
    expect(sql).toContain("AS readingProgress");
    expect(sql).toContain("ORDER BY");
    expect(sql).toContain("last_read_at");
    expect(params).toEqual([]);
    expect(rows).toEqual([
      {
        id: 1,
        pluginId: "local",
        path: "p1",
        name: "Sample A",
        cover: null,
        author: "Writer A",
        inLibrary: true,
        isLocal: false,
        totalChapters: 10,
        chaptersDownloaded: 0,
        chaptersUnread: 5,
        readingProgress: 55,
        lastReadAt: 1000,
        lastUpdatedAt: 1_700_000_000,
      },
    ]);
  });

  it("does not expose remote covers for local novels", async () => {
    const db = stubDb();
    db.select.mockResolvedValueOnce([
      {
        id: 1,
        pluginId: "local",
        path: "p1",
        name: "Sample A",
        cover: "https://example.test/cover.jpg",
        author: "Writer A",
        inLibrary: 1,
        isLocal: 1,
        totalChapters: 10,
        chaptersDownloaded: 10,
        chaptersUnread: 0,
        readingProgress: 100,
        lastReadAt: 1000,
        lastUpdatedAt: 1_700_000_000,
      },
    ]);

    const rows = await listLibraryNovels();

    expect(rows[0]?.cover).toBeNull();
    expect(rows[0]?.isLocal).toBe(true);
  });

  it("appends a case-insensitive name LIKE clause when search is provided", async () => {
    const db = stubDb();
    db.select.mockResolvedValueOnce([]);

    await listLibraryNovels({ search: "  Hero " });

    const [sql, params] = db.select.mock.calls[0]!;
    expect(sql).toContain("LIKE '%' || $1 || '%'");
    expect(sql).toContain("COLLATE NOCASE");
    expect(params).toEqual(["Hero"]);
  });

  it("appends an EXISTS novel_category clause when categoryId is provided", async () => {
    const db = stubDb();
    db.select.mockResolvedValueOnce([]);

    await listLibraryNovels({ categoryId: 7 });

    const [sql, params] = db.select.mock.calls[0]!;
    expect(sql).toContain(
      "EXISTS (SELECT 1 FROM novel_category nc WHERE nc.novel_id = n.id AND nc.category_id = $1)",
    );
    expect(params).toEqual([7]);
  });

  it("filters uncategorized novels with no novel_category rows", async () => {
    const db = stubDb();
    db.select.mockResolvedValueOnce([]);

    await listLibraryNovels({ categoryId: UNCATEGORIZED_CATEGORY_ID });

    const [sql, params] = db.select.mock.calls[0]!;
    expect(sql).toContain(
      "NOT EXISTS (SELECT 1 FROM novel_category nc WHERE nc.novel_id = n.id)",
    );
    expect(params).toEqual([]);
  });

  it("uses materialized unread stats when unreadOnly is enabled", async () => {
    const db = stubDb();
    db.select.mockResolvedValueOnce([]);

    await listLibraryNovels({ unreadOnly: true });

    const [sql, params] = db.select.mock.calls[0]!;
    expect(sql).toContain("COALESCE(s.chapters_unread, 0) > 0");
    expect(sql).not.toContain("FROM chapter");
    expect(params).toEqual([]);
  });

  it("uses materialized downloaded stats when downloadedOnly is enabled", async () => {
    const db = stubDb();
    db.select.mockResolvedValueOnce([]);

    await listLibraryNovels({ downloadedOnly: true });

    const [sql, params] = db.select.mock.calls[0]!;
    expect(sql).toContain(
      "(n.is_local = 1 OR COALESCE(s.chapters_downloaded, 0) > 0)",
    );
    expect(sql).not.toContain("FROM chapter");
    expect(params).toEqual([]);
  });

  it("combines search and categoryId with stable param order", async () => {
    const db = stubDb();
    db.select.mockResolvedValueOnce([]);

    await listLibraryNovels({ search: "abc", categoryId: 3 });

    const [sql, params] = db.select.mock.calls[0]!;
    expect(sql).toContain("$1");
    expect(sql).toContain("$2");
    expect(params).toEqual(["abc", 3]);
  });

  it("ignores blank/whitespace-only search input", async () => {
    const db = stubDb();
    db.select.mockResolvedValueOnce([]);

    await listLibraryNovels({ search: "   " });

    const [sql, params] = db.select.mock.calls[0]!;
    expect(sql).not.toContain("LIKE");
    expect(params).toEqual([]);
  });
});

describe("listLibraryNovelRefreshTargets", () => {
  it("returns library refresh targets and coerces local flags", async () => {
    const db = stubDb();
    db.select.mockResolvedValueOnce([
      {
        id: 2,
        pluginId: "demo",
        path: "/novel",
        name: "Demo",
        cover: "https://example.test/cover.jpg",
        isLocal: 0,
      },
    ]);

    const rows = await listLibraryNovelRefreshTargets();

    const [sql, params] = db.select.mock.calls[0]!;
    expect(sql).toContain("FROM novel n");
    expect(sql).toContain("n.in_library = 1");
    expect(sql).toContain("ORDER BY n.name COLLATE NOCASE ASC");
    expect(params).toEqual([]);
    expect(rows).toEqual([
      {
        id: 2,
        pluginId: "demo",
        path: "/novel",
        name: "Demo",
        cover: "https://example.test/cover.jpg",
        isLocal: false,
      },
    ]);
  });

  it("can scope refresh targets to a manual category", async () => {
    const db = stubDb();
    db.select.mockResolvedValueOnce([]);

    await listLibraryNovelRefreshTargets({ categoryId: 9 });

    const [sql, params] = db.select.mock.calls[0]!;
    expect(sql).toContain(
      "EXISTS (SELECT 1 FROM novel_category nc WHERE nc.novel_id = n.id AND nc.category_id = $1)",
    );
    expect(params).toEqual([9]);
  });

  it("can scope refresh targets to uncategorized novels", async () => {
    const db = stubDb();
    db.select.mockResolvedValueOnce([]);

    await listLibraryNovelRefreshTargets({
      categoryId: UNCATEGORIZED_CATEGORY_ID,
    });

    const [sql, params] = db.select.mock.calls[0]!;
    expect(sql).toContain(
      "NOT EXISTS (SELECT 1 FROM novel_category nc WHERE nc.novel_id = n.id)",
    );
    expect(params).toEqual([]);
  });
});

describe("countNovels", () => {
  it("returns 0 when the table is empty", async () => {
    const db = stubDb();
    db.select.mockResolvedValueOnce([{ count: 0 }]);

    expect(await countNovels()).toBe(0);
  });

  it("returns the COUNT(*) value the row carries", async () => {
    const db = stubDb();
    db.select.mockResolvedValueOnce([{ count: 7 }]);

    expect(await countNovels()).toBe(7);
  });
});

describe("insertNovelIfAbsent", () => {
  it("uses INSERT OR IGNORE with the 5 expected params in order", async () => {
    const db = stubDb();
    db.execute.mockResolvedValueOnce(undefined);

    await insertNovelIfAbsent({
      pluginId: "local",
      path: "p1",
      name: "Sample",
    });

    expect(db.execute).toHaveBeenCalledOnce();
    const [sql, params] = db.execute.mock.calls[0]!;
    expect(sql).toContain("INSERT OR IGNORE INTO novel");
    expect(sql).toContain("library_added_at");
    expect(params).toEqual(["local", "p1", "Sample", null, 1]);
  });

  it("forwards a non-default cover and inLibrary=false", async () => {
    const db = stubDb();
    db.execute.mockResolvedValueOnce(undefined);

    await insertNovelIfAbsent({
      pluginId: "boxnovel",
      path: "/n/abc",
      name: "Title",
      cover: "https://example.test/c.jpg",
      inLibrary: false,
    });

    const [, params] = db.execute.mock.calls[0]!;
    expect(params).toEqual([
      "boxnovel",
      "/n/abc",
      "Title",
      "https://example.test/c.jpg",
      0,
    ]);
  });
});

describe("getNovelById", () => {
  it("returns null when no row matches", async () => {
    const db = stubDb();
    db.select.mockResolvedValueOnce([]);

    const result = await getNovelById(999);

    expect(result).toBeNull();
    const [, params] = db.select.mock.calls[0]!;
    expect(params).toEqual([999]);
  });

  it("coerces in_library and is_local to strict booleans", async () => {
    const db = stubDb();
    db.select.mockResolvedValueOnce([
      {
        id: 5,
        pluginId: "demo",
        path: "/n/5",
        name: "Hero",
        cover: null,
        summary: null,
        author: null,
        artist: null,
        status: null,
        genres: null,
        inLibrary: 1,
        isLocal: 0,
        createdAt: 1_700_000_000,
        updatedAt: 1_700_000_000,
        libraryAddedAt: 1_700_000_000,
        lastReadAt: null,
      },
    ]);

    const result = await getNovelById(5);

    expect(result?.inLibrary).toBe(true);
    expect(result?.isLocal).toBe(false);
    expect(result?.id).toBe(5);
    expect(result?.name).toBe("Hero");
  });
});

describe("findLocalNovelByPath", () => {
  it("finds only local novels by path and coerces booleans", async () => {
    const db = stubDb();
    db.select.mockResolvedValueOnce([
      {
        id: 9,
        pluginId: "local",
        path: "/books/sample.epub",
        name: "Local Book",
        cover: null,
        summary: null,
        author: "Writer",
        artist: null,
        status: null,
        genres: null,
        inLibrary: 1,
        isLocal: 1,
        createdAt: 1_700_000_000,
        updatedAt: 1_700_000_001,
        libraryAddedAt: 1_700_000_000,
        lastReadAt: null,
      },
    ]);

    const result = await findLocalNovelByPath("/books/sample.epub");

    const [sql, params] = db.select.mock.calls[0]!;
    expect(sql).toContain("plugin_id = $1");
    expect(sql).toContain("path = $2");
    expect(sql).toContain("is_local = 1");
    expect(params).toEqual(["local", "/books/sample.epub"]);
    expect(result?.inLibrary).toBe(true);
    expect(result?.isLocal).toBe(true);
    expect(result?.id).toBe(9);
  });

  it("returns null when no local novel matches", async () => {
    const db = stubDb();
    db.select.mockResolvedValueOnce([]);

    await expect(findLocalNovelByPath("/missing.epub")).resolves.toBeNull();
  });
});

describe("upsertLocalNovelMetadata", () => {
  it("creates a local library novel without chapters", async () => {
    const db = stubDb();
    db.execute.mockResolvedValueOnce({ rowsAffected: 1 });
    db.select.mockResolvedValueOnce([{ id: 77 }]);

    const novelId = await upsertLocalNovelMetadata({
      path: "local:manual:abc",
      name: "Manual Book",
      cover: "",
      summary: "Summary",
      author: "Writer",
      artist: "",
      status: "Ongoing",
      genres: "Fantasy",
    });

    const [sql, params] = db.execute.mock.calls[0]!;
    expect(sql).toContain("INSERT INTO novel");
    expect(sql).toContain("ON CONFLICT(plugin_id, path) DO UPDATE");
    expect(sql).toContain("is_local");
    expect(params).toEqual([
      "local",
      "local:manual:abc",
      "Manual Book",
      null,
      "Summary",
      "Writer",
      null,
      "Ongoing",
      "Fantasy",
    ]);

    const [, selectParams] = db.select.mock.calls[0]!;
    expect(selectParams).toEqual(["local", "local:manual:abc"]);
    expect(novelId).toBe(77);
  });

  it("requires a title", async () => {
    stubDb();

    await expect(
      upsertLocalNovelMetadata({ path: "local:manual:abc", name: " " }),
    ).rejects.toThrow("local novel: name is required");
  });

  it("discards remote cover sources", async () => {
    const db = stubDb();
    db.execute.mockResolvedValueOnce({ rowsAffected: 1 });
    db.select.mockResolvedValueOnce([{ id: 77 }]);

    await upsertLocalNovelMetadata({
      path: "local:manual:abc",
      name: "Manual Book",
      cover: "https://example.test/cover.jpg",
    });

    expect(db.execute.mock.calls[0]?.[1]?.[3]).toBeNull();
  });
});

describe("updateLocalNovelMetadata", () => {
  it("updates only local novel metadata fields", async () => {
    const db = stubDb();
    db.select.mockResolvedValueOnce([{ id: 12 }]);
    db.execute.mockResolvedValueOnce({ rowsAffected: 1 });

    await updateLocalNovelMetadata(12, {
      name: "Manual Book",
      cover: LOCAL_COVER,
      summary: "",
      author: "Writer",
      artist: "Artist",
      status: "",
      genres: "Fantasy",
    });

    const [selectSql, selectParams] = db.select.mock.calls[0]!;
    expect(selectSql).toContain("plugin_id = $2");
    expect(selectSql).toContain("is_local = 1");
    expect(selectParams).toEqual([12, "local"]);

    const [sql, params] = db.execute.mock.calls[0]!;
    expect(sql).toContain("UPDATE novel");
    expect(sql).toContain("plugin_id = $9");
    expect(sql).toContain("is_local = 1");
    expect(params).toEqual([
      12,
      "Manual Book",
      LOCAL_COVER,
      null,
      "Writer",
      "Artist",
      null,
      "Fantasy",
      "local",
    ]);
  });

  it("rejects missing or non-local targets", async () => {
    const db = stubDb();
    db.select.mockResolvedValueOnce([]);

    await expect(
      updateLocalNovelMetadata(12, {
        name: "Manual Book",
      }),
    ).rejects.toThrow("local novel: target novel is not local");
    expect(db.execute).not.toHaveBeenCalled();
  });

  it("discards remote cover sources", async () => {
    const db = stubDb();
    db.select.mockResolvedValueOnce([{ id: 12 }]);
    db.execute.mockResolvedValueOnce({ rowsAffected: 1 });

    await updateLocalNovelMetadata(12, {
      name: "Manual Book",
      cover: "https://example.test/cover.jpg",
    });

    expect(db.execute.mock.calls[0]?.[1]?.[2]).toBeNull();
  });
});

describe("upsertLocalNovelChapters", () => {
  it("adds downloaded chapters to an existing local novel", async () => {
    const db = stubDb();
    db.execute
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce(undefined);
    db.select.mockResolvedValueOnce([{ id: 42 }]);

    const result = await upsertLocalNovelChapters(42, [
      {
        path: "local:txt:hash/chapter-0001",
        name: "Chapter 1",
        position: 2,
        contentType: "text",
        content: "Chapter body",
        contentBytes: 12,
      },
    ]);

    expect(db.execute.mock.calls[0]?.[0]).toBe("BEGIN");

    const [checkSql, checkParams] = db.select.mock.calls[0]!;
    expect(checkSql).toContain("plugin_id = $2");
    expect(checkSql).toContain("is_local = 1");
    expect(checkParams).toEqual([42, "local"]);

    const [chapterSql, chapterParams] = db.execute.mock.calls[1]!;
    expect(chapterSql).toContain("INSERT INTO chapter");
    expect(chapterSql).toContain("content_type");
    expect(chapterSql).toContain("is_downloaded");
    expect(chapterParams).toEqual([
      42,
      "local:txt:hash/chapter-0001",
      "Chapter 1",
      2,
      null,
      "1",
      null,
      "text",
      "Chapter body",
      12,
    ]);

    expect(db.execute.mock.calls[3]?.[0]).toBe("COMMIT");
    expect(result).toEqual({
      changed: true,
      changedChapters: 1,
      novelId: 42,
      chapterCount: 1,
    });
  });

  it("preserves the mutation error when rollback fails", async () => {
    const db = stubDb();
    db.execute
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("rollback failed"));
    db.select.mockResolvedValueOnce([]);

    await expect(upsertLocalNovelChapters(42, [])).rejects.toThrow(
      "local novel: target novel is not local",
    );
    expect(db.execute.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });
});

describe("reorderLocalNovelChapters", () => {
  it("renumbers local chapter positions in the requested order", async () => {
    const db = stubDb();
    db.execute
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce(undefined);
    db.select
      .mockResolvedValueOnce([{ id: 42 }])
      .mockResolvedValueOnce([{ id: 8 }, { id: 9 }]);

    await reorderLocalNovelChapters(42, [9, 8]);

    expect(db.execute.mock.calls[0]?.[0]).toBe("BEGIN");
    expect(db.execute.mock.calls[1]?.[1]).toEqual([9, 42, 1]);
    expect(db.execute.mock.calls[2]?.[1]).toEqual([8, 42, 2]);
    expect(db.execute.mock.calls[4]?.[0]).toBe("COMMIT");
  });

  it("rejects reorder lists that do not match existing chapters", async () => {
    const db = stubDb();
    db.execute.mockResolvedValue({ rowsAffected: 1 });
    db.select
      .mockResolvedValueOnce([{ id: 42 }])
      .mockResolvedValueOnce([{ id: 8 }, { id: 9 }]);

    await expect(reorderLocalNovelChapters(42, [9, 9])).rejects.toThrow(
      "local novel: reorder ids must match existing chapters",
    );
    expect(db.execute.mock.calls[0]?.[0]).toBe("BEGIN");
    expect(db.execute.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("preserves the mutation error when rollback fails", async () => {
    const db = stubDb();
    db.execute
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("rollback failed"));
    db.select
      .mockResolvedValueOnce([{ id: 42 }])
      .mockResolvedValueOnce([{ id: 8 }, { id: 9 }]);

    await expect(reorderLocalNovelChapters(42, [9, 9])).rejects.toThrow(
      "local novel: reorder ids must match existing chapters",
    );
    expect(db.execute.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });
});

describe("upsertLocalNovel", () => {
  it("upserts a local library novel and downloaded chapters", async () => {
    const db = stubDb();
    db.execute
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce(undefined);
    db.select.mockResolvedValueOnce([{ id: 42 }]);

    const result = await upsertLocalNovel({
      path: "/books/sample.epub",
      name: "Local Book",
      cover: LOCAL_COVER,
      summary: "Imported locally.",
      author: "Writer",
      artist: "Artist",
      status: "completed",
      genres: "Fantasy",
      chapters: [
        {
          path: "chapter-1",
          name: "Chapter 1",
          position: 1,
          chapterNumber: "1",
          page: "1",
          releaseTime: "2026-01-01",
          contentType: "text",
          content: "Chapter body",
          contentBytes: 12,
        },
      ],
    });

    expect(db.execute.mock.calls[0]?.[0]).toBe("BEGIN");

    const [novelSql, novelParams] = db.execute.mock.calls[1]!;
    expect(novelSql).toContain("INSERT INTO novel");
    expect(novelSql).toContain("ON CONFLICT(plugin_id, path) DO UPDATE");
    expect(novelSql).toContain("in_library, is_local");
    expect(novelSql).toContain("in_library       = 1");
    expect(novelSql).toContain("is_local         = 1");
    expect(novelParams).toEqual([
      "local",
      "/books/sample.epub",
      "Local Book",
      LOCAL_COVER,
      "Imported locally.",
      "Writer",
      "Artist",
      "completed",
      "Fantasy",
    ]);

    const [selectSql, selectParams] = db.select.mock.calls[0]!;
    expect(selectSql).toContain("SELECT id FROM novel");
    expect(selectParams).toEqual(["local", "/books/sample.epub"]);

    const [chapterSql, chapterParams] = db.execute.mock.calls[2]!;
    expect(chapterSql).toContain("INSERT INTO chapter");
    expect(chapterSql).toContain("content_type");
    expect(chapterSql).toContain("content_bytes");
    expect(chapterSql).toContain("is_downloaded");
    expect(chapterSql).toContain("is_downloaded  = 1");
    expect(chapterParams).toEqual([
      42,
      "chapter-1",
      "Chapter 1",
      1,
      "1",
      "1",
      "2026-01-01",
      "text",
      "Chapter body",
      12,
    ]);

    expect(db.execute.mock.calls[3]?.[0]).toBe("COMMIT");
    expect(result).toEqual({
      changed: true,
      changedChapters: 1,
      novelId: 42,
      chapterCount: 1,
    });
  });

  it("rolls back when the local novel id cannot be resolved", async () => {
    const db = stubDb();
    db.execute
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce(undefined);
    db.select.mockResolvedValueOnce([]);

    await expect(
      upsertLocalNovel({
        path: "/books/missing.epub",
        name: "Missing",
        chapters: [],
      }),
    ).rejects.toThrow("local import: failed to resolve local novel id");

    expect(db.execute.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("preserves the mutation error when rollback fails", async () => {
    const db = stubDb();
    db.execute
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockRejectedValueOnce(new Error("rollback failed"));
    db.select.mockResolvedValueOnce([]);

    await expect(
      upsertLocalNovel({
        path: "/books/missing.epub",
        name: "Missing",
        chapters: [],
      }),
    ).rejects.toThrow("local import: failed to resolve local novel id");
    expect(db.execute.mock.calls.at(-1)?.[0]).toBe("ROLLBACK");
  });

  it("discards remote cover sources", async () => {
    const db = stubDb();
    db.execute
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ rowsAffected: 1 })
      .mockResolvedValueOnce(undefined);
    db.select.mockResolvedValueOnce([{ id: 42 }]);

    await upsertLocalNovel({
      path: "/books/sample.epub",
      name: "Local Book",
      cover: "https://example.test/cover.jpg",
      chapters: [],
    });

    expect(db.execute.mock.calls[0]?.[0]).toBe("BEGIN");
    expect(db.execute.mock.calls[1]?.[1]?.[3]).toBeNull();
    expect(db.execute.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });
});

describe("setNovelInLibrary", () => {
  it("updates in_library and bumps updated_at", async () => {
    const db = stubDb();
    db.execute.mockResolvedValueOnce(undefined);

    await setNovelInLibrary(7, true);

    const [sql, params] = db.execute.mock.calls[0]!;
    expect(sql).toContain("UPDATE novel");
    expect(sql).toContain("in_library = $2");
    expect(sql).toContain("library_added_at");
    expect(sql).toContain("updated_at = unixepoch()");
    expect(params).toEqual([7, 1]);

    const [chapterSql, chapterParams] = db.execute.mock.calls[1]!;
    expect(chapterSql).toContain("UPDATE chapter");
    expect(chapterSql).toContain("found_at");
    expect(chapterParams).toEqual([7]);
  });

  it("can flip the flag back to false", async () => {
    const db = stubDb();
    db.execute.mockResolvedValueOnce(undefined);

    await setNovelInLibrary(7, false);

    const [, params] = db.execute.mock.calls[0]!;
    expect(params).toEqual([7, 0]);
    expect(db.execute).toHaveBeenCalledTimes(1);
  });
});
