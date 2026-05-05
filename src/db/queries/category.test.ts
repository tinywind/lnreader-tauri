import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../client";
import {
  addNovelsToCategory,
  deleteCategory,
  getLibraryCategoryCounts,
  insertCategory,
  listCategories,
  updateCategory,
} from "./category";

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

describe("listCategories", () => {
  it("orders by sort then name", async () => {
    mockSelect.mockResolvedValueOnce([
      { id: 1, name: "Default", sort: 0, isSystem: 1, novelCount: 3 },
      { id: 2, name: "Reading", sort: 1, isSystem: 0, novelCount: 5 },
    ]);
    const cats = await listCategories();

    const [sql] = mockSelect.mock.calls[0]!;
    expect(sql).toContain("FROM category");
    expect(sql).toContain("COUNT(DISTINCT n.id) AS novelCount");
    expect(sql).toContain("ORDER BY c.sort, c.name");
    expect(cats).toHaveLength(2);
    expect(cats[0]?.isSystem).toBe(true);
    expect(cats[1]?.novelCount).toBe(5);
  });
});

describe("getLibraryCategoryCounts", () => {
  it("returns all and uncategorized library counts", async () => {
    mockSelect
      .mockResolvedValueOnce([{ count: 9 }])
      .mockResolvedValueOnce([{ count: 2 }]);

    const counts = await getLibraryCategoryCounts();

    expect(mockSelect).toHaveBeenCalledTimes(2);
    expect(mockSelect.mock.calls[0]?.[0]).toContain("in_library = 1");
    expect(mockSelect.mock.calls[1]?.[0]).toContain("NOT EXISTS");
    expect(counts).toEqual({ total: 9, uncategorized: 2 });
  });
});

describe("insertCategory", () => {
  it("inserts non-system row with $1 name and $2 sort", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await insertCategory({ name: " Reading ", sort: 5 });

    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).toContain("INSERT INTO category");
    expect(sql).toContain("COALESCE($2");
    expect(sql).toContain("is_system");
    expect(params).toEqual(["Reading", 5]);
  });

  it("appends after the current max sort when sort is not supplied", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await insertCategory({ name: "Plans" });

    const [, params] = mockExecute.mock.calls[0]!;
    expect(params).toEqual(["Plans", null]);
  });

  it("rejects blank names", async () => {
    await expect(insertCategory({ name: "   " })).rejects.toThrow(
      "Category name is required.",
    );
    expect(mockExecute).not.toHaveBeenCalled();
  });
});

describe("updateCategory", () => {
  it("renames manual categories only", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await updateCategory(7, { name: " New Name " });

    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).toContain("UPDATE category");
    expect(sql).toContain("is_system = 0");
    expect(params).toEqual([7, "New Name"]);
  });
});

describe("deleteCategory", () => {
  it("deletes manual categories only", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await deleteCategory(7);

    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).toContain("DELETE FROM category");
    expect(sql).toContain("is_system = 0");
    expect(params).toEqual([7]);
  });
});

describe("addNovelsToCategory", () => {
  it("inserts unique novel-category pairs", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await addNovelsToCategory([3, 3, 4], 8);

    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).toContain("INSERT OR IGNORE INTO novel_category");
    expect(sql).toContain("($1, $2), ($3, $4)");
    expect(params).toEqual([3, 8, 4, 8]);
  });

  it("does nothing when no valid novel ids are provided", async () => {
    await addNovelsToCategory([0, -1], 8);

    expect(mockExecute).not.toHaveBeenCalled();
  });
});
