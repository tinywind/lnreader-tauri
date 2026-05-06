import { describe, expect, it } from "vitest";
import {
  FilterTypes,
  bytesToUtf8,
  createShimResolver,
  defaultCover,
  isUrlAbsolute,
  parseCsv,
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

describe("parseCsv", () => {
  it("parses quoted CSV rows", () => {
    expect(parseCsv('name,value\n"A, B","one ""two"""')).toEqual([
      ["name", "value"],
      ["A, B", 'one "two"'],
    ]);
  });

  it("maps rows to records when header is enabled", () => {
    expect(parseCsv("name,value\nA,1", { header: true })).toEqual([
      { name: "A", value: "1" },
    ]);
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
    expect(typeof resolve("@libs/archive")).toBe("object");
    expect(typeof resolve("@libs/csv")).toBe("object");
    expect(typeof resolve("@libs/storage")).toBe("object");
    expect(typeof resolve("@libs/pluginInputs")).toBe("object");
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

  it("@libs/pluginInputs reads app-managed plugin input values", () => {
    const values = new Map<string, string>([
      ["plugin:test-plugin:url", "https://komga.test/"],
    ]);
    const storage = {
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
    } as Storage;
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: storage,
    });
    try {
      const lib = resolve("@libs/pluginInputs") as {
        inputs: {
          get(key: string): string | null;
          getAll(): Record<string, string>;
          require(key: string): string;
        };
      };
      expect(lib.inputs.get("url")).toBe("https://komga.test/");
      expect(lib.inputs.getAll()).toEqual({ url: "https://komga.test/" });
      expect(lib.inputs.require("url")).toBe("https://komga.test/");
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  });
});
