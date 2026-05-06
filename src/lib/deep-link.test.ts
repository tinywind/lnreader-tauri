import { describe, expect, it } from "vitest";
import { parseDeepLink } from "./deep-link";

describe("parseDeepLink", () => {
  it("parses norea://repo/add?url=<...> as repo-add", () => {
    const result = parseDeepLink(
      "norea://repo/add?url=https%3A%2F%2Fexample.test%2Fp.json",
    );
    expect(result).toEqual({
      kind: "repo-add",
      repoUrl: "https://example.test/p.json",
    });
  });

  it("trims surrounding whitespace in the url query param", () => {
    const result = parseDeepLink(
      "norea://repo/add?url=%20https%3A%2F%2Fexample.test%2Fp.json%20",
    );
    expect(result).toEqual({
      kind: "repo-add",
      repoUrl: "https://example.test/p.json",
    });
  });

  it("returns unknown when the url query param is missing", () => {
    const raw = "norea://repo/add";
    expect(parseDeepLink(raw)).toEqual({ kind: "unknown", raw });
  });

  it("returns unknown when the url query param is empty", () => {
    const raw = "norea://repo/add?url=";
    expect(parseDeepLink(raw)).toEqual({ kind: "unknown", raw });
  });

  it("returns unknown for non-matching paths under repo", () => {
    const raw = "norea://repo/wrong?url=https://example.test/p.json";
    expect(parseDeepLink(raw)).toEqual({ kind: "unknown", raw });
  });

  it("returns unknown for the wrong scheme", () => {
    const raw = "https://repo/add?url=https://example.test/p.json";
    expect(parseDeepLink(raw)).toEqual({ kind: "unknown", raw });
  });

  it("returns unknown for unparseable input", () => {
    const raw = "not a url";
    expect(parseDeepLink(raw)).toEqual({ kind: "unknown", raw });
  });
});
