import type {
  Capability,
  ContentsAnswer,
  SearchResult,
  Source,
  TextAnswer,
  WebDocument,
} from "./domain.js";

/**
 * Presentation is deliberately outside the application/runtime: providers
 * return empty results as data, and only renderers decide how they look.
 */
export function emptyResultText(capability: Capability): string {
  switch (capability) {
    case "search":
      return "No results found.";
    case "contents":
      return "No content returned.";
    case "answer":
      return "No answer returned.";
    case "research":
      return "No report returned.";
  }
}

/** Label a search result or source by its title, falling back to its URL. */
export function resultLabel(result: SearchResult | Source): string {
  return result.title ?? ("url" in result ? result.url : "");
}

export function renderTextDocument(
  document: WebDocument,
  { includeErrors = true }: { includeErrors?: boolean } = {},
): string {
  return document.results
    .map((entry, index) => {
      const heading =
        document.results.length > 1 ? `## ${index + 1}. ${entry.input}` : "";
      if (!entry.ok)
        return includeErrors
          ? [heading, `Error: ${entry.error.message}`]
              .filter(Boolean)
              .join("\n\n")
          : undefined;
      let body: string;
      if ("results" in entry.value)
        body = renderSearch(entry.value.results, document.capability);
      else if ("text" in entry.value)
        body = renderText(entry.value, document.capability);
      else body = renderContents(entry.value, document.capability);
      return [heading, body].filter(Boolean).join("\n\n");
    })
    .filter((part) => part !== undefined)
    .join("\n\n");
}
function renderSearch(results: SearchResult[], capability: Capability) {
  if (!results.length) return emptyResultText(capability);
  return results
    .map((result, i) =>
      [
        `${i + 1}. ${resultLabel(result)}`,
        result.title === undefined ? undefined : `   ${result.url}`,
        result.snippet.trim()
          ? `   ${result.snippet.replaceAll("\n", "\n   ")}`
          : undefined,
      ]
        .filter((line) => line !== undefined)
        .join("\n"),
    )
    .join("\n\n");
}
function renderText(answer: TextAnswer, capability: Capability): string {
  const lines = [
    answer.text.trim() ? answer.text : emptyResultText(capability),
  ];
  if (answer.sources?.length) {
    lines.push("", "Sources:");
    for (const [index, source] of answer.sources.entries()) {
      lines.push(`${index + 1}. ${resultLabel(source)}`);
      if ("url" in source && source.title && source.title !== source.url)
        lines.push(`   ${source.url}`);
    }
  }
  return lines.join("\n");
}
function renderContents(answer: ContentsAnswer, capability: Capability) {
  const content = answer.content?.trim() ? answer.content : undefined;
  const summary =
    typeof answer.summary === "string"
      ? answer.summary.trim()
        ? answer.summary
        : undefined
      : answer.summary == null
        ? undefined
        : JSON.stringify(answer.summary, null, 2);
  return [
    `## ${answer.url}`,
    content,
    summary === undefined ? undefined : `### Summary\n\n${summary}`,
    content === undefined && summary === undefined
      ? emptyResultText(capability)
      : undefined,
  ]
    .filter((part) => part !== undefined)
    .join("\n\n");
}
