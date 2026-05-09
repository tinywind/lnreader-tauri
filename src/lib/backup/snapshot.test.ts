import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db/client", () => ({
  getDb: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { getDb } from "../../db/client";
import {
  BACKUP_FORMAT_VERSION,
  encodeBackupManifest,
  parseBackupManifest,
} from "./format";
import { applyBackupSnapshot, gatherBackupSnapshot } from "./snapshot";
import { attachBackupChapterMediaFiles } from "./unpack";

const mockedGetDb = vi.mocked(getDb);
const invokeMock = vi.mocked(invoke);
let mockSelect: ReturnType<typeof vi.fn>;
let mockExecute: ReturnType<typeof vi.fn>;
const originalLocalStorageDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "localStorage",
);
const originalWindowDescriptor = Object.getOwnPropertyDescriptor(
  globalThis,
  "window",
);
const originalTauriInternalsDescriptor =
  typeof window === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(window, "__TAURI_INTERNALS__");

beforeEach(() => {
  vi.clearAllMocks();
  mockSelect = vi.fn();
  mockExecute = vi.fn().mockResolvedValue(undefined);
  mockedGetDb.mockResolvedValue({
    select: mockSelect,
    execute: mockExecute,
  } as never);
  invokeMock.mockResolvedValue(undefined);
});

afterEach(() => {
  if (originalLocalStorageDescriptor) {
    Object.defineProperty(
      globalThis,
      "localStorage",
      originalLocalStorageDescriptor,
    );
  } else {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  }
  if (typeof window !== "undefined") {
    if (originalTauriInternalsDescriptor) {
      Object.defineProperty(
        window,
        "__TAURI_INTERNALS__",
        originalTauriInternalsDescriptor,
      );
    } else {
      delete (window as Window & { __TAURI_INTERNALS__?: unknown })
        .__TAURI_INTERNALS__;
    }
  }
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, "window", originalWindowDescriptor);
  } else {
    delete (globalThis as { window?: Window }).window;
  }
});

function installLocalStorage(initial: Record<string, string>): Storage {
  const values = new Map(Object.entries(initial));
  const storage = {
    get length() {
      return values.size;
    },
    clear() {
      values.clear();
    },
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    key(index: number) {
      return [...values.keys()][index] ?? null;
    },
    removeItem(key: string) {
      values.delete(key);
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  } as Storage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: storage,
  });
  return storage;
}

function installTauriRuntime(): void {
  const runtimeWindow =
    typeof window === "undefined"
      ? ({} as Window & { __TAURI_INTERNALS__?: unknown })
      : window;
  if (typeof window === "undefined") {
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: runtimeWindow,
    });
  }
  Object.defineProperty(runtimeWindow, "__TAURI_INTERNALS__", {
    configurable: true,
    value: {},
  });
}

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
  contentType: "html",
  content: "<p>hi</p>",
  releaseTime: null,
  readAt: null,
  createdAt: 1_700_000_000,
  foundAt: 1_700_000_000,
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
const INSTALLED_PLUGIN = {
  id: "demo",
  name: "Demo",
  site: "https://example.test",
  lang: "en",
  version: "1.0.0",
  iconUrl: "https://example.test/icon.png",
  sourceUrl: "https://example.test/index.js",
  sourceCode: "module.exports.default = {};",
  installedAt: 1_700_000_000,
};

function primeSelect(): void {
  mockSelect
    .mockResolvedValueOnce([RAW_NOVEL])
    .mockResolvedValueOnce([RAW_CHAPTER])
    .mockResolvedValueOnce([RAW_CATEGORY])
    .mockResolvedValueOnce([NOVEL_CATEGORY])
    .mockResolvedValueOnce([REPOSITORY])
    .mockResolvedValueOnce([INSTALLED_PLUGIN]);
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
    expect(manifest.chapters[0]?.contentType).toBe("html");
    expect(manifest.categories[0]?.isSystem).toBe(true);
  });

  it("calls one SELECT per backup table", async () => {
    primeSelect();
    await gatherBackupSnapshot();

    const sqls = mockSelect.mock.calls.map((call) => call[0] as string);
    expect(sqls).toHaveLength(6);
    expect(sqls.some((s) => /FROM novel\b\s*$/m.test(s))).toBe(true);
    expect(sqls.some((s) => /FROM chapter\b/m.test(s))).toBe(true);
    expect(sqls.some((s) => /FROM category\b/m.test(s))).toBe(true);
    expect(sqls.some((s) => /FROM novel_category\b/m.test(s))).toBe(true);
    expect(sqls.some((s) => /FROM repository\b/m.test(s))).toBe(true);
    expect(sqls.some((s) => /FROM installed_plugin\b/m.test(s))).toBe(true);
  });

  it("survives round-trip through encode + parse", async () => {
    primeSelect();
    const manifest = await gatherBackupSnapshot();
    const restored = parseBackupManifest(encodeBackupManifest(manifest));
    expect(restored).toEqual(manifest);
  });

  it("includes app and plugin settings from localStorage", async () => {
    installLocalStorage({
      "app-appearance-settings": "{\"state\":{\"themeMode\":\"dark\"}}",
      "plugin:demo:token": "secret",
      "source-filters:demo": "{\"filters\":{}}",
      unrelated: "skip",
    });
    primeSelect();

    const manifest = await gatherBackupSnapshot();

    expect(manifest.settings).toEqual([
      {
        key: "app-appearance-settings",
        value: "{\"state\":{\"themeMode\":\"dark\"}}",
      },
      { key: "plugin:demo:token", value: "secret" },
      { key: "source-filters:demo", value: "{\"filters\":{}}" },
    ]);
  });
});

