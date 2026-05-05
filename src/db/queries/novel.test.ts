import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../client";
import {
  countNovels,
  insertNovel,
  listLibraryNovels,
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
  it("filters by in_library=1 and orders by last_read_at then name", async () => {
    const db = stubDb();
    db.select.mockResolvedValueOnce([
      {
        id: 1,
        pluginId: "local",
        path: "p1",
        name: "Sample A",
        cover: null,
        inLibrary: true,
        lastReadAt: 1000,
      },
    ]);

    const rows = await listLibraryNovels();

    expect(db.select).toHaveBeenCalledOnce();
    const [sql] = db.select.mock.calls[0]!;
    expect(sql).toContain("FROM novel");
    expect(sql).toContain("in_library = 1");
    expect(sql).toContain("ORDER BY");
    expect(sql).toContain("last_read_at");
    expect(rows).toEqual([
      {
        id: 1,
        pluginId: "local",
        path: "p1",
        name: "Sample A",
        cover: null,
        inLibrary: true,
        lastReadAt: 1000,
      },
    ]);
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
    expect(params).toEqual(["local", "p1", "Sample", null, true]);
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
      false,
    ]);
  });
});
