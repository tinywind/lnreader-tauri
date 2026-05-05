import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../client";
import {
  addRepository,
  listRepositories,
  removeRepository,
} from "./repository";

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

describe("listRepositories", () => {
  it("orders by added_at then id descending", async () => {
    mockSelect.mockResolvedValueOnce([
      { id: 2, url: "https://b.test/index.json", name: null, addedAt: 200 },
      {
        id: 1,
        url: "https://a.test/index.json",
        name: "Alpha",
        addedAt: 100,
      },
    ]);

    const rows = await listRepositories();

    const [sql] = mockSelect.mock.calls[0]!;
    expect(sql).toContain("FROM repository");
    expect(sql).toContain("ORDER BY added_at DESC");
    expect(rows).toHaveLength(2);
  });
});

describe("addRepository", () => {
  it("uses INSERT OR IGNORE with $1 url + $2 name", async () => {
    mockExecute.mockResolvedValueOnce(undefined);

    await addRepository({
      url: "https://example.test/p.json",
      name: "Demo",
    });

    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).toContain("INSERT OR IGNORE INTO repository");
    expect(sql).toContain("(url, name) VALUES ($1, $2)");
    expect(params).toEqual(["https://example.test/p.json", "Demo"]);
  });

  it("defaults name to null when not provided", async () => {
    mockExecute.mockResolvedValueOnce(undefined);

    await addRepository({ url: "https://example.test/p.json" });

    const [, params] = mockExecute.mock.calls[0]!;
    expect(params).toEqual(["https://example.test/p.json", null]);
  });
});

describe("removeRepository", () => {
  it("DELETE WHERE id = $1", async () => {
    mockExecute.mockResolvedValueOnce(undefined);

    await removeRepository(42);

    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).toContain("DELETE FROM repository");
    expect(sql).toContain("WHERE id = $1");
    expect(params).toEqual([42]);
  });
});