describe("applyBackupSnapshot", () => {
  async function gatherForTest() {
    primeSelect();
    return gatherBackupSnapshot();
  }

  it("deletes backup tables in dependent-first order", async () => {
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
      "DELETE FROM novel_stats",
      "DELETE FROM novel",
      "DELETE FROM category",
      "DELETE FROM repository",
      "DELETE FROM repository_index_cache",
      "DELETE FROM installed_plugin",
    ]);
  });

  it("wraps database restore in a transaction", async () => {
    const manifest = parseBackupManifest(
      encodeBackupManifest(await gatherForTest()),
    );

    mockExecute.mockClear();
    await applyBackupSnapshot(manifest);

    const sqls = mockExecute.mock.calls.map((call) => call[0] as string);
    expect(sqls[0]).toBe("BEGIN IMMEDIATE");
    expect(sqls.at(-1)).toBe("COMMIT");
    expect(sqls).not.toContain("ROLLBACK");
  });

  it("inserts in parent-first order", async () => {
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
      "installed_plugin",
      "novel",
      "chapter",
      "novel_category",
    ]);
  });

  it("restores installed plugin source rows", async () => {
    const manifest = parseBackupManifest(
      encodeBackupManifest(await gatherForTest()),
    );

    mockExecute.mockClear();
    await applyBackupSnapshot(manifest);

    const pluginInsert = mockExecute.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO installed_plugin"),
    );
    expect(pluginInsert?.[1]).toEqual([
      "demo",
      "Demo",
      "https://example.test",
      "en",
      "1.0.0",
      "https://example.test/icon.png",
      "https://example.test/index.js",
      "module.exports.default = {};",
      1_700_000_000,
    ]);
  });

  it("restores backed up settings without touching unrelated localStorage", async () => {
    const storage = installLocalStorage({
      "app-appearance-settings": "old",
      "plugin:demo:token": "old-token",
      unrelated: "keep",
    });
    const manifest = parseBackupManifest(
      encodeBackupManifest({
        ...(await gatherForTest()),
        settings: [
          { key: "app-appearance-settings", value: "new" },
          { key: "plugin:demo:token", value: "new-token" },
        ],
      }),
    );

    mockExecute.mockClear();
    await applyBackupSnapshot(manifest);

    expect(storage.getItem("app-appearance-settings")).toBe("new");
    expect(storage.getItem("plugin:demo:token")).toBe("new-token");
    expect(storage.getItem("unrelated")).toBe("keep");
  });

  it("rolls back and leaves settings unchanged when database restore fails", async () => {
    const storage = installLocalStorage({
      "app-appearance-settings": "old",
      unrelated: "keep",
    });
    const manifest = parseBackupManifest(
      encodeBackupManifest({
        ...(await gatherForTest()),
        settings: [{ key: "app-appearance-settings", value: "new" }],
      }),
    );
    const failure = new Error("restore failed");

    mockExecute.mockReset();
    mockExecute.mockImplementation((sql: string) => {
      if (sql.includes("INSERT INTO novel (")) {
        return Promise.reject(failure);
      }
      return Promise.resolve(undefined);
    });

    await expect(applyBackupSnapshot(manifest)).rejects.toThrow(failure);

    const sqls = mockExecute.mock.calls.map((call) => call[0] as string);
    expect(sqls[0]).toBe("BEGIN IMMEDIATE");
    expect(sqls).toContain("ROLLBACK");
    expect(sqls).not.toContain("COMMIT");
    expect(storage.getItem("app-appearance-settings")).toBe("old");
    expect(storage.getItem("unrelated")).toBe("keep");
  });

  it("restores downloaded chapter byte counts from content", async () => {
    const manifest = parseBackupManifest(
      encodeBackupManifest(await gatherForTest()),
    );

    mockExecute.mockClear();
    await applyBackupSnapshot(manifest);

    const chapterInsert = mockExecute.mock.calls.find(([sql]) =>
      String(sql).includes("INSERT INTO chapter"),
    );
    expect(chapterInsert?.[1]).toContain(9);
  });

  it("restores only the newest repository as the singleton row", async () => {
    const manifest = parseBackupManifest(
      encodeBackupManifest({
        ...(await gatherForTest()),
        repositories: [
          {
            id: 2,
            url: "https://old.example.test/p.json",
            name: "Old",
            addedAt: 1_600_000_000,
          },
          {
            id: 3,
            url: "https://new.example.test/p.json",
            name: "New",
            addedAt: 1_700_000_000,
          },
        ],
      }),
    );

    mockExecute.mockClear();
    await applyBackupSnapshot(manifest);

    const repositoryInserts = mockExecute.mock.calls.filter(([sql]) =>
      String(sql).includes("INSERT INTO repository"),
    );
    expect(repositoryInserts).toHaveLength(1);
    expect(repositoryInserts[0]?.[1]).toEqual([
      1,
      "https://new.example.test/p.json",
      "New",
      1_700_000_000,
    ]);
  });

  it("restores chapter media files attached by unpack", async () => {
    installTauriRuntime();
    const manifest = attachBackupChapterMediaFiles(
      parseBackupManifest(encodeBackupManifest(await gatherForTest())),
      [
        {
          mediaSrc: "norea-media://chapter/10/cache/image.png",
          body: [1, 2, 3],
        },
      ],
    );

    mockExecute.mockClear();
    await applyBackupSnapshot(manifest);

    expect(invokeMock).toHaveBeenCalledWith("chapter_media_clear_all");
    expect(invokeMock).toHaveBeenCalledWith("chapter_media_store", {
      body: [1, 2, 3],
      cacheKey: "cache",
      chapterId: 10,
      fileName: "image.png",
    });
  });
});
