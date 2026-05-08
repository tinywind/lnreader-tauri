import { describe, expect, it } from "vitest";
import { chapterContentToHtml } from "./chapter-content";

describe("chapterContentToHtml", () => {
  it("escapes text chapter content inside a pre element", () => {
    expect(
      chapterContentToHtml(`Line <one> & "two" 'three'`, "text"),
    ).toBe("<pre>Line &lt;one&gt; &amp; &quot;two&quot; &#39;three&#39;</pre>");
  });

  it("passes html chapter content through unchanged", () => {
    const html = `<section><h1>Title</h1><p>Line & entity</p></section>`;

    expect(chapterContentToHtml(html, "html")).toBe(html);
  });
});
