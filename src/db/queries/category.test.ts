import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../client";
import { insertCategory, listCategories } from "./category";

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
      { id: 1, name: "Default", sort: 0, isSystem: true },
      { id: 2, name: "Reading", sort: 1, isSystem: false },
    ]);
    const cats = await listCategories();

    const [sql] = mockSelect.mock.calls[0]!;
    expect(sql).toContain("FROM category");
    expect(sql).toContain("ORDER BY sort, name");
    expect(cats).toHaveLength(2);
    expect(cats[0]?.isSystem).toBe(true);
  });
});

describe("insertCategory", () => {
  it("inserts non-system row with $1 name and $2 sort", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await insertCategory({ name: "Reading", sort: 5 });

    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).toContain("INSERT INTO category");
    expect(sql).toContain("is_system) VALUES ($1, $2, 0)");
    expect(params).toEqual(["Reading", 5]);
  });

  it("defaults sort to 0 when not supplied", async () => {
    mockExecute.mockResolvedValueOnce(undefined);
    await insertCategory({ name: "Plans" });

    const [, params] = mockExecute.mock.calls[0]!;
    expect(params).toEqual(["Plans", 0]);
  });
});
