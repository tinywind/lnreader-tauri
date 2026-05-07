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
  it("returns the configured repository row", async () => {
    mockSelect.mockResolvedValueOnce([
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
    expect(sql).toContain("ORDER BY id");
    expect(rows).toHaveLength(1);
  });
});

describe("addRepository", () => {
  it("upserts the singleton repository with $1 url + $2 name", async () => {
    mockExecute.mockResolvedValueOnce(undefined);

    await addRepository({
      url: "https://example.test/p.json",
      name: "Demo",
    });

    const [sql, params] = mockExecute.mock.calls[0]!;
    expect(sql).toContain("INSERT INTO repository (id, url, name)");
    expect(sql).toContain("VALUES (1, $1, $2)");
    expect(sql).toContain("ON CONFLICT(id) DO UPDATE");
    expect(params).toEqual(["https://example.test/p.json", "Demo"]);
  });

  it("defaults name to null when not provided", async () => {
    mockExecute.mockResolvedValueOnce(undefined);

    await addRepository({ url: "https://example.test/p.json" });

    const [, params] = mockExecute.mock.calls[0]!;
    expect(params).toEqual(["https://example.test/p.json", null]);
  });

  it("drops cached indexes when the repository is saved", async () => {
    mockExecute.mockResolvedValue(undefined);

    await addRepository({ url: "https://example.test/p.json" });

    const [sql] = mockExecute.mock.calls[1]!;
    expect(sql).toContain("DELETE FROM repository_index_cache");
  });
});

describe("removeRepository", () => {
  it("deletes the cache row before deleting the repository", async () => {
    mockExecute.mockResolvedValue(undefined);

    await removeRepository(42);

    const [cacheSql, cacheParams] = mockExecute.mock.calls[0]!;
    expect(cacheSql).toContain("DELETE FROM repository_index_cache");
    expect(cacheSql).toContain("SELECT url FROM repository WHERE id = $1");
    expect(cacheParams).toEqual([42]);

    const [repoSql, repoParams] = mockExecute.mock.calls[1]!;
    expect(repoSql).toContain("DELETE FROM repository");
    expect(repoSql).toContain("WHERE id = $1");
    expect(repoParams).toEqual([42]);
  });
});
