import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));

vi.mock("./pack", () => ({
  packBackup: vi.fn(),
}));

vi.mock("./snapshot", () => ({
  applyBackupSnapshot: vi.fn(),
  gatherBackupSnapshot: vi.fn(),
}));

vi.mock("./unpack", () => ({
  unpackBackup: vi.fn(),
}));

import { open, save } from "@tauri-apps/plugin-dialog";
import {
  BACKUP_FORMAT_VERSION,
  type BackupManifest,
} from "./format";
import {
  defaultBackupFilename,
  exportBackupToFile,
  importBackupFromFile,
} from "./io";
import { packBackup } from "./pack";
import {
  applyBackupSnapshot,
  gatherBackupSnapshot,
} from "./snapshot";
import { unpackBackup } from "./unpack";

const openMock = vi.mocked(open);
const saveMock = vi.mocked(save);
const packBackupMock = vi.mocked(packBackup);
const applyBackupSnapshotMock = vi.mocked(applyBackupSnapshot);
const gatherBackupSnapshotMock = vi.mocked(gatherBackupSnapshot);
const unpackBackupMock = vi.mocked(unpackBackup);

function makeManifest(): BackupManifest {
  return {
    version: BACKUP_FORMAT_VERSION,
    exportedAt: 1_700_000_000,
    novels: [],
    chapters: [],
    categories: [],
    novelCategories: [],
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

beforeEach(() => {
  vi.clearAllMocks();
  packBackupMock.mockResolvedValue(undefined);
  applyBackupSnapshotMock.mockResolvedValue(undefined);
});

describe("defaultBackupFilename", () => {
  it("uses the YYYY-MM-DD date as a filename suffix", () => {
    const fixed = new Date("2026-05-05T03:14:15Z");
    expect(defaultBackupFilename(fixed)).toBe("norea-backup-2026-05-05.zip");
  });
});

describe("backup import/export flow", () => {
  it("exports a gathered snapshot to the selected zip path", async () => {
    const manifest = makeManifest();
    saveMock.mockResolvedValue("C:\\backup.zip");
    gatherBackupSnapshotMock.mockResolvedValue(manifest);

    const path = await exportBackupToFile();

    expect(path).toBe("C:\\backup.zip");
    expect(saveMock).toHaveBeenCalledWith({
      defaultPath: expect.stringMatching(
        /^norea-backup-\d{4}-\d{2}-\d{2}\.zip$/,
      ),
      filters: [{ name: "Norea Backup", extensions: ["zip"] }],
    });
    expect(gatherBackupSnapshotMock).toHaveBeenCalledTimes(1);
    expect(packBackupMock).toHaveBeenCalledWith(manifest, "C:\\backup.zip");
  });

  it("skips export work when the save dialog is cancelled", async () => {
    saveMock.mockResolvedValue(null);

    const path = await exportBackupToFile();

    expect(path).toBeNull();
    expect(gatherBackupSnapshotMock).not.toHaveBeenCalled();
    expect(packBackupMock).not.toHaveBeenCalled();
  });

  it("imports the selected zip path into the backup snapshot", async () => {
    const manifest = makeManifest();
    openMock.mockResolvedValue("C:\\backup.zip");
    unpackBackupMock.mockResolvedValue(manifest);

    const path = await importBackupFromFile();

    expect(path).toBe("C:\\backup.zip");
    expect(openMock).toHaveBeenCalledWith({
      multiple: false,
      filters: [{ name: "Norea Backup", extensions: ["zip"] }],
    });
    expect(unpackBackupMock).toHaveBeenCalledWith("C:\\backup.zip");
    expect(applyBackupSnapshotMock).toHaveBeenCalledWith(manifest);
  });

  it("skips import work when the open dialog is cancelled", async () => {
    openMock.mockResolvedValue(null);

    const path = await importBackupFromFile();

    expect(path).toBeNull();
    expect(unpackBackupMock).not.toHaveBeenCalled();
    expect(applyBackupSnapshotMock).not.toHaveBeenCalled();
  });

  it("skips import work when an unexpected array result narrows out", async () => {
    openMock.mockResolvedValue([
      "C:\\unexpected1.zip",
      "C:\\unexpected2.zip",
    ] as never);

    const path = await importBackupFromFile();

    expect(path).toBeNull();
    expect(unpackBackupMock).not.toHaveBeenCalled();
    expect(applyBackupSnapshotMock).not.toHaveBeenCalled();
  });
});
