import { httpError, WebfoxError } from "../../errors.js";
import type { ProviderContext, SearchResponse } from "../contract.js";
import { trimSnippet } from "../shared.js";
import type { Youcom } from "./types.js";

const DEFAULT_BASE_URL = "https://ydc-index.io";

export const adapter = {
  async search(
    request: import("../contract.js").ProviderRequest<"search">,
    config: Youcom,
    context: ProviderContext,
  ): Promise<SearchResponse> {
    const apiKey = config.credentials?.api;
    if (!apiKey) throw new Error("You.com search is missing an API key");

    const options = asRecord(request.options);
    validateDomainFilters(options);

    const response = await fetch(joinUrl(config.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "X-API-Key": apiKey,
      },
      body: JSON.stringify({
        query: request.query,
        count: clamp(request.maxResults, 100),
        ...pickDefined(options, [
          "freshness",
          "country",
          "language",
          "safesearch",
          "knowledge",
          "offset",
          "include_domains",
          "exclude_domains",
          "boost_domains",
          "extraction",
        ]),
      }),
      signal: context.signal,
    });

    if (!response.ok) throw httpError(response, await buildHttpError(response));

    const payload = asRecord(await response.json());
    const searchMetadata = asRecord(payload.metadata);
    const results = [
      ...collectResults(asRecord(payload.results).web, "web", searchMetadata),
      ...collectResults(asRecord(payload.results).news, "news", searchMetadata),
    ];

    return {
      provider: "youcom",
      results: results.slice(0, clamp(request.maxResults, 100)),
    };
  },
};

function joinUrl(baseUrl?: string): string {
  return `${(baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")}/v1/search`;
}

function validateDomainFilters(options: Record<string, unknown>): void {
  const includeDomains = arrayOfStrings(options.include_domains);
  const excludeDomains = arrayOfStrings(options.exclude_domains);
  const boostDomains = arrayOfStrings(options.boost_domains);

  if (includeDomains.length > 0 && excludeDomains.length > 0) {
    throw new WebfoxError(
      "INVALID_INPUT",
      "You.com search options include_domains and exclude_domains cannot be used together.",
    );
  }
  if (includeDomains.length > 0 && boostDomains.length > 0) {
    throw new WebfoxError(
      "INVALID_INPUT",
      "You.com search options include_domains and boost_domains cannot be used together.",
    );
  }
}

function collectResults(
  results: unknown,
  section: "web" | "news",
  searchMetadata: Record<string, unknown> | undefined,
): Array<{
  title: string;
  url: string;
  snippet: string;
  metadata?: Record<string, unknown>;
}> {
  return array(results)
    .map((entry) => asRecord(entry))
    .filter((entry) => Object.keys(entry).length > 0)
    .map((entry) => {
      const url = string(entry.url) ?? "";
      const title = string(entry.title) ?? string(entry.name) ?? (url || "Untitled");
      return {
        title,
        url,
        snippet: buildSnippet(entry, section),
        metadata: buildMetadata(entry, section, searchMetadata),
      };
    });
}

function buildSnippet(
  entry: Record<string, unknown>,
  section: "web" | "news",
): string {
  const contents = asRecord(entry.contents);
  const snippets = [...arrayOfStrings(entry.snippets), ...arrayOfStrings(contents.highlights)];
  if (snippets.length > 0) return trimSnippet(snippets.join("\n\n"), 1200);

  const text =
    string(entry.description) ??
    string(contents.markdown) ??
    string(contents.html) ??
    (section === "news" ? string(entry.page_age) : undefined) ??
    "";

  return trimSnippet(text);
}

function buildMetadata(
  entry: Record<string, unknown>,
  section: "web" | "news",
  searchMetadata: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const metadata = {
    section,
    ...(searchMetadata ? { searchMetadata } : {}),
    ...entry,
  };
  return Object.keys(metadata).length > 0 ? metadata : undefined;
}

function pickDefined(
  source: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> {
  return Object.fromEntries(
    keys.flatMap((key) =>
      source[key] === undefined ? [] : ([[key, source[key]]] as const),
    ),
  );
}

function clamp(value: number, max: number): number {
  return Math.max(1, Math.min(max, Math.trunc(value || 0)));
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function arrayOfStrings(value: unknown): string[] {
  return array(value).flatMap((entry) => (typeof entry === "string" ? [entry] : []));
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function string(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

async function buildHttpError(response: Response): Promise<string> {
  const body = (await response.text()).trim();
  return `You.com search request failed (${response.status}${response.statusText ? ` ${response.statusText}` : ""})${body ? `: ${body}` : "."}`;
}
