import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { load } from "cheerio";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
vi.mock("./http", () => ({
  pluginMediaFetch: vi.fn(),
}));
vi.mock("../db/queries/chapter", () => ({
  getChapterById: vi.fn(),
}));
vi.mock("../db/queries/novel", () => ({
  getNovelById: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import { pluginMediaFetch } from "./http";
import {
  cacheHtmlChapterMedia,
  getStoredChapterMediaBytes,
  localChapterMediaSources,
  resolveLocalChapterMedia,
} from "./chapter-media";

const invokeMock = vi.mocked(invoke);
const pluginMediaFetchMock = vi.mocked(pluginMediaFetch);

function installTemplateDocument(): void {
  vi.stubGlobal("document", {
    createElement(tagName: string) {
      if (tagName !== "template") {
        throw new Error(`Unexpected test element: ${tagName}`);
      }

      let $ = load("", null, false);
      let wrappers = new Map<object, Element>();
      const asCheerioInput = (node: object): Parameters<typeof $>[0] =>
        node as Parameters<typeof $>[0];
      const wrap = (node: object | undefined): Element | null => {
        if (!node) return null;
        const existing = wrappers.get(node);
        if (existing) return existing;
        const element = {
          get tagName() {
            return (
              (node as { name?: string; tagName?: string }).tagName ??
              (node as { name?: string }).name ??
              ""
            );
          },
          get parentElement() {
            return wrap((node as { parent?: object }).parent);
          },
          getAttribute(name: string) {
            return $(asCheerioInput(node)).attr(name) ?? null;
          },
          hasAttribute(name: string) {
            return $(asCheerioInput(node)).attr(name) !== undefined;
          },
          querySelector(selector: string) {
            return wrap(
              $(asCheerioInput(node)).find(selector).get(0) as
                | object
                | undefined,
            );
          },
          removeAttribute(name: string) {
            $(asCheerioInput(node)).removeAttr(name);
          },
          setAttribute(name: string, value: string) {
            $(asCheerioInput(node)).attr(name, value);
          },
        } as Element;
        wrappers.set(node, element);
        return element;
      };

      return {
        get innerHTML() {
          return $.root().html() ?? "";
        },
        set innerHTML(value: string) {
          $ = load(value, null, false);
          wrappers = new Map<object, Element>();
        },
        content: {
          querySelectorAll(selector: string) {
            return $(selector)
              .toArray()
              .map((node) => wrap(node))
              .filter((node): node is Element => node !== null);
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
    pluginMediaFetchMock.mockImplementation(async (url) => {
      const contentType = String(url).endsWith(".webp")
        ? "image/webp"
        : "image/png";

      return new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": contentType },
        status: 200,
        statusText: "OK",
      });
    });
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "chapter_media_archive_cache") return 6;
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
      chapterName: "Opening",
      chapterNumber: "1",
      chapterPosition: 1,
      html: [
        `<img src="../images/page.png">`,
        `<img src="/covers/cover.webp">`,
        `<img src="data:image/png;base64,abc">`,
        `<img src="blob:https://source.test/image">`,
        `<img src="norea-media://chapter/42/old/page.png">`,
        `<img src="file:///tmp/page.png">`,
      ].join(""),
      novelId: 9,
      novelName: "Sample Novel",
      novelPath: "/novel/sample",
      sourceId: "demo",
    });

    expect(pluginMediaFetchMock).toHaveBeenCalledTimes(2);
    expect(pluginMediaFetchMock).toHaveBeenNthCalledWith(
      1,
      "https://source.test/novel/images/page.png",
      expect.objectContaining({
        contextUrl: "https://source.test/novel/chapter/1.html",
        headers: expect.objectContaining({ Accept: expect.any(String) }),
        signal: undefined,
        sourceId: "demo",
      }),
    );
    expect(pluginMediaFetchMock).toHaveBeenNthCalledWith(
      2,
      "https://source.test/covers/cover.webp",
      expect.objectContaining({
        contextUrl: "https://source.test/novel/chapter/1.html",
        headers: expect.objectContaining({ Accept: expect.any(String) }),
        signal: undefined,
        sourceId: "demo",
      }),
    );
    expect(invokeMock).toHaveBeenCalledTimes(3);
    expect(invokeMock.mock.calls[0]).toEqual([
      "chapter_media_store",
      expect.objectContaining({
        body: [1, 2, 3],
        chapterId: 42,
        chapterName: "Opening",
        chapterNumber: "1",
        chapterPosition: 1,
        fileName: expect.stringMatching(/^0001-page-[0-9a-f]{8}\.png$/),
        novelId: 9,
        novelName: "Sample Novel",
        novelPath: "/novel/sample",
        sourceUrl: "https://source.test/novel/images/page.png",
        sourceId: "demo",
      }),
    ]);
    expect(invokeMock.mock.calls[1]).toEqual([
      "chapter_media_store",
      expect.objectContaining({
        body: [1, 2, 3],
        chapterId: 42,
        chapterName: "Opening",
        chapterNumber: "1",
        chapterPosition: 1,
        fileName: expect.stringMatching(/^0002-cover-[0-9a-f]{8}\.webp$/),
        novelId: 9,
        novelName: "Sample Novel",
        novelPath: "/novel/sample",
        sourceUrl: "https://source.test/covers/cover.webp",
        sourceId: "demo",
      }),
    ]);
    expect(invokeMock).toHaveBeenCalledWith(
      "chapter_media_archive_cache",
      expect.objectContaining({
        chapterId: 42,
        chapterName: "Opening",
        chapterNumber: "1",
        chapterPosition: 1,
        novelId: 9,
        novelName: "Sample Novel",
        novelPath: "/novel/sample",
        sourceId: "demo",
      }),
    );
    expect(result.cacheKey).toEqual(expect.any(String));
    expect(result.mediaBytes).toBe(6);
    expect(result.html).toContain("norea-media://chapter/");
    expect(result.html).toContain("data:image/png;base64,abc");
    expect(result.html).toContain("blob:https://source.test/image");
    expect(result.html).toContain("norea-media://chapter/42/old/page.png");
    expect(result.html).toContain("file:///tmp/page.png");
  });

  it("rewrites lazy and responsive image sources through the media cache", async () => {
    pluginMediaFetchMock.mockImplementation(async () => {
      return new Response(new Uint8Array([4, 5, 6]), {
        headers: { "content-type": "image/png" },
        status: 200,
        statusText: "OK",
      });
    });
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "chapter_media_archive_cache") return 15;
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

    expect(pluginMediaFetchMock).toHaveBeenCalledTimes(5);
    expect(result.mediaBytes).toBe(15);
    expect(result.html).toContain("norea-media://chapter/7/");
    expect(result.html).not.toContain("data-src=");
    expect(result.html).toContain(" 1x");
    expect(result.html).toContain(" 2x");
    expect(result.html).toContain(" 800w");
  });

  it("rewrites external media attributes and style urls through the media cache", async () => {
    pluginMediaFetchMock.mockImplementation(async (url) => {
      const contentType = String(url).endsWith(".mp4")
        ? "video/mp4"
        : "image/png";

      return new Response(new Uint8Array([8, 9]), {
        headers: { "content-type": contentType },
        status: 200,
        statusText: "OK",
      });
    });
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "chapter_media_archive_cache") return 10;
      const input = args as {
        cacheKey: string;
        chapterId: number;
        fileName: string;
      };
      return `norea-media://chapter/${input.chapterId}/${input.cacheKey}/${input.fileName}`;
    });

    const result = await cacheHtmlChapterMedia({
      baseUrl: "https://source.test/topic/1",
      chapterId: 13,
      html: [
        `<video poster="./poster.png"></video>`,
        `<object data="./panel.svg"></object>`,
        `<embed src="./clip.mp4">`,
        `<link rel="preload" as="image" href="./preload.png">`,
        `<div style="background-image:url('./background.png');"></div>`,
      ].join(""),
    });

    expect(pluginMediaFetchMock).toHaveBeenCalledTimes(5);
    expect(pluginMediaFetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://source.test/topic/poster.png",
      "https://source.test/topic/panel.svg",
      "https://source.test/topic/clip.mp4",
      "https://source.test/topic/preload.png",
      "https://source.test/topic/background.png",
    ]);
    expect(result.mediaBytes).toBe(10);
    expect(result.html).toContain("norea-media://chapter/13/");
    expect(result.html).toContain("poster=");
    expect(result.html).toContain("data=");
    expect(result.html).toContain("href=");
    expect(result.html).not.toContain("https://source.test/topic/poster.png");
    expect(result.html).not.toContain("https://source.test/topic/background.png");
  });

  it("emits blank media markup before progressively restoring local sources", async () => {
    pluginMediaFetchMock.mockImplementation(async () => {
      return new Response(new Uint8Array([7, 8, 9]), {
        headers: { "content-type": "image/png" },
        status: 200,
        statusText: "OK",
      });
    });
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "chapter_media_archive_cache") return 6;
      const input = args as {
        cacheKey: string;
        chapterId: number;
        fileName: string;
      };
      return `norea-media://chapter/${input.chapterId}/${input.cacheKey}/${input.fileName}`;
    });
    const htmlUpdates: string[] = [];
    const mediaPatches: Array<
      Array<{ attributes: Record<string, string>; index: number }>
    > = [];

    await cacheHtmlChapterMedia({
      baseUrl: "https://source.test/topic/1",
      chapterId: 7,
      html: `<img src="./page.png"><video src="./clip.png"></video>`,
      onHtmlUpdate: (html) => {
        htmlUpdates.push(html);
      },
      onMediaPatch: (patches) => {
        mediaPatches.push(patches);
      },
    });

    expect(htmlUpdates).toHaveLength(1);
    expect(htmlUpdates[0]).toContain('src=""');
    expect(htmlUpdates[0]).not.toContain("norea-media://chapter/7/");
    expect(mediaPatches).toHaveLength(3);
    expect(mediaPatches[0]).toEqual([
      expect.objectContaining({
        attributes: expect.objectContaining({
          src: expect.stringMatching(
            /^norea-media:\/\/chapter\/7\/[^/]+\/0001-page-[0-9a-f]{8}\.png$/,
          ),
        }),
        index: 0,
      }),
    ]);
    expect(mediaPatches[1]).toEqual([
      expect.objectContaining({
        attributes: expect.objectContaining({
          src: expect.stringMatching(
            /^norea-media:\/\/chapter\/7\/[^/]+\/0002-clip-[0-9a-f]{8}\.png$/,
          ),
        }),
        index: 1,
      }),
    ]);
    expect(mediaPatches[2]).toHaveLength(2);
  });

  it("reuses stored local media when resuming a partial HTML download", async () => {
    pluginMediaFetchMock.mockImplementation(async () => {
      return new Response(new Uint8Array([4, 5]), {
        headers: { "content-type": "image/png" },
        status: 200,
        statusText: "OK",
      });
    });
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "chapter_media_total_size") return 7;
      if (command === "chapter_media_archive_cache") return 5;
      const input = args as {
        cacheKey: string;
        chapterId: number;
        fileName: string;
      };
      return `norea-media://chapter/${input.chapterId}/${input.cacheKey}/${input.fileName}`;
    });

    const result = await cacheHtmlChapterMedia({
      baseUrl: "https://source.test/chapter/1",
      chapterId: 42,
      html: `<img src="/page-1.png"><img src="/page-2.png">`,
      previousHtml: [
        `<img src="norea-media://chapter/42/old/page-1.png">`,
        `<img src="">`,
      ].join(""),
    });

    expect(pluginMediaFetchMock).toHaveBeenCalledTimes(1);
    expect(pluginMediaFetchMock).toHaveBeenCalledWith(
      "https://source.test/page-2.png",
      expect.objectContaining({
        contextUrl: "https://source.test/chapter/1",
        headers: expect.objectContaining({ Accept: expect.any(String) }),
        signal: undefined,
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      "chapter_media_store",
      expect.objectContaining({
        cacheKey: "old",
        fileName: expect.stringMatching(/^0002-page-2-[0-9a-f]{8}\.png$/),
        sourceUrl: "https://source.test/page-2.png",
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith("chapter_media_archive_cache", {
      cacheKey: "old",
      chapterId: 42,
    });
    expect(result.cacheKey).toBe("old");
    expect(result.mediaBytes).toBe(5);
    expect(result.html).toContain("norea-media://chapter/42/old/page-1.png");
    expect(result.html).toMatch(
      /norea-media:\/\/chapter\/42\/old\/0002-page-2-[0-9a-f]{8}\.png/,
    );
    expect(result.html).not.toContain("data-norea-media-source-url");
  });

  it("refetches reusable media when the stored local file is missing", async () => {
    pluginMediaFetchMock.mockImplementation(async () => {
      return new Response(new Uint8Array([4, 5]), {
        headers: { "content-type": "image/png" },
        status: 200,
        statusText: "OK",
      });
    });
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "chapter_media_total_size") return 0;
      if (command === "chapter_media_archive_cache") return 5;
      const input = args as {
        cacheKey: string;
        chapterId: number;
        fileName: string;
      };
      return `norea-media://chapter/${input.chapterId}/${input.cacheKey}/${input.fileName}`;
    });

    const result = await cacheHtmlChapterMedia({
      baseUrl: "https://source.test/chapter/1",
      chapterId: 42,
      html: `<img src="/page-1.png">`,
      previousHtml: `<img src="norea-media://chapter/42/old/page-1.png">`,
    });

    expect(pluginMediaFetchMock).toHaveBeenCalledTimes(1);
    expect(pluginMediaFetchMock).toHaveBeenCalledWith(
      "https://source.test/page-1.png",
      expect.objectContaining({
        contextUrl: "https://source.test/chapter/1",
        headers: expect.objectContaining({ Accept: expect.any(String) }),
        signal: undefined,
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      "chapter_media_store",
      expect.objectContaining({
        fileName: expect.stringMatching(/^0001-page-1-[0-9a-f]{8}\.png$/),
        sourceUrl: "https://source.test/page-1.png",
      }),
    );
    expect(result.cacheKey).not.toBe("old");
    expect(result.html).not.toContain("norea-media://chapter/42/old/page-1.png");
    expect(result.html).toContain("norea-media://chapter/42/");
  });
});

