import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../http", () => ({
  appFetchText: vi.fn(),
  createPluginFetch: vi.fn(() => vi.fn()),
  createPluginFetchShim: vi.fn(() => vi.fn()),
  createPluginFetchText: vi.fn(() => vi.fn()),
  pluginFetch: vi.fn(),
  pluginFetchText: vi.fn(),
  pluginFetchShim: vi.fn(),
}));
vi.mock("../../db/queries/installed-plugin", () => ({
  upsertInstalledPlugin: vi.fn().mockResolvedValue(undefined),
  deleteInstalledPlugin: vi.fn().mockResolvedValue(undefined),
  listInstalledPlugins: vi.fn().mockResolvedValue([]),
}));

import { appFetchText, createPluginFetchShim } from "../http";
import {
  PluginManager,
  PluginValidationError,
  isValidPluginItem,
} from "./manager";

const mockedFetchText = vi.mocked(appFetchText);
const mockedCreateFetchShim = vi.mocked(createPluginFetchShim);

const VALID_ITEM = {
  id: "demo",
  name: "Demo",
  url: "https://example.test/index.js",
  site: "https://example.test",
  lang: "en",
  version: "1.0.0",
  iconUrl: "https://example.test/icon.png",
};

const VALID_PLUGIN_SOURCE = `
  module.exports.default = {
    id: "demo",
    name: "Demo",
    url: "https://example.test/index.js",
    site: "https://example.test",
    lang: "en",
    version: "1.0.0",
    iconUrl: "https://example.test/icon.png",
    popularNovels: () => Promise.resolve([]),
    parseNovel: () => Promise.resolve({ name: "", path: "", chapters: [] }),
    parseChapter: () => Promise.resolve(""),
    searchNovels: () => Promise.resolve([]),
  };
`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isValidPluginItem", () => {
  it("accepts a fully-typed PluginItem", () => {
    expect(isValidPluginItem(VALID_ITEM)).toBe(true);
  });

  it("rejects null / non-object inputs", () => {
    expect(isValidPluginItem(null)).toBe(false);
    expect(isValidPluginItem(undefined)).toBe(false);
    expect(isValidPluginItem("string")).toBe(false);
    expect(isValidPluginItem(42)).toBe(false);
  });

  it("rejects when a required string field is missing", () => {
    const broken = { ...VALID_ITEM } as Record<string, unknown>;
    delete broken.lang;
    expect(isValidPluginItem(broken)).toBe(false);
  });

  it("rejects when a required string field is the wrong type", () => {
    expect(isValidPluginItem({ ...VALID_ITEM, version: 1 })).toBe(false);
  });
});

describe("PluginManager.fetchRepository", () => {
  it("returns valid PluginItems and drops malformed entries", async () => {
    const manager = new PluginManager();
    mockedFetchText.mockResolvedValueOnce(
      JSON.stringify([VALID_ITEM, { id: "broken" }, "junk"]),
    );

    const items = await manager.fetchRepository(
      "https://example.test/repo.json",
    );

    expect(items).toEqual([VALID_ITEM]);
    expect(mockedFetchText).toHaveBeenCalledWith(
      "https://example.test/repo.json",
    );
  });

  it("throws PluginValidationError on non-JSON response", async () => {
    const manager = new PluginManager();
    mockedFetchText.mockResolvedValueOnce("not json");

    await expect(
      manager.fetchRepository("https://example.test/repo.json"),
    ).rejects.toBeInstanceOf(PluginValidationError);
  });

  it("throws PluginValidationError when JSON isn't an array", async () => {
    const manager = new PluginManager();
    mockedFetchText.mockResolvedValueOnce(JSON.stringify({ items: [] }));

    await expect(
      manager.fetchRepository("https://example.test/repo.json"),
    ).rejects.toBeInstanceOf(PluginValidationError);
  });
});

