import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
  save: vi.fn(),
}));
vi.mock("./snapshot", () => ({
  gatherBackupSnapshot: vi.fn(),
  applyBackupSnapshot: vi.fn(),
}));
vi.mock("./pack", () => ({
  packBackup: vi.fn(),
}));
vi.mock("./unpack", () => ({
  unpackBackup: vi.fn(),
}));

import { open, save } from "@tauri-apps/plugin-dialog";
import {
  defaultBackupFilename,
  exportBackupToFile,
  importBackupFromFile,
} from "./io";
import { packBackup } from "./pack";
import { applyBackupSnapshot, gatherBackupSnapshot } from "./snapshot";
import { unpackBackup } from "./unpack";

const saveMock = vi.mocked(save);
const openMock = vi.mocked(open);
const gatherMock = vi.mocked(gatherBackupSnapshot);
const applyMock = vi.mocked(applyBackupSnapshot);
const packMock = vi.mocked(packBackup);
const unpackMock = vi.mocked(unpackBackup);

const SYNTHETIC_MANIFEST = {
  version: 1 as const,
  exportedAt: 1_700_000_000,
  novels: [],
  chapters: [],
  categories: [],
  novelCategories: [],
  repositories: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("defaultBackupFilename", () => {
  it("uses the YYYY-MM-DD date as a filename suffix", () => {
    const fixed = new Date("2026-05-05T03:14:15Z");
    expect(defaultBackupFilename(fixed)).toBe("lnreader-backup-2026-05-05.zip");
  });
});

describe("exportBackupToFile", () => {
  it("packs the gathered snapshot to the chosen path", async () => {
    saveMock.mockResolvedValue("C:\\out.zip");
    gatherMock.mockResolvedValue(SYNTHETIC_MANIFEST);

    const result = await exportBackupToFile();

    expect(result).toBe("C:\\out.zip");
    expect(gatherMock).toHaveBeenCalledTimes(1);
    expect(packMock).toHaveBeenCalledWith(SYNTHETIC_MANIFEST, "C:\\out.zip");
  });

  it("returns null and skips packing when the dialog is dismissed", async () => {
    saveMock.mockResolvedValue(null);

    const result = await exportBackupToFile();

    expect(result).toBeNull();
    expect(gatherMock).not.toHaveBeenCalled();
    expect(packMock).not.toHaveBeenCalled();
  });
});

describe("importBackupFromFile", () => {
  it("unpacks then applies the chosen file", async () => {
    openMock.mockResolvedValue("C:\\in.zip");
    unpackMock.mockResolvedValue(SYNTHETIC_MANIFEST);

    const result = await importBackupFromFile();

    expect(result).toBe("C:\\in.zip");
    expect(unpackMock).toHaveBeenCalledWith("C:\\in.zip");
    expect(applyMock).toHaveBeenCalledWith(SYNTHETIC_MANIFEST);
  });

  it("returns null when the user cancels", async () => {
    openMock.mockResolvedValue(null);

    const result = await importBackupFromFile();

    expect(result).toBeNull();
    expect(unpackMock).not.toHaveBeenCalled();
    expect(applyMock).not.toHaveBeenCalled();
  });

  it("returns null when an unexpected array result narrows out", async () => {
    openMock.mockResolvedValue([
      "C:\\unexpected1.zip",
      "C:\\unexpected2.zip",
    ] as never);

    const result = await importBackupFromFile();

    expect(result).toBeNull();
    expect(unpackMock).not.toHaveBeenCalled();
  });
});
