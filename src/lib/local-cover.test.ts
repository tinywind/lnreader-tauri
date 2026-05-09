import { describe, expect, it } from "vitest";
import {
  convertLocalCoverFile,
  isLocalCoverSource,
  LOCAL_COVER_LIMITS,
} from "./local-cover";

describe("convertLocalCoverFile", () => {
  it("converts a supported image file to a data URL", async () => {
    const result = await convertLocalCoverFile(
      new File([new Uint8Array([1, 2, 3])], "cover.png", {
        type: "image/png",
      }),
    );

    expect(result).toBe("data:image/png;base64,AQID");
    expect(isLocalCoverSource(result)).toBe(true);
  });

  it("uses the file extension when the MIME type is missing", async () => {
    const result = await convertLocalCoverFile(
      new File([new Uint8Array([1])], "cover.webp"),
    );

    expect(result).toBe("data:image/webp;base64,AQ==");
  });

  it("rejects unsupported image formats", async () => {
    await expect(
      convertLocalCoverFile(
        new File(["x"], "cover.svg", { type: "image/svg+xml" }),
      ),
    ).rejects.toThrow("local cover: unsupported image file");
  });

  it("rejects oversized images", async () => {
    await expect(
      convertLocalCoverFile(
        new File(
          [new Uint8Array(LOCAL_COVER_LIMITS.fileBytes + 1)],
          "cover.jpg",
          { type: "image/jpeg" },
        ),
      ),
    ).rejects.toThrow("local cover: image file is too large");
  });
});