describe("PluginManager.installPlugin", () => {
  it("downloads the plugin, sandbox-loads it, and registers under the id", async () => {
    const manager = new PluginManager();
    mockedFetchText.mockResolvedValueOnce(VALID_PLUGIN_SOURCE);

    const plugin = await manager.installPlugin(VALID_ITEM);

    expect(plugin.id).toBe("demo");
    expect(manager.has("demo")).toBe(true);
    expect(manager.size()).toBe(1);
    expect(manager.getPlugin("demo")).toBe(plugin);
    expect(mockedCreateFetchShim).toHaveBeenCalledWith(VALID_ITEM.site);
  });

  it("throws PluginValidationError when ids don't match", async () => {
    const manager = new PluginManager();
    mockedFetchText.mockResolvedValueOnce(
      VALID_PLUGIN_SOURCE.replace('"demo"', '"other"'),
    );

    await expect(manager.installPlugin(VALID_ITEM)).rejects.toBeInstanceOf(
      PluginValidationError,
    );
    expect(manager.has("demo")).toBe(false);
  });
});

describe("PluginManager.installPluginFromSource", () => {
  it("sandbox-loads a local source and registers under the exported id", async () => {
    const manager = new PluginManager();

    const plugin = await manager.installPluginFromSource(
      VALID_PLUGIN_SOURCE,
      "local:demo.js",
    );

    expect(plugin.id).toBe("demo");
    expect(manager.has("demo")).toBe(true);
    expect(manager.size()).toBe(1);
    expect(manager.getPlugin("demo")).toBe(plugin);
    expect(mockedCreateFetchShim.mock.calls).toEqual([
      [],
      [VALID_ITEM.site],
    ]);
  });

  it("rejects local sources that omit required contract functions", async () => {
    const manager = new PluginManager();
    const missingSearch = VALID_PLUGIN_SOURCE.replace(
      "    searchNovels: () => Promise.resolve([]),\n",
      "",
    );

    await expect(
      manager.installPluginFromSource(missingSearch, "local:broken.js"),
    ).rejects.toBeInstanceOf(PluginValidationError);
    expect(manager.has("demo")).toBe(false);
  });

  it("installs local sources that rely on repository-only metadata", async () => {
    const manager = new PluginManager();
    const repositoryOnlyMetadata = VALID_PLUGIN_SOURCE.replace(
      '    lang: "en",\n',
      "",
    ).replace(
      '    iconUrl: "https://example.test/icon.png",\n',
      "",
    );

    const plugin = await manager.installPluginFromSource(
      repositoryOnlyMetadata,
      "local:demo.js",
    );

    expect(plugin.lang).toBe("local");
    expect(plugin.iconUrl).toBe("");
    expect(manager.has("demo")).toBe(true);
  });
});

describe("PluginManager.uninstallPlugin", () => {
  it("removes a previously installed plugin and reports false on a miss", async () => {
    const values = new Map<string, string>([
      ["plugin:demo:url", "https://komga.test/"],
    ]);
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        get length() {
          return values.size;
        },
        key(index: number) {
          return [...values.keys()][index] ?? null;
        },
        getItem(key: string) {
          return values.get(key) ?? null;
        },
        setItem(key: string, value: string) {
          values.set(key, value);
        },
        removeItem(key: string) {
          values.delete(key);
        },
      } as Storage,
    });
    const manager = new PluginManager();
    mockedFetchText.mockResolvedValueOnce(VALID_PLUGIN_SOURCE);
    await manager.installPlugin(VALID_ITEM);

    try {
      expect(manager.uninstallPlugin("demo")).toBe(true);
      expect(manager.has("demo")).toBe(false);
      expect(manager.size()).toBe(0);
      expect(values.has("plugin:demo:url")).toBe(false);
      expect(manager.uninstallPlugin("demo")).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  });
});

describe("PluginManager.list", () => {
  it("returns an empty array when nothing is installed", () => {
    expect(new PluginManager().list()).toEqual([]);
  });
});
