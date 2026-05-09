import { describe, expect, it } from "vitest";
import {
  chapterContentToHtml,
  renderChapterContentAsHtml,
} from "./chapter-content";

describe("chapterContentToHtml", () => {
  it("escapes text chapter content into reader HTML paragraphs", () => {
    expect(
      chapterContentToHtml(
        `Line <one> & "two" 'three'\ncontinued\n\nNext`,
        "text",
      ),
    ).toBe(
      `<section class="reader-text-content"><p>Line &lt;one&gt; &amp; &quot;two&quot; &#39;three&#39;<br>continued</p><p>Next</p></section>`,
    );
  });

  it("passes html chapter content through unchanged", () => {
    const html = `<section><h1>Title</h1><p>Line & entity</p></section>`;

    expect(chapterContentToHtml(html, "html")).toBe(html);
  });

  it("normalizes raw text content at reader render time", () => {
    expect(renderChapterContentAsHtml("Line 1\n\nLine 2", "text")).toBe(
      `<section class="reader-text-content"><p>Line 1</p><p>Line 2</p></section>`,
    );
  });

  it("does not re-wrap text content that is already stored as HTML", () => {
    const html = `<section class="reader-text-content"><p>Line</p></section>`;

    expect(renderChapterContentAsHtml(html, "text")).toBe(html);
  });
});
