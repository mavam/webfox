import { describe, expect, it } from "vitest";
import type { WebDocument } from "../src/domain.js";
import { renderTextDocument } from "../src/render.js";

function document(
  capability: WebDocument["capability"],
  value: unknown,
): WebDocument {
  return {
    schemaVersion: 1,
    capability,
    provider: "custom",
    status: "ok",
    results: [{ input: "input", ok: true, value }],
  } as WebDocument;
}

describe("renderTextDocument", () => {
  it.each([
    ["search", { results: [] }, "No results found."],
    ["answer", { text: " " }, "No answer returned."],
    ["research", { text: "" }, "No report returned."],
    [
      "contents",
      { url: "https://example.com/" },
      "## https://example.com/\n\nNo content returned.",
    ],
    [
      "contents",
      { url: "https://example.com/", content: " \n ", summary: " " },
      "## https://example.com/\n\nNo content returned.",
    ],
  ] as const)("renders empty %s results once", (capability, value, text) => {
    expect(renderTextDocument(document(capability, value))).toBe(text);
  });

  it("keeps nonempty text and summaries verbatim", () => {
    expect(
      renderTextDocument(document("answer", { text: "    indented code\n" })),
    ).toBe("    indented code\n");
    expect(
      renderTextDocument(
        document("contents", { url: "https://example.com/", summary: "S" }),
      ),
    ).toBe("## https://example.com/\n\n### Summary\n\nS");
  });

  it("labels sources and search results by title or URL", () => {
    expect(
      renderTextDocument(
        document("answer", {
          text: "",
          sources: [
            { url: "https://example.com/a", title: "Source A" },
            { url: "https://example.com/b" },
            { url: "https://example.com/c", title: "https://example.com/c" },
            { title: "Title only" },
          ],
          itemCount: 4,
        }),
      ),
    ).toBe(
      [
        "No answer returned.",
        "",
        "Sources:",
        "1. Source A",
        "   https://example.com/a",
        "2. https://example.com/b",
        "3. https://example.com/c",
        "4. Title only",
      ].join("\n"),
    );
    expect(
      renderTextDocument(
        document("search", {
          results: [
            { title: "A", url: "https://a.test", snippet: "Snippet" },
            { url: "https://b.test", snippet: "" },
          ],
        }),
      ),
    ).toBe("1. A\n   https://a.test\n   Snippet\n\n2. https://b.test");
  });
});
