import { describe, expect, it } from "vitest";
import {
  FilterTypes,
  bytesToUtf8,
  createShimResolver,
  defaultCover,
  isUrlAbsolute,
  utf8ToBytes,
} from "./shims";
import { NovelStatus } from "./types";

describe("FilterTypes", () => {
  it("matches the upstream string discriminators", () => {
    expect(FilterTypes).toEqual({
      TextInput: "Text",
      Picker: "Picker",
      CheckboxGroup: "Checkbox",
      Switch: "Switch",
      ExcludableCheckboxGroup: "XCheckbox",
    });
  });
});

describe("isUrlAbsolute", () => {
  it("returns true for http/https URLs", () => {
    expect(isUrlAbsolute("https://example.com/x")).toBe(true);
    expect(isUrlAbsolute("http://example.com/x")).toBe(true);
  });

  it("returns true for any custom scheme", () => {
    expect(isUrlAbsolute("data:text/plain,hi")).toBe(true);
    expect(isUrlAbsolute("lnreader://repo/add")).toBe(true);
  });

  it("returns false for relative paths", () => {
    expect(isUrlAbsolute("/foo/bar")).toBe(false);
    expect(isUrlAbsolute("./relative")).toBe(false);
    expect(isUrlAbsolute("plain")).toBe(false);
  });
});

describe("utf8ToBytes / bytesToUtf8", () => {
  it("round-trips ASCII", () => {
    expect(bytesToUtf8(utf8ToBytes("hello"))).toBe("hello");
  });

  it("round-trips multibyte text", () => {
    const input = "hello \u2603";
    expect(bytesToUtf8(utf8ToBytes(input))).toBe(input);
  });
});

describe("defaultCover", () => {
  it("is a placeholder image URL", () => {
    expect(defaultCover).toMatch(/^https:\/\//);
  });
});

describe("createShimResolver", () => {
  const resolve = createShimResolver("test-plugin");

  it("resolves the upstream-whitelisted module ids", () => {
    expect(typeof resolve("htmlparser2")).toBe("object");
    expect(typeof resolve("cheerio")).toBe("object");
    expect(typeof resolve("dayjs")).toBe("function");
    expect(typeof resolve("urlencode")).toBe("object");
    expect(typeof resolve("@libs/fetch")).toBe("object");
    expect(resolve("@libs/novelStatus")).toEqual({ NovelStatus });
    expect(resolve("@libs/filterInputs")).toEqual({ FilterTypes });
    expect(typeof resolve("@libs/defaultCover")).toBe("object");
    expect(typeof resolve("@libs/isAbsoluteUrl")).toBe("object");
    expect(typeof resolve("@libs/utils")).toBe("object");
    expect(typeof resolve("@libs/storage")).toBe("object");
  });

  it("throws for any module outside the whitelist", () => {
    expect(() => resolve("fs")).toThrow(/whitelisted/);
    expect(() => resolve("react")).toThrow(/whitelisted/);
    expect(() => resolve("@libs/cookies")).toThrow(/whitelisted/);
  });

  it("@libs/fetch surfaces the host fetch wrappers", () => {
    const lib = resolve("@libs/fetch") as {
      fetchApi: unknown;
      fetchText: unknown;
      fetchProto: unknown;
    };
    expect(typeof lib.fetchApi).toBe("function");
    expect(typeof lib.fetchText).toBe("function");
    expect(typeof lib.fetchProto).toBe("function");
  });
});
