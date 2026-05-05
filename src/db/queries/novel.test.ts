import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../client";
import { UNCATEGORIZED_CATEGORY_ID } from "./category";
import {
  countNovels,
  getNovelById,
  insertNovel,
  listLibraryNovels,
  setNovelInLibrary,
} from "./novel";

const mockedGetDb = vi.mocked(getDb);

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

  it("appends an unread chapter EXISTS clause when unreadOnly is enabled", async () => {
    const db = stubDb();
    db.select.mockResolvedValueOnce([]);

    await listLibraryNovels({ unreadOnly: true });

    const [sql, params] = db.select.mock.calls[0]!;
    expect(sql).toContain(
      "EXISTS (SELECT 1 FROM chapter uc WHERE uc.novel_id = n.id AND uc.unread = 1)",
    );
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

describe("insertNovel", () => {
  it("uses INSERT OR IGNORE with the 5 expected params in order", async () => {
    const db = stubDb();
    db.execute.mockResolvedValueOnce(undefined);

    await insertNovel({
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

    await insertNovel({
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
  });

  it("can flip the flag back to false", async () => {
    const db = stubDb();
    db.execute.mockResolvedValueOnce(undefined);

    await setNovelInLibrary(7, false);

    const [, params] = db.execute.mock.calls[0]!;
    expect(params).toEqual([7, 0]);
  });
});