describe("stored chapter media byte stats", () => {
  it("deduplicates local media refs before measuring stored files", async () => {
    invokeMock.mockResolvedValueOnce(7);

    const html = [
      `<img src="norea-media://chapter/42/cache/page.png">`,
      `<img data-src="norea-media://chapter/42/cache/page.png">`,
      `<img src="https://source.test/page.png">`,
    ].join("");

    expect(localChapterMediaSources(html)).toEqual([
      "norea-media://chapter/42/cache/page.png",
    ]);
    await expect(getStoredChapterMediaBytes(html)).resolves.toBe(7);
    expect(invokeMock).toHaveBeenCalledWith("chapter_media_total_size", {
      mediaSrcs: ["norea-media://chapter/42/cache/page.png"],
    });
  });
});

describe("resolveLocalChapterMedia", () => {
  it("rewrites cached chapter media to local data URLs", async () => {
    invokeMock.mockImplementation(async (_command, args) => {
      const { mediaSrc } = args as { mediaSrc: string };
      return `data:image/png;base64,${mediaSrc.split("/").pop()}`;
    });

    const html = await resolveLocalChapterMedia(
      [
        `<img src="norea-media://chapter/42/cache/page.png">`,
        `<img data-src="norea-media://chapter/42/cache/lazy.png">`,
        [
          `<img srcset="norea-media://chapter/42/cache/small.png 1x, `,
          `norea-media://chapter/42/cache/large.png 2x">`,
        ].join(""),
        `<video poster="norea-media://chapter/42/cache/poster.png"></video>`,
        `<object data="norea-media://chapter/42/cache/panel.svg"></object>`,
        `<link rel="preload" as="image" href="norea-media://chapter/42/cache/preload.png">`,
        `<div style="background-image:url('norea-media://chapter/42/cache/bg.png')"></div>`,
        `<img src="https://source.test/page.png">`,
      ].join(""),
    );

    expect(invokeMock).toHaveBeenCalledWith("chapter_media_data_url", {
      mediaSrc: "norea-media://chapter/42/cache/page.png",
    });
    expect(html).toContain('src="data:image/png;base64,page.png"');
    expect(html).toContain('src="data:image/png;base64,lazy.png"');
    expect(html).toContain("data:image/png;base64,small.png 1x");
    expect(html).toContain("data:image/png;base64,large.png 2x");
    expect(html).toContain('poster="data:image/png;base64,poster.png"');
    expect(html).toContain('data="data:image/png;base64,panel.svg"');
    expect(html).toContain('href="data:image/png;base64,preload.png"');
    expect(html).toContain("data:image/png;base64,bg.png");
    expect(html).not.toContain("data-src=");
    expect(html).toContain('src="https://source.test/page.png"');
  });
});
