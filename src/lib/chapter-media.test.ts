import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { load } from "cheerio";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
  invoke: vi.fn(),
}));
vi.mock("./http", () => ({
  pluginFetch: vi.fn(),
}));

import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { pluginFetch } from "./http";
import {
  cacheHtmlChapterMedia,
  resolveLocalChapterMedia,
} from "./chapter-media";

const invokeMock = vi.mocked(invoke);
const pluginFetchMock = vi.mocked(pluginFetch);

function installTemplateDocument(): void {
  vi.stubGlobal("document", {
    createElement(tagName: string) {
      if (tagName !== "template") {
        throw new Error(`Unexpected test element: ${tagName}`);
      }

      let $ = load("", null, false);

      return {
        get innerHTML() {
          return $.root().html() ?? "";
        },
        set innerHTML(value: string) {
          $ = load(value, null, false);
        },
        content: {
          querySelectorAll(selector: string) {
            return $(selector)
              .toArray()
              .map((node) => ({
                getAttribute(name: string) {
                  return $(node).attr(name) ?? null;
                },
                removeAttribute(name: string) {
                  $(node).removeAttr(name);
                },
                setAttribute(name: string, value: string) {
                  $(node).attr(name, value);
                },
              }));
          },
        },
      };
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
  installTemplateDocument();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cacheHtmlChapterMedia", () => {
  it("rewrites remote images through the media cache and skips local sources", async () => {
    pluginFetchMock.mockImplementation(async (url) => {
      const contentType = String(url).endsWith(".webp")
        ? "image/webp"
        : "image/png";

      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": contentType },
        status: 200,
        statusText: "OK",
      });
    });
    invokeMock.mockImplementation(async (_command, args) => {
      const input = args as {
        cacheKey: string;
        chapterId: number;
        fileName: string;
      };
      return `norea-media://chapter/${input.chapterId}/${input.cacheKey}/${input.fileName}`;
    });

    const result = await cacheHtmlChapterMedia({
      baseUrl: "https://source.test/novel/chapter/1.html",
      chapterId: 42,
      html: [
        `<img src="../images/page.png">`,
        `<img src="/covers/cover.webp">`,
        `<img src="data:image/png;base64,abc">`,
        `<img src="blob:https://source.test/image">`,
        `<img src="norea-media://chapter/42/old/page.png">`,
        `<img src="file:///tmp/page.png">`,
      ].join(""),
    });

    expect(pluginFetchMock).toHaveBeenCalledTimes(2);
    expect(pluginFetchMock).toHaveBeenNthCalledWith(
      1,
      "https://source.test/novel/images/page.png",
      {
        contextUrl: "https://source.test/novel/chapter/1.html",
        signal: undefined,
      },
    );
    expect(pluginFetchMock).toHaveBeenNthCalledWith(
      2,
      "https://source.test/covers/cover.webp",
      {
        contextUrl: "https://source.test/novel/chapter/1.html",
        signal: undefined,
      },
    );
    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock.mock.calls[0]).toEqual([
      "chapter_media_store",
      expect.objectContaining({
        body: [1, 2, 3],
        chapterId: 42,
        fileName: "page-1.png",
      }),
    ]);
    expect(invokeMock.mock.calls[1]).toEqual([
      "chapter_media_store",
      expect.objectContaining({
        body: [1, 2, 3],
        chapterId: 42,
        fileName: "cover-2.webp",
      }),
    ]);
    expect(result.cacheKey).toEqual(expect.any(String));
    expect(result.html).toContain("norea-media://chapter/");
    expect(result.html).toContain("data:image/png;base64,abc");
    expect(result.html).toContain("blob:https://source.test/image");
    expect(result.html).toContain("norea-media://chapter/42/old/page.png");
    expect(result.html).toContain("file:///tmp/page.png");
  });

  it("rewrites lazy and responsive image sources through the media cache", async () => {
    pluginFetchMock.mockImplementation(async () => {
      return new Response(new Uint8Array([4, 5, 6]), {
        headers: { "content-type": "image/png" },
        status: 200,
        statusText: "OK",
      });
    });
    invokeMock.mockImplementation(async (_command, args) => {
      const input = args as {
        cacheKey: string;
        chapterId: number;
        fileName: string;
      };
      return `norea-media://chapter/${input.chapterId}/${input.cacheKey}/${input.fileName}`;
    });

    const result = await cacheHtmlChapterMedia({
      baseUrl: "https://source.test/topic/1",
      chapterId: 7,
      html: [
        `<img data-src="./lazy.png">`,
        `<img srcset="./small.png 1x, ./large.png 2x">`,
        `<picture>`,
        `<source srcset="/wide.png 800w">`,
        `<img src="/fallback.png">`,
        `</picture>`,
      ].join(""),
    });

    expect(pluginFetchMock).toHaveBeenCalledTimes(5);
    expect(result.html).toContain("norea-media://chapter/7/");
    expect(result.html).not.toContain("data-src=");
    expect(result.html).toContain(" 1x");
    expect(result.html).toContain(" 2x");
    expect(result.html).toContain(" 800w");
  });
});

describe("resolveLocalChapterMedia", () => {
  it("rewrites cached chapter media to Tauri asset URLs", async () => {
    invokeMock.mockImplementation(async (_command, args) => {
      const { mediaSrc } = args as { mediaSrc: string };
      return `/cache/chapter/${mediaSrc.split("/").pop()}`;
    });

    const html = await resolveLocalChapterMedia(
      [
        `<img src="norea-media://chapter/42/cache/page.png">`,
        `<img data-src="norea-media://chapter/42/cache/lazy.png">`,
        `<img srcset="norea-media://chapter/42/cache/small.png 1x, norea-media://chapter/42/cache/large.png 2x">`,
        `<img src="https://source.test/page.png">`,
      ].join(""),
    );

    expect(invokeMock).toHaveBeenCalledWith("chapter_media_path", {
      mediaSrc: "norea-media://chapter/42/cache/page.png",
    });
    expect(convertFileSrc).toHaveBeenCalledWith("/cache/chapter/page.png");
    expect(html).toContain('src="asset:///cache/chapter/page.png"');
    expect(html).toContain('src="asset:///cache/chapter/lazy.png"');
    expect(html).toContain("asset:///cache/chapter/small.png 1x");
    expect(html).toContain("asset:///cache/chapter/large.png 2x");
    expect(html).not.toContain("data-src=");
    expect(html).toContain('src="https://source.test/page.png"');
  });
});
