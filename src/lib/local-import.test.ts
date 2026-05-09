import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

import { invoke } from "@tauri-apps/api/core";
import {
  analyzeLocalImportFile,
  convertLocalImportFile,
  sanitizeLocalImportHtml,
} from "./local-import";

const mockedInvoke = vi.mocked(invoke);

function file(parts: BlobPart[], name: string, type = ""): File {
  return new File(parts, name, { type });
}

function bytes(value: string): number[] {
  return Array.from(new TextEncoder().encode(value));
}

beforeEach(() => {
  mockedInvoke.mockReset();
});

describe("sanitizeLocalImportHtml", () => {
  it("removes scripts, event handlers, styles, and unsafe urls", () => {
    expect(
      sanitizeLocalImportHtml(
        `<section onclick="run()"><script>alert(1)</script><a href="javascript:alert(1)">bad</a><img src="data:image/png;base64,AAAA" onerror="run()" style="width:1px"><span data-extra="x">ok</span></section>`,
      ),
    ).toBe(
      `<section><a>bad</a><img src="data:image/png;base64,AAAA"><span>ok</span></section>`,
    );
  });
});

describe("analyzeLocalImportFile", () => {
  it("emits deterministic hash-backed duplicate metadata", async () => {
    const analysis = await analyzeLocalImportFile(
      file(["hello"], "Example.txt", "text/plain"),
    );

    expect(analysis.format).toBe("txt");
    expect(analysis.title).toBe("Example");
    expect(analysis.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(analysis.pathKey).toBe(`local:txt:${analysis.contentHash}`);
    expect(analysis.duplicate).toEqual({
      strategy: "content-hash",
      key: analysis.contentHash,
      pathKey: analysis.pathKey,
      contentHash: analysis.contentHash,
      fileName: "Example.txt",
      fileSize: 5,
      format: "txt",
    });
  });
});

describe("convertLocalImportFile", () => {
  it("converts txt files to reader-ready html content", async () => {
    const result = await convertLocalImportFile(
      file([`Line <one> & "two" 'three'`], "Plain.txt", "text/plain"),
    );

    expect(result.novel.name).toBe("Plain");
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0]).toMatchObject({
      name: "Plain",
      contentType: "text",
      content: `<section class="reader-text-content"><p>Line &lt;one&gt; &amp; &quot;two&quot; &#39;three&#39;</p></section>`,
    });
  });

  it("converts html files to sanitized html content", async () => {
    const result = await convertLocalImportFile(
      file(
        [
          `<article><h1>Title</h1><p onclick="run()">Safe</p><script>alert(1)</script><a href="https://example.test">link</a><a href="javascript:bad()">bad</a></article>`,
        ],
        "Page.htm",
        "text/html",
      ),
    );

    expect(result.analysis.format).toBe("html");
    expect(result.chapters[0]).toMatchObject({
      contentType: "html",
      content: `<article><h1>Title</h1><p>Safe</p><a href="https://example.test">link</a><a>bad</a></article>`,
    });
  });

  it("converts pdf files to data url content", async () => {
    const result = await convertLocalImportFile(
      file(["%PDF"], "Manual.pdf", "application/pdf"),
    );

    expect(result.analysis.title).toBe("Manual");
    expect(result.chapters[0]).toMatchObject({
      name: "Manual",
      contentType: "pdf",
      content: "data:application/pdf;base64,JVBERg==",
    });
  });

  it("converts epub spine items to html chapters", async () => {
    mockedInvoke.mockImplementation(async (command, args) => {
      if (command === "plugin_zip_list") {
        return [
          {
            name: "META-INF/container.xml",
            compressed_size: 64,
            uncompressed_size: 64,
            is_file: true,
          },
          {
            name: "OEBPS/content.opf",
            compressed_size: 256,
            uncompressed_size: 256,
            is_file: true,
          },
          {
            name: "OEBPS/chapter-1.xhtml",
            compressed_size: 128,
            uncompressed_size: 128,
            is_file: true,
          },
        ];
      }

      const path = (args as { options?: { path?: string } }).options?.path;
      if (path === "META-INF/container.xml") {
        return bytes(
          `<container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>`,
        );
      }
      if (path === "OEBPS/content.opf") {
        return bytes(
          `<package><metadata><title>EPUB Book</title><creator>Writer</creator></metadata><manifest><item id="c1" href="chapter-1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c1"/></spine></package>`,
        );
      }
      if (path === "OEBPS/chapter-1.xhtml") {
        return bytes(
          `<html><head><title>Chapter One</title></head><body><h1>Chapter One</h1><p onclick="run()">Body</p></body></html>`,
        );
      }
      throw new Error(`unexpected zip path: ${path ?? ""}`);
    });

    const result = await convertLocalImportFile(
      file(["epub"], "Book.epub", "application/epub+zip"),
    );

    expect(result.novel).toMatchObject({
      name: "EPUB Book",
      author: "Writer",
    });
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0]).toMatchObject({
      name: "Chapter One",
      contentType: "html",
      content: "<h1>Chapter One</h1><p>Body</p>",
    });
  });
});
