import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../http", () => ({
  pluginFetch: vi.fn(),
  pluginFetchText: vi.fn(),
}));
vi.mock("../../db/queries/installed-plugin", () => ({
  upsertInstalledPlugin: vi.fn().mockResolvedValue(undefined),
  deleteInstalledPlugin: vi.fn().mockResolvedValue(undefined),
  listInstalledPlugins: vi.fn().mockResolvedValue([]),
}));

import { pluginFetchText } from "../http";
import {
  PluginManager,
  PluginValidationError,
  isValidPluginItem,
} from "./manager";

const mockedFetchText = vi.mocked(pluginFetchText);

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

describe("PluginManager.uninstallPlugin", () => {
  it("removes a previously installed plugin and reports false on a miss", async () => {
    const manager = new PluginManager();
    mockedFetchText.mockResolvedValueOnce(VALID_PLUGIN_SOURCE);
    await manager.installPlugin(VALID_ITEM);

    expect(manager.uninstallPlugin("demo")).toBe(true);
    expect(manager.has("demo")).toBe(false);
    expect(manager.size()).toBe(0);
    expect(manager.uninstallPlugin("demo")).toBe(false);
  });
});

describe("PluginManager.list", () => {
  it("returns an empty array when nothing is installed", () => {
    expect(new PluginManager().list()).toEqual([]);
  });
});
