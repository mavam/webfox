import { httpError, WebfoxError } from "../../errors.js";
import type {
  ProviderContext,
  ProviderRequest,
  SearchResponse,
  SearchResult,
} from "../contract.js";
import { trimSnippet } from "../shared.js";
import type { Keenable } from "./types.js";

const DEFAULT_BASE_URL = "https://api.keenable.ai";

export const adapter = {
  async search(
    request: ProviderRequest<"search">,
    config: Keenable,
    context: ProviderContext,
  ): Promise<SearchResponse> {
    const apiKey = config.credentials?.api;
    if (!apiKey) throw new Error("Keenable search is missing an API key");
    const maxResults = Math.max(1, Math.trunc(request.maxResults || 0));

    const response = await fetch(
      `${(config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "")}/v1/search`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "X-API-Key": apiKey,
          "X-Keenable-Title": "webfox",
        },
        body: JSON.stringify({ query: request.query, max_results: maxResults }),
        signal: context.signal,
      },
    );

    const body = await response.text();
    if (!response.ok) {
      const detail = body.trim().slice(0, 500);
      throw httpError(
        response,
        `Keenable search failed (HTTP ${response.status})${detail ? `: ${detail}` : "."}`,
      );
    }
    let payload: Record<string, unknown> | undefined;
    try {
      payload = asRecord(JSON.parse(body));
    } catch {
      // Reported below.
    }
    const entries = payload?.results;
    if (!payload || !Array.isArray(entries)) {
      throw new WebfoxError(
        "PROVIDER_FAILURE",
        "Keenable returned an invalid search response.",
        { retryable: false },
      );
    }

    const results = entries
      .map(toSearchResult)
      .filter((result): result is SearchResult => result !== undefined);
    return { provider: "keenable", results: results.slice(0, maxResults) };
  },
};

function toSearchResult(entry: unknown): SearchResult | undefined {
  const record = asRecord(entry);
  const url = text(record?.url);
  if (!record || !url) return undefined;
  const { title, url: _url, description, snippet, ...metadata } = record;
  // Prefer the short description; fall back to a trimmed page excerpt.
  const excerpt = text(description) ?? text(snippet);
  return {
    title: text(title) ?? url,
    url,
    snippet: excerpt ? trimSnippet(excerpt) : "",
    ...(Object.keys(metadata).length > 0 ? { metadata } : {}),
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
