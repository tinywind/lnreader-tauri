import { describe, expect, it } from "vitest";
import {
  analyzeLocalImportFile,
  convertLocalImportFile,
  sanitizeLocalImportHtml,
} from "./local-import";

function file(parts: BlobPart[], name: string, type = ""): File {
  return new File(parts, name, { type });
}

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
  it("converts txt files to escaped pre content", async () => {
    const result = await convertLocalImportFile(
      file([`Line <one> & "two" 'three'`], "Plain.txt", "text/plain"),
    );

    expect(result.novel.name).toBe("Plain");
    expect(result.chapters).toHaveLength(1);
    expect(result.chapters[0]).toMatchObject({
      name: "Plain",
      contentType: "text",
      content: `<pre>Line &lt;one&gt; &amp; &quot;two&quot; &#39;three&#39;</pre>`,
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
});
