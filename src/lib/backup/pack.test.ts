import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { BACKUP_FORMAT_VERSION, type BackupManifest } from "./format";
import { packBackup } from "./pack";

const invokeMock = vi.mocked(invoke);

function makeManifest(): BackupManifest {
  return {
    version: BACKUP_FORMAT_VERSION,
    exportedAt: 1_700_000_000,
    novels: [
      {
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
        inLibrary: true,
        isLocal: false,
        createdAt: 1_700_000_000,
        updatedAt: 1_700_000_000,
        libraryAddedAt: 1_700_000_000,
        lastReadAt: null,
      },
    ],
    chapters: [
      {
        id: 10,
        novelId: 1,
        path: "/c/1",
        name: "Chapter 1",
        chapterNumber: "1",
        position: 1,
        page: "1",
        bookmark: false,
        unread: true,
        progress: 0,
        isDownloaded: true,
        contentType: "html",
        content: "<p>downloaded</p>",
        releaseTime: null,
        readAt: null,
        createdAt: 1_700_000_000,
        foundAt: 1_700_000_000,
        updatedAt: 1_700_000_000,
      },
      {
        id: 11,
        novelId: 1,
        path: "/c/2",
        name: "Chapter 2",
        chapterNumber: "2",
        position: 2,
        page: "1",
        bookmark: false,
        unread: true,
        progress: 0,
        isDownloaded: false,
        contentType: "html",
        content: null,
        releaseTime: null,
        readAt: null,
        createdAt: 1_700_000_000,
        foundAt: 1_700_000_000,
        updatedAt: 1_700_000_000,
      },
    ],
    categories: [{ id: 1, name: "Default", sort: 0, isSystem: true }],
    novelCategories: [{ id: 1, novelId: 1, categoryId: 1 }],
    repositories: [],
    installedPlugins: [
      {
        id: "demo",
        name: "Demo",
        site: "https://example.test",
        lang: "en",
        version: "1.0.0",
        iconUrl: "https://example.test/icon.png",
        sourceUrl: "https://example.test/index.js",
        sourceCode: "module.exports.default = {};",
        installedAt: 1_700_000_000,
      },
    ],
    settings: [{ key: "reader-settings", value: "{\"state\":{}}" }],
  };
}

describe("packBackup", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue(undefined);
  });

  it("invokes backup_pack with a lean manifest and split chapter contents", async () => {
    const manifest = makeManifest();
    await packBackup(manifest, "C:\\backup.zip");

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [command, args] = invokeMock.mock.calls[0]!;
    expect(command).toBe("backup_pack");

    const typed = args as {
      manifestJson: string;
      chapters: Array<{ id: number; html: string }>;
      outputPath: string;
    };
    expect(typed.outputPath).toBe("C:\\backup.zip");
    expect(typed.chapters).toEqual([{ id: 10, html: "<p>downloaded</p>" }]);

    const leanManifest = JSON.parse(typed.manifestJson) as BackupManifest;
    expect(leanManifest.chapters[0]?.content).toBeNull();
    expect(leanManifest.chapters[1]?.content).toBeNull();
    expect(leanManifest.novels).toEqual(manifest.novels);
  });

  it("does not mutate the caller's manifest", async () => {
    const manifest = makeManifest();
    const before = JSON.parse(JSON.stringify(manifest));

    await packBackup(manifest, "C:\\backup.zip");

    expect(manifest).toEqual(before);
  });

  it("emits an empty chapter list when nothing is downloaded", async () => {
    const manifest = makeManifest();
    manifest.chapters[0]!.content = null;
    manifest.chapters[0]!.isDownloaded = false;

    await packBackup(manifest, "C:\\backup.zip");

    const [, args] = invokeMock.mock.calls[0]!;
    const typed = args as { chapters: Array<{ id: number; html: string }> };
    expect(typed.chapters).toEqual([]);
  });
});
