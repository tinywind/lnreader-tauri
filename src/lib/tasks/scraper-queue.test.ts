import { describe, expect, it } from "vitest";
import {
  activeScraperExecutor,
  runWithScraperExecutor,
} from "./scraper-queue";

describe("scraper executor context", () => {
  it("tracks the active scraper executor for a source task", async () => {
    const work = runWithScraperExecutor(
      "source-a",
      "task-a",
      "pool:2",
      async () => {
        expect(activeScraperExecutor("source-a")).toBe("pool:2");
      },
    );

    expect(activeScraperExecutor("source-a")).toBe("pool:2");
    await work;
    expect(activeScraperExecutor("source-a")).toBe("immediate");
  });

  it("falls back to the immediate executor outside a source task", () => {
    expect(activeScraperExecutor(undefined)).toBe("immediate");
    expect(activeScraperExecutor("missing")).toBe("immediate");
  });
});
