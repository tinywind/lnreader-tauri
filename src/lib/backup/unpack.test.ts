import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  BACKUP_FORMAT_VERSION,
  BackupFormatError,
  encodeBackupManifest,
  type BackupManifest,
} from "./format";
import { unpackBackup } from "./unpack";

const invokeMock = vi.mocked(invoke);

function makeLeanManifest(): BackupManifest {
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
        content: null,
        releaseTime: null,
        readAt: null,
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
        content: null,
        releaseTime: null,
        readAt: null,
        updatedAt: 1_700_000_000,
      },
    ],
    categories: [{ id: 1, name: "Default", sort: 0, isSystem: true }],
    novelCategories: [{ id: 1, novelId: 1, categoryId: 1 }],
    repositories: [],
  };
}

describe("unpackBackup", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("re-injects chapter HTML into matching chapter rows", async () => {
    const lean = makeLeanManifest();
    invokeMock.mockResolvedValue({
      manifest_json: encodeBackupManifest(lean),
      chapters: [{ id: 10, html: "<p>downloaded</p>" }],
    });

    const restored = await unpackBackup("C:\\backup.zip");

    expect(invokeMock).toHaveBeenCalledWith("backup_unpack", {
      inputPath: "C:\\backup.zip",
    });
    expect(restored.chapters[0]?.content).toBe("<p>downloaded</p>");
    expect(restored.chapters[1]?.content).toBeNull();
    expect(restored.novels).toEqual(lean.novels);
  });

  it("leaves chapters with no matching entry untouched", async () => {
    const lean = makeLeanManifest();
    invokeMock.mockResolvedValue({
      manifest_json: encodeBackupManifest(lean),
      chapters: [],
    });

    const restored = await unpackBackup("C:\\empty.zip");
    expect(restored.chapters[0]?.content).toBeNull();
    expect(restored.chapters[1]?.content).toBeNull();
  });

  it("propagates BackupFormatError on a malformed envelope", async () => {
    invokeMock.mockResolvedValue({
      manifest_json: "{ not valid json",
      chapters: [],
    });

    await expect(unpackBackup("C:\\bad.zip")).rejects.toBeInstanceOf(
      BackupFormatError,
    );
  });
});
