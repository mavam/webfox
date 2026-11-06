import { WebfoxError } from "../../errors.js";
import type {
  ProviderContext,
  ProviderRequest,
  SearchResponse,
  SearchResult,
} from "../contract.js";
import { joinUrl, requestJson, trimSnippet } from "../shared.js";
import type { Keenable } from "./types.js";

const DEFAULT_BASE_URL = "https://api.keenable.ai";
// https://docs.keenable.ai/api-reference/search: max_results is 1-50.
const MAX_RESULTS = 50;
const FORWARDED_OPTIONS = [
  "mode",
  "site",
  "published_after",
  "published_before",
  "acquired_after",
  "acquired_before",
  "query_time",
  "snippet_max_length",
] as const;

export const adapter = {
  async search(
    request: ProviderRequest<"search">,
    config: Keenable,
    context: ProviderContext,
  ): Promise<SearchResponse> {
    const apiKey = config.credentials?.api;
    if (!apiKey) throw new Error("Keenable search is missing an API key");
    const maxResults = Math.max(
      1,
      Math.min(MAX_RESULTS, Math.trunc(request.maxResults || 0)),
    );
    const options = asRecord(request.options) ?? {};

    const payload = asRecord(
      await requestJson(
        joinUrl(config.baseUrl ?? DEFAULT_BASE_URL, "v1/search"),
        {
          method: "POST",
          headers: { "X-API-Key": apiKey, "X-Keenable-Title": "webfox" },
          body: {
            query: request.query,
            max_results: maxResults,
            ...Object.fromEntries(
              FORWARDED_OPTIONS.flatMap((key) =>
                options[key] === undefined ? [] : [[key, options[key]]],
              ),
            ),
          },
          signal: context.signal,
        },
        describeError,
      ),
    );
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

function describeError(payload: unknown, response: Response): string {
  const record = asRecord(payload);
  const detail =
    text(record?.detail) ??
    text(record?.error) ??
    text(record?.message) ??
    (typeof payload === "string" ? text(payload) : undefined) ??
    (record ? JSON.stringify(record) : undefined);
  const trimmed = detail?.trim().slice(0, 500);
  return `Keenable search failed (HTTP ${response.status})${trimmed ? `: ${trimmed}` : "."}`;
}

function toSearchResult(entry: unknown): SearchResult | undefined {
  const record = asRecord(entry);
  const url = text(record?.url);
  if (!record || !url) return undefined;
  const { title, url: _url, description, snippet, ...metadata } = record;
  // `description` is deprecated upstream and usually empty; prefer `snippet`.
  const excerpt = text(snippet) ?? text(description);
  return {
    title: text(title),
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
