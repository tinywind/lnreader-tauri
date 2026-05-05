import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/client", () => ({
  getDb: vi.fn(),
}));

import { getDb } from "../../db/client";
import {
  BACKUP_FORMAT_VERSION,
  encodeBackupManifest,
  parseBackupManifest,
} from "./format";
import { applyBackupSnapshot, gatherBackupSnapshot } from "./snapshot";

const mockedGetDb = vi.mocked(getDb);
let mockSelect: ReturnType<typeof vi.fn>;
let mockExecute: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockSelect = vi.fn();
  mockExecute = vi.fn().mockResolvedValue(undefined);
  mockedGetDb.mockResolvedValue({
    select: mockSelect,
    execute: mockExecute,
  } as never);
});

const RAW_NOVEL = {
  id: 1,
  pluginId: "demo",
  path: "/n/1",
  name: "Sample Novel",
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
};

const RAW_CHAPTER = {
  id: 10,
  novelId: 1,
  path: "/c/1",
  name: "Chapter 1",
  chapterNumber: "1",
  position: 1,
  page: "1",
  bookmark: 0,
  unread: 1,
  progress: 0,
  isDownloaded: 1,
  content: "<p>hi</p>",
  releaseTime: null,
  readAt: null,
  createdAt: 1_700_000_000,
  updatedAt: 1_700_000_000,
};

const RAW_CATEGORY = { id: 1, name: "Default", sort: 0, isSystem: 1 };
const NOVEL_CATEGORY = { id: 1, novelId: 1, categoryId: 1 };
const REPOSITORY = {
  id: 1,
  url: "https://example.test/p.json",
  name: "Example",
  addedAt: 1_700_000_000,
};

function primeSelect(): void {
  mockSelect
    .mockResolvedValueOnce([RAW_NOVEL])
    .mockResolvedValueOnce([RAW_CHAPTER])
    .mockResolvedValueOnce([RAW_CATEGORY])
    .mockResolvedValueOnce([NOVEL_CATEGORY])
    .mockResolvedValueOnce([REPOSITORY]);
}

describe("gatherBackupSnapshot", () => {
  it("coerces integer flag columns into strict booleans", async () => {
    primeSelect();
    const manifest = await gatherBackupSnapshot();

    expect(manifest.version).toBe(BACKUP_FORMAT_VERSION);
    expect(manifest.novels[0]?.inLibrary).toBe(true);
    expect(manifest.novels[0]?.isLocal).toBe(false);
    expect(manifest.chapters[0]?.bookmark).toBe(false);
    expect(manifest.chapters[0]?.unread).toBe(true);
    expect(manifest.chapters[0]?.isDownloaded).toBe(true);
    expect(manifest.categories[0]?.isSystem).toBe(true);
  });

  it("calls one SELECT per backup table", async () => {
    primeSelect();
    await gatherBackupSnapshot();

    const sqls = mockSelect.mock.calls.map((call) => call[0] as string);
    expect(sqls).toHaveLength(5);
    expect(sqls.some((s) => /FROM novel\b\s*$/m.test(s))).toBe(true);
    expect(sqls.some((s) => /FROM chapter\b/m.test(s))).toBe(true);
    expect(sqls.some((s) => /FROM category\b/m.test(s))).toBe(true);
    expect(sqls.some((s) => /FROM novel_category\b/m.test(s))).toBe(true);
    expect(sqls.some((s) => /FROM repository\b/m.test(s))).toBe(true);
  });

  it("survives round-trip through encode + parse", async () => {
    primeSelect();
    const manifest = await gatherBackupSnapshot();
    const restored = parseBackupManifest(encodeBackupManifest(manifest));
    expect(restored).toEqual(manifest);
  });
});

describe("applyBackupSnapshot", () => {
  async function gatherForTest() {
    primeSelect();
    return gatherBackupSnapshot();
  }

  it("deletes all 5 tables in dependent-first order", async () => {
    const manifest = parseBackupManifest(
      encodeBackupManifest(await gatherForTest()),
    );

    mockExecute.mockClear();
    await applyBackupSnapshot(manifest);

    const deletes = mockExecute.mock.calls
      .map((call) => call[0] as string)
      .filter((sql) => sql.startsWith("DELETE"));
    expect(deletes).toEqual([
      "DELETE FROM novel_category",
      "DELETE FROM chapter",
      "DELETE FROM novel",
      "DELETE FROM category",
      "DELETE FROM repository",
    ]);
  });

  it("inserts in parent-first order (category, repository, novel, chapter, link)", async () => {
    const manifest = parseBackupManifest(
      encodeBackupManifest(await gatherForTest()),
    );

    mockExecute.mockClear();
    await applyBackupSnapshot(manifest);

    const inserts = mockExecute.mock.calls
      .map((call) => call[0] as string)
      .filter((sql) => sql.includes("INSERT INTO"))
      .map((sql) => {
        const match = /INSERT INTO (\w+)/.exec(sql);
        return match?.[1];
      });
    expect(inserts).toEqual([
      "category",
      "repository",
      "novel",
      "chapter",
      "novel_category",
    ]);
  });
});
